import type { ContextBundle } from '@engagement-harness/core';

import { BaseAgent } from './base.js';
import { renderDiffSummary } from './prompt-utils.js';

export class PRIntentGapAgent extends BaseAgent {
  readonly id = 'pr-intent-gap';
  readonly dimension = 'intent-gap';
  readonly description =
    'Identifies gaps between the stated PR intent (title/body) and actual changes.';

  promptTemplate(context: ContextBundle): string {
    if (!context.prMetadata?.title && !context.prMetadata?.body) return '';

    const title = context.prMetadata?.title ?? '(no title)';
    const body = context.prMetadata?.body ?? '(no description)';

    return [
      'You are the PR Intent Gap agent for the Engagement Harness.',
      `Dimension: ${this.dimension}`,
      'Focus: identify concrete discrepancies between what the PR author claims and what the diff actually shows.',
      'Return a JSON array of CandidateFinding objects. Only flag genuine mismatches, not missing detail.',
      '',
      'PR title:',
      title,
      '',
      'PR description:',
      body,
      '',
      'Changed files:',
      renderDiffSummary(context.diff),
    ].join('\n');
  }
}
