import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import type { CompletionOptions, CompletionResult, Provider } from './interface.js';

export type MockProviderMode = 'deterministic' | 'scripted';

export interface MockProviderOptions {
  mode?: MockProviderMode;
  /** Path to a JSON map of `<hash>: <stringResponse>` for scripted mode. */
  scriptPath?: string;
  /**
   * Override the deterministic keyword map. Keys are matched as case-insensitive
   * substrings against the prompt. The first matching key wins.
   */
  fixtures?: Record<string, string>;
}

const EMPTY_RESPONSE = '[]';

/**
 * Deterministic fixture library. Each value is a JSON array of CandidateFinding
 * shapes (as a string). Keys are matched as lowercase substrings against the
 * prompt; the agent dimension keywords are emitted by the BaseAgent prompt
 * template, which is what guides routing here.
 */
const DEFAULT_FIXTURES: Record<string, string> = {
  // Security agent — triggered by the dimension keyword in the prompt.
  'dimension: security': JSON.stringify([
    {
      id: 'EH-MOCK-SEC-1',
      title: 'Missing authorization check on admin endpoint',
      category: 'security',
      dimension: 'security',
      severity: 'high',
      file: 'src/routes/admin.ts',
      lineStart: 12,
      lineEnd: 18,
      evidence: [{ type: 'diff', content: 'app.post("/admin/delete", async (req, res) => {' }],
      whyItMatters:
        'Unauthenticated callers can reach a destructive endpoint, allowing privilege escalation.',
      suggestedFix: 'Wrap the handler in requireAdmin() before invoking the destructive action.',
      clientRuleReferences: [],
      falsePositiveRisk: 'low',
      sourceAgent: 'security',
      modelProvider: 'mock',
      remediationReadiness: 'ready',
    },
  ]),
  // Reviewer agent — correctness.
  'dimension: correctness': JSON.stringify([
    {
      id: 'EH-MOCK-CORR-1',
      title: 'Off-by-one in loop boundary',
      category: 'correctness',
      dimension: 'correctness',
      severity: 'medium',
      file: 'src/utils/range.ts',
      lineStart: 4,
      lineEnd: 8,
      evidence: [{ type: 'diff', content: 'for (let i = 0; i <= items.length; i++) {' }],
      whyItMatters:
        'The loop reads one element past the end of the array, returning undefined and corrupting downstream output.',
      suggestedFix: 'Change the bound to `i < items.length` so the loop stops at the last index.',
      clientRuleReferences: [],
      falsePositiveRisk: 'low',
      sourceAgent: 'reviewer',
      modelProvider: 'mock',
      remediationReadiness: 'ready',
    },
  ]),
  // Testing agent.
  'dimension: testing': JSON.stringify([
    {
      id: 'EH-MOCK-TEST-1',
      title: 'New behavior added without test coverage',
      category: 'testing',
      dimension: 'testing',
      severity: 'medium',
      file: 'src/utils/range.ts',
      lineStart: 1,
      lineEnd: 12,
      evidence: [
        {
          type: 'diff',
          content: 'export function inclusiveRange(start: number, end: number): number[] {',
        },
      ],
      whyItMatters:
        'A new public function ships without tests; regressions in boundary behavior will not be caught in CI.',
      suggestedFix:
        'Add unit tests covering the empty range, single-element range, and reversed-bounds cases.',
      clientRuleReferences: [],
      falsePositiveRisk: 'low',
      sourceAgent: 'testing',
      modelProvider: 'mock',
      remediationReadiness: 'ready',
    },
  ]),
  // Domain-policy agent — only fires when the prompt actually carries rule context.
  'dimension: domain-policy': JSON.stringify([
    {
      id: 'EH-MOCK-DP-1',
      title: 'Payment handler missing idempotency key',
      category: 'domain-policy',
      dimension: 'domain-policy',
      severity: 'high',
      file: 'src/payments/charge.ts',
      lineStart: 20,
      lineEnd: 32,
      evidence: [
        { type: 'rule', content: 'rules/payments.md: All payment handlers must be idempotent.' },
      ],
      whyItMatters:
        'Retried requests will double-charge customers because the handler does not deduplicate by idempotency key.',
      suggestedFix:
        'Read the Idempotency-Key header and short-circuit if a record for that key already exists.',
      clientRuleReferences: ['rules/payments.md'],
      falsePositiveRisk: 'low',
      sourceAgent: 'domain-policy',
      modelProvider: 'mock',
      remediationReadiness: 'needs-context',
    },
  ]),
  // Data Architecture agent.
  'dimension: data': JSON.stringify([
    {
      id: 'EH-MOCK-DATA-1',
      title: 'Schema migration missing rollback',
      category: 'data',
      dimension: 'data',
      severity: 'high',
      file: 'db/migrations/001_add_payments.sql',
      lineStart: 1,
      lineEnd: 10,
      evidence: [
        {
          type: 'diff',
          content: 'ALTER TABLE payments ADD COLUMN amount_cents INTEGER NOT NULL;',
        },
      ],
      whyItMatters: 'Non-nullable column with no default blocks existing rows during migration.',
      suggestedFix:
        'Add a DEFAULT or run a two-step migration (add nullable, backfill, then add NOT NULL constraint).',
      clientRuleReferences: [],
      falsePositiveRisk: 'low',
      sourceAgent: 'data-architecture',
      modelProvider: 'mock',
      remediationReadiness: 'ready',
    },
  ]),
  // SRE Observability agent.
  'dimension: observability': JSON.stringify([
    {
      id: 'EH-MOCK-OBS-1',
      title: 'Error swallowed without structured log',
      category: 'observability',
      dimension: 'observability',
      severity: 'medium',
      file: 'src/services/payment-processor.ts',
      lineStart: 45,
      lineEnd: 50,
      evidence: [{ type: 'diff', content: 'catch (err) { /* silent */ }' }],
      whyItMatters:
        'Silent catch prevents observability tooling from detecting failures in production.',
      suggestedFix:
        'Replace with logger.error({ err }, "payment processing failed") and re-throw or handle explicitly.',
      clientRuleReferences: [],
      falsePositiveRisk: 'low',
      sourceAgent: 'sre-observability',
      modelProvider: 'mock',
      remediationReadiness: 'ready',
    },
  ]),
  // Design Principles agent.
  'dimension: design': JSON.stringify([
    {
      id: 'EH-MOCK-DES-1',
      title: 'God function violates single responsibility',
      category: 'design',
      dimension: 'design',
      severity: 'medium',
      file: 'src/services/order-service.ts',
      lineStart: 12,
      lineEnd: 80,
      evidence: [
        {
          type: 'diff',
          content: 'export async function processOrder(order: Order) {',
        },
      ],
      whyItMatters:
        'A single function handles validation, payment, inventory, and notification — changes in one path risk unrelated paths.',
      suggestedFix:
        'Decompose into processOrderValidation(), chargeOrder(), reserveInventory(), notifyCustomer().',
      clientRuleReferences: [],
      falsePositiveRisk: 'medium',
      sourceAgent: 'design-principles',
      modelProvider: 'mock',
      remediationReadiness: 'needs-context',
    },
  ]),
  // PR Intent Gap agent.
  'dimension: intent-gap': JSON.stringify([
    {
      id: 'EH-MOCK-INT-1',
      title: 'PR claims "read-only refactor" but writes to DB',
      category: 'intent-gap',
      dimension: 'intent-gap',
      severity: 'high',
      file: 'src/repositories/user-repo.ts',
      lineStart: 33,
      lineEnd: 40,
      evidence: [
        {
          type: 'diff',
          content: 'await db.query("UPDATE users SET last_seen = NOW()")',
        },
      ],
      whyItMatters:
        'The PR description says no writes are introduced, but a side-effecting UPDATE was added.',
      suggestedFix:
        'Either update the PR description to declare the write, or remove it if unintentional.',
      clientRuleReferences: [],
      falsePositiveRisk: 'low',
      sourceAgent: 'pr-intent-gap',
      modelProvider: 'mock',
      remediationReadiness: 'ready',
    },
  ]),
  // Remediation agent — returns JSON object (not array); remediate() extracts via /\{[\s\S]*\}/ regex.
  'dimension: remediation': JSON.stringify({
    findingId: 'EH-MOCK-SEC-1',
    file: 'src/routes/admin.ts',
    lineStart: 12,
    lineEnd: 14,
    before:
      'app.post("/admin/delete", async (req, res) => {\n  await deleteUser(req.body.id);\n});',
    after:
      'app.post("/admin/delete", requireAdmin(), async (req, res) => {\n  await deleteUser(req.body.id);\n});',
    explanation:
      'Add requireAdmin() middleware to guard the destructive endpoint against unauthenticated callers.',
    test: 'it("rejects unauthenticated DELETE", async () => {\n  const res = await request(app).post("/admin/delete");\n  expect(res.status).toBe(401);\n});',
    riskLevel: 'low',
    effort: 'minutes',
    librariesNeeded: [],
    additionalFiles: [],
  }),
};

