import type { ContextBundle } from '@engagement-harness/core';

import { BaseAgent } from './base.js';
import { renderDiffSummary } from './prompt-utils.js';

export class TestingAgent extends BaseAgent {
  readonly id = 'testing';
  readonly dimension = 'testing';
  readonly description =
    'Looks for missing tests, weak assertions, untested edge cases, untested negative paths.';

  promptTemplate(context: ContextBundle): string {
    return [
      'You are the Testing agent for the Engagement Harness.',
      `Dimension: ${this.dimension}`,
      'Focus: missing tests, weak assertions, untested edge cases, untested negative paths.',
      'Return a JSON array of CandidateFinding objects.',
      '',
      'Changed files:',
      renderDiffSummary(context.diff),
    ].join('\n');
  }
}
