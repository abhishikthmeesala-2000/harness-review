import type { PipelineResult } from '@engagement-harness/pipeline';

import type { RunMetadata } from './types.js';

export const JsonReport = {
  generate(result: PipelineResult, meta: RunMetadata): string {
    return JSON.stringify({ runMetadata: meta, result }, null, 2);
  },
};