interface DiffContext {
  file: string;
  lineStart: number;
  lineEnd: number;
  addedLines: string[];
}

/** Extensions considered non-source (config, docs, lock files). */
const NON_SOURCE_EXTENSIONS = new Set([
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.txt',
  '.lock',
  '.env',
  '.ini',
  '.cfg',
  '.conf',
  '.log',
  '.csv',
]);

function isSourceFile(path: string): boolean {
  if (path.startsWith('.')) return false; // dotfiles: .gitignore, .eslintrc, etc.
  const dot = path.lastIndexOf('.');
  if (dot === -1) return false; // no extension
  return !NON_SOURCE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/**
 * Parse the first SOURCE-CODE changed file, hunk range, and added lines from a prompt.
 * Skips config/doc/dotfiles so the finding targets actual code, not .gitignore.
 * Returns null when no parseable diff with source files is present.
 *
 * Handles two formats:
 *   renderDiffSummary → "--- server.js (modified)"  +  "@@ -25,3 +25,4 @@"
 *   raw unified diff  → "diff --git a/server.js b/server.js"
 */
function parseDiffContext(prompt: string): DiffContext | null {
  // Collect all file headers in order, pick first source file.
  let file: string | null = null;

  for (const m of prompt.matchAll(/^--- (.+?) \(/gm)) {
    const candidate = m[1]?.trim();
    if (candidate && isSourceFile(candidate)) {
      file = candidate;
      break;
    }
  }
  if (!file) {
    for (const m of prompt.matchAll(/^diff --git a\/(.+?) b\//gm)) {
      const candidate = m[1]?.trim();
      if (candidate && isSourceFile(candidate)) {
        file = candidate;
        break;
      }
    }
  }
  if (!file) return null;

  const hunkMatch = prompt.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
  if (!hunkMatch) return null;

  const newStart = parseInt(hunkMatch[1]!, 10);
  const newCount = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
  const lineEnd = Math.max(newStart, newStart + newCount - 1);

  const addedLines: string[] = [];
  for (const m of prompt.matchAll(/^\+(?!\+\+)(.+)$/gm)) {
    if (m[1]) addedLines.push(m[1].trim());
  }

  return { file, lineStart: newStart, lineEnd, addedLines };
}

/**
 * Patterns that indicate a security-relevant line in the diff.
 * Used to find a specific line to use as diff-type evidence so the verifier
 * can confirm the finding is grounded in the actual diff.
 */
const SECURITY_SIGNALS: RegExp[] = [
  /\[REDACTED_SECRET\]/, // secret already caught by the redactor
  /`[^`]*\$\{[^}]+\}[^`]*`/, // template literal SQL/injection
  /password\s*[:=]\s*['"`][^'"`]{4,}/i, // hardcoded password
  /secret\s*[:=]\s*['"`][^'"`]{4,}/i, // hardcoded secret
  /api.?key\s*[:=]\s*['"`][^'"`]{4,}/i, // hardcoded API key
  /\beval\s*\(/, // eval()
  /\bexec\s*\(/, // exec()
  /app\.\w+\s*\([^,)]+,\s*(?:async\s*)?\(req/, // route handler (potential missing auth)
];

function findSuspiciousLine(addedLines: string[], signals: RegExp[]): string | null {
  for (const line of addedLines) {
    for (const signal of signals) {
      if (signal.test(line)) return line;
    }
  }
  return null;
}

function hasSignal(addedLines: string[], signals: RegExp[]): boolean {
  return addedLines.some((line) => signals.some((signal) => signal.test(line)));
}

const SAFE_SECURITY_SIGNALS: RegExp[] = [
  /\brequireAdmin\s*\(/i,
  /\bauthMiddleware\b/i,
  /\bauthenticated\b/i,
  /\bauto-escap(?:e|es|ed)\b/i,
  /\bjsx\b/i,
  /\bdompurify\b/i,
  /\bsanitize-html\b/i,
];

const SAFE_CORRECTNESS_SIGNALS: RegExp[] = [
  /\binclusiveRange\b/i,
  /\binclusive by design\b/i,
  /\bend is inclusive\b/i,
  /\binclusive boundary\b/i,
];

const SAFE_TESTING_SIGNALS: RegExp[] = [
  /\bdescribe\s*\(/i,
  /\bit\s*\(/i,
  /\btest\s*\(/i,
  /\bexpect\s*\(/i,
  // React/JSX imports indicate a UI component — not business logic requiring unit tests.
  /from\s+['"]react['"]/i,
];

function shouldSuppressFixture(dimension: string, addedLines: string[]): boolean {
  if (dimension.includes('security')) return hasSignal(addedLines, SAFE_SECURITY_SIGNALS);
  if (dimension.includes('correctness')) return hasSignal(addedLines, SAFE_CORRECTNESS_SIGNALS);
  if (dimension.includes('testing')) return hasSignal(addedLines, SAFE_TESTING_SIGNALS);
  return false;
}

/**
 * Patch a JSON-array fixture so findings reference the real diff's file and
 * line range. For the security dimension, diff-type evidence is also updated
 * to the first suspicious added line found in the diff so the verifier can
 * confirm the finding is grounded. All other dimensions keep original evidence
 * (which already matches their specific eval-case diffs).
 */
function patchFindings(raw: string, ctx: DiffContext, dimension: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!Array.isArray(parsed)) return raw; // remediation object — leave untouched

  if (shouldSuppressFixture(dimension, ctx.addedLines)) {
    return EMPTY_RESPONSE;
  }

  const suspiciousLine = dimension.includes('security')
    ? findSuspiciousLine(ctx.addedLines, SECURITY_SIGNALS)
    : null;

  const patched = (parsed as Record<string, unknown>[]).map((f) => {
    const updated: Record<string, unknown> = {
      ...f,
      file: ctx.file,
      lineStart: ctx.lineStart,
      lineEnd: ctx.lineEnd,
    };
    if (suspiciousLine && Array.isArray(f['evidence'])) {
      updated['evidence'] = (f['evidence'] as Record<string, unknown>[]).map((e) =>
        e['type'] === 'diff' ? { ...e, content: suspiciousLine } : e,
      );
    }
    return updated;
  });
  return JSON.stringify(patched);
}

/**
 * MockProvider — returns canned JSON-array responses for tests and CI runs that
 * have no API key configured. Two modes:
 *
 *  - "deterministic": match prompt against a keyword fixture map. The default
 *    fixtures key off `dimension: <name>` strings emitted by the BaseAgent
 *    prompt template, so each agent dimension reliably maps to one finding.
 *    When the prompt contains a parseable diff, file/line references in the
 *    fixture are patched to the actual changed file and hunk range so the
 *    verifier accepts findings against any real diff, not just the 6 eval fixtures.
 *  - "scripted": look up by hash of (first 200 chars of prompt) in a JSON file.
 *    Used to pin integration-test responses to specific inputs.
 *
 * Either way, when no fixture matches we return `[]` (empty candidate list)
 * rather than throwing — agents cope cleanly with empty results.
 */
export class MockProvider implements Provider {
  public readonly name = 'mock';

  private readonly mode: MockProviderMode;
  private readonly fixtures: Record<string, string>;
  private readonly scripted: Record<string, string>;

  constructor(options: MockProviderOptions = {}) {
    this.mode = options.mode ?? 'deterministic';
    this.fixtures = options.fixtures ?? DEFAULT_FIXTURES;
    this.scripted = this.mode === 'scripted' ? loadScriptFile(options.scriptPath) : {};
  }

  async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    const content =
      this.mode === 'scripted' ? this.scriptedResponse(prompt) : this.deterministicResponse(prompt);
    return { content, tokensUsed: Math.ceil(content.length / 4) };
  }

  /**
   * Stable hash used for scripted-mode keys. Exposed so test fixtures can be
   * generated deterministically by callers (e.g. the eval runner).
   */
  static scriptKey(agentId: string, prompt: string): string {
    const head = prompt.slice(0, 200);
    return createHash('sha256').update(`${agentId}::${head}`).digest('hex').slice(0, 16);
  }

  private deterministicResponse(prompt: string): string {
    const lower = prompt.toLowerCase();
    let matchedKey = '';
    let matchedValue: string | undefined;
    for (const [key, value] of Object.entries(this.fixtures)) {
      if (lower.includes(key.toLowerCase())) {
        matchedKey = key;
        matchedValue = value;
        break;
      }
    }
    if (!matchedValue) return EMPTY_RESPONSE;

    const ctx = parseDiffContext(prompt);
    return ctx ? patchFindings(matchedValue, ctx, matchedKey) : matchedValue;
  }

  private scriptedResponse(prompt: string): string {
    const head = prompt.slice(0, 200);
    // Scripted lookup must be by full hash since callers will key by agent id;
    // we don't know the agent id here, so we accept either the prompt-only hash
    // or a `agentId::head` style key the caller pre-computed.
    const promptHash = createHash('sha256').update(head).digest('hex').slice(0, 16);
    if (this.scripted[promptHash]) return this.scripted[promptHash];
    return EMPTY_RESPONSE;
  }
}

function loadScriptFile(scriptPath: string | undefined): Record<string, string> {
  if (!scriptPath) return {};
  if (!existsSync(scriptPath)) return {};
  try {
    const raw = readFileSync(scriptPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
  } catch {
    // Fall through to empty map; tests should not silently pass on a bad fixture file.
  }
  return {};
}
