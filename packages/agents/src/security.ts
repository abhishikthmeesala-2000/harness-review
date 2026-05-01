import type { ContextBundle } from '@engagement-harness/core';

import { BaseAgent } from './base.js';
import { renderDiffSummary } from './prompt-utils.js';

export class SecurityAgent extends BaseAgent {
  readonly id = 'security';
  readonly dimension = 'security';
  readonly description =
    'Looks for missing authorization, injection risks, unsafe crypto, secret exposure, tenant isolation, input validation.';

  promptTemplate(context: ContextBundle): string {
    return [
      'You are the Security agent for the Engagement Harness.',
      `Dimension: ${this.dimension}`,
      'Focus: missing authorization, injection risks, unsafe crypto, secret exposure, tenant isolation, input validation.',
      'Return a JSON array of CandidateFinding objects. Reject anything you cannot quote from the diff.',
      '',
      'Changed files:',
      renderDiffSummary(context.diff),
    ].join('\n');
  }
}
