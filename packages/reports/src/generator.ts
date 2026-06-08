import type { Config } from '@engagement-harness/core';
import type { PipelineResult } from '@engagement-harness/pipeline';

import { HtmlReport } from './html-report.js';
import { JsonReport } from './json-report.js';
import { MarkdownReport } from './markdown-report.js';
import type { RunMetadata } from './types.js';

export const ReportGenerator = {
  generateAll(
    result: PipelineResult,
    meta: RunMetadata,
    config: Config,
    remediations?: Record<string, unknown>,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const fmt of config.reports.formats) {
      if (fmt === 'json') out['json'] = JsonReport.generate(result, meta);
      else if (fmt === 'markdown')
        out['markdown'] = MarkdownReport.generate(result, meta, remediations as never);
      else if (fmt === 'html')
        out['html'] = HtmlReport.generate(result, meta, remediations as never);
    }
    return out;
  },
};
