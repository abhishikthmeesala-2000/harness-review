import type { ContextBundle } from '../context/types.js';
import type { FileDiff } from '../git/diff-parser.js';

const REDACTED = '[REDACTED_SECRET]';

interface Pattern {
  name: string;
  regex: RegExp;
}

// Patterns are intentionally narrow to avoid false positives. Known limitations
// are documented in SAFETY.md (phase 8). For example: short tokens (< 20 chars)
// without a recognizable prefix and freeform UUIDs are NOT redacted.
const PATTERNS: Pattern[] = [
  // PEM private-key blocks must be checked first (multi-line, dotAll).
  {
    name: 'pem',
    regex:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  // AWS access key ID
  { name: 'aws-access-key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  // GitHub personal/app/server/refresh tokens
  { name: 'github-token', regex: /\bgh[psuro]_[A-Za-z0-9]{36,}\b/g },
  // OpenAI / Anthropic / generic `sk-` prefixed tokens
  { name: 'sk-token', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  // JWTs
  { name: 'jwt', regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
  // Bearer tokens
  { name: 'bearer', regex: /\bBearer\s+[A-Za-z0-9._\-+/=]{20,}/gi },
  // Env-style secrets: SECRET=..., PASSWORD=..., TOKEN=..., KEY=..., API_KEY=..., ACCESS_KEY=...
  // Only redact the value (capture group), keep the key for readability.
  {
    name: 'env-style',
    regex:
      /\b((?:[A-Z0-9_]*?(?:SECRET|PASSWORD|TOKEN|API[_-]?KEY|ACCESS[_-]?KEY|KEY))\s*[=:]\s*)["']?([^\s"']{8,})["']?/gi,
  },
];

export const SecretRedactor = {
  redact(text: string): string {
    if (!text) return text;
    let out = text;
    for (const { regex, name } of PATTERNS) {
      regex.lastIndex = 0;
      if (name === 'env-style') {
        out = out.replace(regex, (_match, prefix: string) => `${prefix}${REDACTED}`);
      } else {
        out = out.replace(regex, REDACTED);
      }
    }
    return out;
  },

  redactBundle(bundle: ContextBundle): ContextBundle {
    return {
      ...bundle,
      entries: bundle.entries.map((entry) => ({
        ...entry,
        content: SecretRedactor.redact(entry.content),
      })),
      diff: bundle.diff.map(redactFileDiff),
      prMetadata: bundle.prMetadata
        ? {
            title: bundle.prMetadata.title
              ? SecretRedactor.redact(bundle.prMetadata.title)
              : bundle.prMetadata.title,
            body: bundle.prMetadata.body
              ? SecretRedactor.redact(bundle.prMetadata.body)
              : bundle.prMetadata.body,
          }
        : bundle.prMetadata,
    };
  },
};

function redactFileDiff(file: FileDiff): FileDiff {
  return {
    ...file,
    hunks: file.hunks.map((hunk) => ({
      ...hunk,
      lines: hunk.lines.map((line) => ({ ...line, content: SecretRedactor.redact(line.content) })),
    })),
  };
}
