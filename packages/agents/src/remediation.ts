import type { CandidateFinding, ContextBundle } from '@engagement-harness/core';
import type { Provider } from '@engagement-harness/providers';
import { z } from 'zod';

import { BaseAgent } from './base.js';
import { renderDiffSummary } from './prompt-utils.js';

export const RemediationPlanSchema = z.object({
  findingId: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),
  estimatedEffort: z.enum(['low', 'medium', 'high']),
  notes: z.string().optional(),
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
      'Return a JSON object: { findingId: string, steps: string[], estimatedEffort: "low"|"medium"|"high", notes?: string }',
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
