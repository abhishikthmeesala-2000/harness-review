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
};

/**
 * MockProvider — returns canned JSON-array responses for tests and CI runs that
 * have no API key configured. Two modes:
 *
 *  - "deterministic": match prompt against a keyword fixture map. The default
 *    fixtures key off `dimension: <name>` strings emitted by the BaseAgent
 *    prompt template, so each agent dimension reliably maps to one finding.
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
    for (const [key, value] of Object.entries(this.fixtures)) {
      if (lower.includes(key.toLowerCase())) {
        return value;
      }
    }
    return EMPTY_RESPONSE;
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
