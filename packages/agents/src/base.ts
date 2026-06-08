import {
  CandidateFindingSchema,
  type CandidateFinding,
  type ContextBundle,
} from '@engagement-harness/core';
import type { CompletionOptions, Provider } from '@engagement-harness/providers';
import chalk from 'chalk';

export abstract class BaseAgent {
  abstract readonly id: string;
  abstract readonly dimension: string;
  abstract readonly description: string;

  /**
   * Build the prompt sent to the provider. Implementations MUST include the
   * literal `Dimension: <dimension>` line — MockProvider's deterministic
   * fixture map keys off it. Returning an empty string means the agent has
   * decided it has no work to do (e.g. domain-policy with no rule context),
   * in which case `run()` short-circuits without invoking the provider.
   */
  abstract promptTemplate(context: ContextBundle): string;

  /**
   * Expert persona sent as the provider's system message. Overriding this
   * with a specialist description is the single most effective way to improve
   * finding quality — the system role has privileged weight over user content.
   */
  systemPrompt(): string | undefined {
    return undefined;
  }

  /**
   * Per-agent completion options (e.g. extendedThinking for high-stakes agents).
   * Merged with provider defaults; agent values take precedence.
   *
   * The provider is passed so subclasses can gate model-specific options (such as
   * extendedThinking) on the model name exposed by `provider.model`.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  completionOptions(_provider?: Provider): CompletionOptions {
    return {};
  }

  /**
   * Run the agent. Default implementation:
   *   1. Build the prompt; bail to [] if empty.
   *   2. Call provider.complete(); on throw, warn and return [].
   *   3. Parse the response as a JSON array; tolerate prose surrounding the array.
   *   4. Validate each item against CandidateFindingSchema.
   *   5. Drop malformed items with a single chalk warning per agent run.
   *   6. Tag every accepted candidate with sourceAgent + modelProvider.
   */
  async run(context: ContextBundle, provider: Provider): Promise<CandidateFinding[]> {
    const prompt = this.promptTemplate(context);
    if (!prompt) return [];

    const opts: CompletionOptions = { ...this.completionOptions(provider) };
    const sys = this.systemPrompt();
    if (sys) opts.system = sys;

    let raw: string;
    try {
      const result = await provider.complete(prompt, opts);
      raw = result.content;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(chalk.yellow(`[agent:${this.id}] provider error: ${msg}`));
      return [];
    }

    const parsed = extractJsonArray(raw);
    if (!parsed) {
      // Reached only when the response contains '[' but bracket-extraction
      // still fails (e.g. unbalanced brackets). Surface the raw text so the
      // failure is diagnosable.
      console.warn(
        chalk.yellow(
          `[agent:${this.id}] could not parse JSON array from response: ${raw.slice(0, 200)}`,
        ),
      );
      return [];
    }

    const accepted: CandidateFinding[] = [];
    let dropped = 0;
    for (const item of parsed) {
      const result = CandidateFindingSchema.safeParse(item);
      if (!result.success) {
        dropped++;
        continue;
      }
      accepted.push({
        ...result.data,
        sourceAgent: this.id,
        modelProvider: provider.name,
      });
    }
    if (dropped > 0) {
      console.warn(
        chalk.yellow(`[agent:${this.id}] dropped ${dropped} malformed candidate(s) from response`),
      );
    }
    return accepted;
  }
}

/**
 * Returns true when the given model identifier is known to support Anthropic's
 * extended thinking feature. Models containing "opus" or "sonnet" support it;
 * "haiku" models and any unrecognised model name do not.
 *
 * Pass `undefined` (e.g. when the provider exposes no model name) to safely
 * default to false — better to omit extended thinking than to send an
 * unsupported parameter and receive an HTTP 400.
 */
export function supportsExtendedThinking(model: string | undefined): boolean {
  if (!model) return false;
  const lower = model.toLowerCase();
  return lower.includes('opus') || lower.includes('sonnet');
}

// Maps "no findings" responses to "[]" so extractJsonArray returns an empty array
// instead of null when the model returns prose instead of the instructed JSON array.
// Any response with no '[' cannot be a valid JSON array, so we normalise it to [].
function normalizeEmptyResponse(raw: string): string {
  const t = raw.trim();
  if (!t.includes('[')) return '[]';
  return raw;
}

function extractJsonArray(raw: string): unknown[] | null {
  const trimmed = normalizeEmptyResponse(raw).trim();
  // Fast path: response is already a JSON array.
  try {
    const direct: unknown = JSON.parse(trimmed);
    if (Array.isArray(direct)) return direct;
  } catch {
    // Fall through to substring extraction.
  }
  // Best-effort: find the first balanced [...] block and parse it.
  // Uses bracket-counting rather than lastIndexOf so trailing text like
  // "[OWASP-A1]" or "[see above]" after the JSON array does not overshoot
  // to the wrong closing bracket and produce a malformed JSON string.
  const start = trimmed.indexOf('[');
  if (start === -1) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < trimmed.length; i++) {
    if (trimmed[i] === '[') depth++;
    else if (trimmed[i] === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
