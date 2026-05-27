import type { CandidateFinding, ContextBundle } from '@engagement-harness/core';
import type { Provider } from '@engagement-harness/providers';
import { z } from 'zod';

import { BaseAgent } from './base.js';
import { renderDiffSummary, renderFileContext, renderFunctionContext } from './prompt-utils.js';

export const RemediationPlanSchema = z.object({
  findingId: z.string().min(1),
  /** Step-by-step remediation instructions in Markdown. */
  plan: z.string().min(1),
  /** Optional unified diff patch showing the suggested code change. */
  suggestedPatch: z.string().optional(),
  /** Test scenarios recommended to verify the fix. */
  testRecommendations: z.array(z.string()),
  estimatedEffort: z.enum(['trivial', 'small', 'medium', 'large']),
});

export type RemediationPlan = z.infer<typeof RemediationPlanSchema>;

export class RemediationAgent extends BaseAgent {
  readonly id = 'remediation';
  readonly dimension = 'remediation';
  readonly description = 'Generates structured remediation plans for existing findings.';

  promptTemplate(_context: ContextBundle): string {
    // Non-finding agent — run() always yields []. Use remediate() instead.
    return '';
  }

  async remediate(
    finding: CandidateFinding,
    context: ContextBundle,
    provider: Provider,
  ): Promise<RemediationPlan> {
    const prompt = [
      'You are the Remediation agent for the Engagement Harness.',
      `Dimension: ${this.dimension}`,
      '',
      'ROLE',
      'Generate a precise, actionable remediation plan for the finding below. Be specific — provide working code examples, not generic advice.',
      '',
      'FINDING',
      `ID: ${finding.id}`,
      `Title: ${finding.title}`,
      `Severity: ${finding.severity}`,
      `File: ${finding.file}:${finding.lineStart}-${finding.lineEnd}`,
      `Why it matters: ${finding.whyItMatters}`,
      `Suggested fix: ${finding.suggestedFix}`,
      '',
      'PLAN REQUIREMENTS',
      '1. Step-by-step fix instructions in Markdown — number each step',
      '2. Each step must reference specific file paths and line numbers from the context',
      '3. Include a ROLLBACK section: how to revert the change if the fix causes issues',
      '4. If a patch is possible, include it as a unified diff in `suggestedPatch`',
      '',
      'TEST RECOMMENDATIONS',
      'Provide specific test scenarios (not generic), including:',
      '- The happy path that the fix must not break',
      '- The exact exploit/failure case that the fix must prevent',
      '- Any edge cases introduced by the fix itself',
      '',
      'EFFORT GUIDE',
      '  trivial: single-line fix, no tests needed',
      '  small:   <1 hour, add/update 1-2 tests',
      '  medium:  1-4 hours, refactor + tests',
      '  large:   >4 hours, architectural change',
      '',
      'Return a JSON object with this exact shape:',
      '{ "findingId": string, "plan": string, "suggestedPatch": string | undefined, "testRecommendations": string[], "estimatedEffort": "trivial"|"small"|"medium"|"large" }',
      'plan: step-by-step Markdown instructions.',
      'testRecommendations: array of specific test scenario descriptions.',
      '',
      'DIFF (what changed):',
      renderDiffSummary(context.diff),
      '',
      'CHANGED FUNCTIONS (the full function body containing the finding — use for precise patch generation):',
      renderFunctionContext(context.diff, context.entries),
      '',
      'FULL FILE CONTEXT (use for specific line references in your plan):',
      renderFileContext(context.entries),
    ].join('\n');

    const { content } = await provider.complete(prompt);

    const match = /\{[\s\S]*\}/.exec(content);
    if (!match) {
      throw new Error(`[remediation] could not extract JSON object from provider response`);
    }

    const parsed: unknown = JSON.parse(match[0]);
    return RemediationPlanSchema.parse(parsed);
  }
}
