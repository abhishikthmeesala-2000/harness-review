# @engagement-harness/reports

Report generation for Engagement Harness. Produces JSON, Markdown, and HTML reports from pipeline results.

---

## Key Modules

| File | Purpose |
|---|---|
| `src/generator.ts` | `ReportGenerator` — dispatches to enabled format renderers |
| `src/json-report.ts` | `JsonReport` — pretty-printed JSON |
| `src/markdown-report.ts` | `MarkdownReport` — grouped by dimension, severity emoji badges |
| `src/html-report.ts` | `HtmlReport` — standalone HTML with inline CSS |
| `src/writer.ts` | `ReportWriter` — writes files to `outputDir/run-<runId>/` |
| `src/types.ts` | `RunMetadata` interface |

---

## Key Exported Types and Objects

```typescript
export interface RunMetadata {
  runId: string;
  timestamp: string;
  baseRef: string;
  headRef: string;
  repoProfile: RepoProfile;
  agentsRun: string[];
  providersUsed: string[];
}

// Report generator — returns Record<format, content string>
export const ReportGenerator: {
  generateAll(
    result: PipelineResult,
    meta: RunMetadata,
    config: Config
  ): Record<string, string>;
};

// Report writer — writes files to disk
export const ReportWriter: {
  write(
    reports: Record<string, string>,
    outputDir: string,
    runId: string
  ): Promise<void>;
};

// Individual renderers (can be used standalone)
export const JsonReport: { generate(result: PipelineResult, meta: RunMetadata): string };
export const MarkdownReport: { generate(result: PipelineResult, meta: RunMetadata): string };
export const HtmlReport: { generate(result: PipelineResult, meta: RunMetadata): string };
```

---

## Report Format Details

**JSON** — `result.json`: Full `PipelineResult` + `RunMetadata` serialized with 2-space indentation.

**Markdown** — `result.md`: Findings grouped by dimension, sorted by severity. Severity badges: 🔴 critical, 🟠 high, 🟡 medium, 🔵 low. Includes quality summary (rejected-by-stage breakdown) and run metadata table.

**HTML** — `result.html`: Standalone file with inline CSS (no external dependencies). Severity color-coding, collapsible `<details>` sections per dimension, HTML-entity-escaped content for XSS safety.

---

## Usage

```typescript
import { ReportGenerator, ReportWriter } from '@engagement-harness/reports';
import type { RunMetadata } from '@engagement-harness/reports';

const meta: RunMetadata = {
  runId: 'run-1748304000',
  timestamp: new Date().toISOString(),
  baseRef: 'main',
  headRef: 'HEAD',
  repoProfile,
  agentsRun: ['security', 'reviewer'],
  providersUsed: ['anthropic'],
};

const reports = ReportGenerator.generateAll(result, meta, config);
await ReportWriter.write(reports, '.engagement-harness/reports', meta.runId);
```

---

## Dependencies

- `@engagement-harness/core` — `Config`, `RepoProfile`
- `@engagement-harness/pipeline` — `PipelineResult`
