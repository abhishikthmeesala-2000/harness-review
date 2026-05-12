import type { ContextBundle } from '@engagement-harness/core';

import { BaseAgent } from './base.js';
import { FINDING_SCHEMA_BLOCK, renderDiffSummary } from './prompt-utils.js';

export class ReviewerAgent extends BaseAgent {
  readonly id = 'reviewer';
  readonly dimension = 'correctness';
  readonly description =
    'Looks for logic bugs, off-by-one errors, edge cases, null handling, and risky behavior changes.';

  promptTemplate(context: ContextBundle): string {
    return [
      'You are the Reviewer agent for the Engagement Harness.',
      `Dimension: ${this.dimension}`,
      'Focus: logic bugs, edge cases, off-by-one errors, null/undefined handling, risky behavior changes.',
      '',
      'Changed files:',
      renderDiffSummary(context.diff),
      '',
      FINDING_SCHEMA_BLOCK,
    ].join('\n');
  }
}
