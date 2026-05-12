import type { ContextBundle } from '@engagement-harness/core';

import { BaseAgent } from './base.js';
import { FINDING_SCHEMA_BLOCK, renderDiffSummary } from './prompt-utils.js';

export class SREObservabilityAgent extends BaseAgent {
  readonly id = 'sre-observability';
  readonly dimension = 'observability';
  readonly description =
    'Looks for missing structured logs, absent metrics, silent error swallowing, and SLO-impacting changes.';

  promptTemplate(context: ContextBundle): string {
    return [
      'You are the SRE Observability agent for the Engagement Harness.',
      `Dimension: ${this.dimension}`,
      'Focus: missing structured logs, silent error swallowing, absent metrics/tracing instrumentation, SLO-impacting changes, uncaught promise rejections.',
      '',
      'Changed files:',
      renderDiffSummary(context.diff),
      '',
      FINDING_SCHEMA_BLOCK,
    ].join('\n');
  }
}
