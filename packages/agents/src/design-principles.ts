import type { ContextBundle } from '@engagement-harness/core';

import { BaseAgent } from './base.js';
import { FINDING_SCHEMA_BLOCK, renderDiffSummary } from './prompt-utils.js';

export class DesignPrinciplesAgent extends BaseAgent {
  readonly id = 'design-principles';
  readonly dimension = 'design';
  readonly description =
    'Checks SOLID/DRY violations, abstraction leaks, coupling issues, and naming clarity.';

  promptTemplate(context: ContextBundle): string {
    return [
      'You are the Design Principles agent for the Engagement Harness.',
      `Dimension: ${this.dimension}`,
      'Focus: SOLID violations, excessive coupling, abstraction leaks, premature abstraction, naming that obscures intent.',
      'Evidence MUST cite a specific code line from the diff. Do not raise findings based on style preference alone.',
      '',
      'Changed files:',
      renderDiffSummary(context.diff),
      '',
      FINDING_SCHEMA_BLOCK,
    ].join('\n');
  }
}
