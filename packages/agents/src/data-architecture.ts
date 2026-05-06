import type { ContextBundle } from '@engagement-harness/core';

import { BaseAgent } from './base.js';
import { renderDiffSummary } from './prompt-utils.js';

const DATA_PATH_RE = /migration|schema|models\/|db\/|\.sql$/i;

export class DataArchitectureAgent extends BaseAgent {
  readonly id = 'data-architecture';
  readonly dimension = 'data';
  readonly description =
    'Flags risky migrations, schema changes, missing indices, and ORM misuse.';

  promptTemplate(context: ContextBundle): string {
    const hasDataPaths = context.diff.some((f) => DATA_PATH_RE.test(f.path));
    if (!hasDataPaths) return '';

    return [
      'You are the Data Architecture agent for the Engagement Harness.',
      `Dimension: ${this.dimension}`,
      'Focus: risky migrations, non-nullable columns without defaults, missing rollback paths, absent indices on FK columns, unsafe ORM patterns.',
      'Return a JSON array of CandidateFinding objects. Each MUST cite a diff line in evidence.',
      '',
      'Changed files:',
      renderDiffSummary(context.diff),
    ].join('\n');
  }
}
