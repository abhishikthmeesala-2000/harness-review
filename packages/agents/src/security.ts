import type { ContextBundle } from '@engagement-harness/core';

import { BaseAgent } from './base.js';
import { FINDING_SCHEMA_BLOCK, renderDiffSummary } from './prompt-utils.js';

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
      '',
      'Changed files:',
      renderDiffSummary(context.diff),
      '',
      FINDING_SCHEMA_BLOCK,
    ].join('\n');
  }
}
