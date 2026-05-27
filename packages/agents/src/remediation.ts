import type { CandidateFinding, ContextBundle } from '@engagement-harness/core';
import type { Provider } from '@engagement-harness/providers';
import { z } from 'zod';

import { BaseAgent } from './base.js';
import { renderDiffSummary } from './prompt-utils.js';

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
      `Finding ID: ${finding.id}`,
      `Title: ${finding.title} (${finding.severity})`,
      `File: ${finding.file}:${finding.lineStart}-${finding.lineEnd}`,
      `Why it matters: ${finding.whyItMatters}`,
      `Suggested fix: ${finding.suggestedFix}`,
      '',
      'Return a JSON object with this exact shape:',
      '{ findingId: string, plan: string, suggestedPatch?: string, testRecommendations: string[], estimatedEffort: "trivial"|"small"|"medium"|"large" }',
      'plan: step-by-step instructions in Markdown.',
      'testRecommendations: array of test scenarios to verify the fix.',
      '',
      'Changed files:',
      renderDiffSummary(context.diff),
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
