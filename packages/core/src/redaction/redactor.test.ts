import { describe, expect, it } from 'vitest';

import type { ContextBundle } from '../context/types.js';
import type { FileDiff } from '../git/diff-parser.js';
import type { RepoProfile } from '../profile/profiler.js';
import { SecretRedactor } from './redactor.js';

const REDACTED = '[REDACTED_SECRET]';

const MOCK_PROFILE: RepoProfile = {
  language: 'typescript',
  framework: null,
  packageManager: 'pnpm',
  testFramework: 'vitest',
  ciProvider: null,
  isMonorepo: false,
  importantPaths: [],
  suggestedIgnoredPaths: [],
};

describe('SecretRedactor.redact', () => {
  it('returns input unchanged when no secrets present', () => {
    const input = 'function add(a, b) { return a + b; }';
    expect(SecretRedactor.redact(input)).toBe(input);
  });

  it('redacts AWS access key IDs', () => {
    expect(SecretRedactor.redact('id=AKIAIOSFODNN7EXAMPLE done')).toBe(`id=${REDACTED} done`);
  });

  it('does not redact strings that merely look like AWS keys', () => {
    // Wrong prefix and length — should NOT match.
    expect(SecretRedactor.redact('ABCD1234567890')).toBe('ABCD1234567890');
  });

  it('redacts GitHub tokens for each prefix', () => {
    const tokens = ['ghp_', 'ghs_', 'gho_', 'ghu_', 'ghr_'];
    for (const prefix of tokens) {
      const tok = prefix + 'a'.repeat(40);
      expect(SecretRedactor.redact(`token=${tok}`)).toBe(`token=${REDACTED}`);
    }
  });

  it('does not redact arbitrary "gh" identifiers', () => {
    expect(SecretRedactor.redact('github user')).toBe('github user');
    expect(SecretRedactor.redact('gh_short_id')).toBe('gh_short_id');
  });

  it('redacts sk- prefixed tokens', () => {
    const t = 'sk-' + 'A1b2C3'.repeat(8);
    expect(SecretRedactor.redact(`OPENAI=${t}`)).toContain(REDACTED);
  });

  it('does not redact short sk- like strings', () => {
    expect(SecretRedactor.redact('sk-short')).toBe('sk-short');
  });

  it('redacts JWT tokens', () => {
    const jwt = 'eyJabc123_-XYZ.eyJpYXQiOjE2OTM4MDAwMDB9.signature_part_abc';
    expect(SecretRedactor.redact(`Authorization: ${jwt}`)).toContain(REDACTED);
  });

  it('does not redact strings beginning with eyJ that are not JWTs', () => {
    expect(SecretRedactor.redact('eyJustaword')).toBe('eyJustaword');
  });

  it('redacts PEM private key blocks', () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\nLINE2\n-----END RSA PRIVATE KEY-----';
    const out = SecretRedactor.redact(`before\n${pem}\nafter`);
    expect(out).toContain(REDACTED);
    expect(out).not.toContain('MIIEpAIBAAKCAQEA');
  });

  it('does not redact unrelated multi-line text', () => {
    const text = '-----BEGIN CERTIFICATE-----\nfoo\n-----END CERTIFICATE-----';
    expect(SecretRedactor.redact(text)).toBe(text);
  });

  it('redacts env-style secrets while keeping the key visible', () => {
    expect(SecretRedactor.redact('API_KEY=abcdef0123456789')).toBe(`API_KEY=${REDACTED}`);
    expect(SecretRedactor.redact('PASSWORD = "supersecretvalue"')).toBe(`PASSWORD = ${REDACTED}`);
    expect(SecretRedactor.redact('export DB_TOKEN=zzzzzzzz9999')).toBe(
      `export DB_TOKEN=${REDACTED}`,
    );
  });

  it('does not redact short env-style values (under 8 chars)', () => {
    expect(SecretRedactor.redact('PORT=8080')).toBe('PORT=8080');
  });

  it('redacts Bearer tokens (full match, including the word Bearer)', () => {
    expect(SecretRedactor.redact('Authorization: Bearer abc123def456ghi789jkl0')).toBe(
      `Authorization: ${REDACTED}`,
    );
  });

  it('does not redact short Bearer-like strings', () => {
    // "Bearer short" is shorter than the pattern's minimum.
    expect(SecretRedactor.redact('Bearer short')).toBe('Bearer short');
  });

  it('handles multiple secrets in the same string', () => {
    const input = 'AKIAIOSFODNN7EXAMPLE and ghp_' + 'a'.repeat(40);
    const out = SecretRedactor.redact(input);
    expect(out.split(REDACTED).length - 1).toBe(2);
  });
});

describe('SecretRedactor.redactBundle', () => {
  it('redacts entry contents and diff lines without mutating input', () => {
    const diff: FileDiff = {
      path: 'src/a.ts',
      status: 'modified',
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: [
            {
              type: 'added',
              content: 'const key = "AKIAIOSFODNN7EXAMPLE";',
              lineNumber: 1,
            },
          ],
        },
      ],
    };

    const bundle: ContextBundle = {
      entries: [
        {
          path: 'src/a.ts',
          content: 'API_KEY=supersecretvalue123\nconst x = 1;',
          reason: 'Changed file',
          priority: 100,
          kind: 'changed-file',
        },
      ],
      diff: [diff],
      repoProfile: MOCK_PROFILE,
      prMetadata: {
        title: 'token AKIAIOSFODNN7EXAMPLE leaked',
        body: 'see Bearer abc123def456ghi789jkl0',
      },
    };

    const original = JSON.parse(JSON.stringify(bundle));
    const redacted = SecretRedactor.redactBundle(bundle);

    expect(redacted.entries[0]?.content).not.toContain('supersecretvalue123');
    expect(redacted.entries[0]?.content).toContain(REDACTED);
    expect(redacted.diff[0]?.hunks[0]?.lines[0]?.content).toContain(REDACTED);
    expect(redacted.diff[0]?.hunks[0]?.lines[0]?.content).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(redacted.prMetadata?.title).toContain(REDACTED);
    expect(redacted.prMetadata?.body).toContain(REDACTED);

    // Input untouched.
    expect(bundle).toEqual(original);
  });

  it('preserves entry metadata and order', () => {
    const bundle: ContextBundle = {
      entries: [
        { path: 'a.ts', content: 'plain', reason: 'r1', priority: 100, kind: 'changed-file' },
        {
          path: 'b.ts',
          content: 'sk-' + 'x'.repeat(30),
          reason: 'r2',
          priority: 70,
          kind: 'imports',
        },
      ],
      diff: [],
      repoProfile: MOCK_PROFILE,
    };
    const out = SecretRedactor.redactBundle(bundle);
    expect(out.entries.map((e) => e.path)).toEqual(['a.ts', 'b.ts']);
    expect(out.entries[0]?.priority).toBe(100);
    expect(out.entries[1]?.kind).toBe('imports');
    expect(out.entries[1]?.content).toContain(REDACTED);
  });
});
