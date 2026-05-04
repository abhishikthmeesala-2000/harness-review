import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const EXT: Record<string, string> = {
  json: 'json',
  markdown: 'md',
  html: 'html',
};

export const ReportWriter = {
  write(reports: Record<string, string>, outputDir: string, runId: string): void {
    const runDir = path.join(outputDir, `run-${runId}`);
    mkdirSync(runDir, { recursive: true });
    for (const [fmt, content] of Object.entries(reports)) {
      const ext = EXT[fmt] ?? fmt;
      writeFileSync(path.join(runDir, `report.${ext}`), content, 'utf8');
    }
  },
};
