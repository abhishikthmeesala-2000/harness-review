# @engagement-harness/reports

Report generation for Engagement Harness. Produces JSON, Markdown, and HTML reports from pipeline results and writes them to disk.

---

## Installation

```bash
pnpm add @engagement-harness/reports
```

---

## Usage

```typescript
import { ReportGenerator } from '@engagement-harness/reports';

const generator = new ReportGenerator({ config });
await generator.generate(pipelineResult, runMetadata);
```

Reports are written to `config.reports.outputDir` (default: `.engagement-harness/reports/`).

---

## Run Metadata

```typescript
interface RunMetadata {
  runId: string;           // unique identifier for this review run
  timestamp: string;       // ISO 8601
  baseRef: string;         // e.g., 'main'
  headRef: string;         // e.g., 'HEAD' or branch SHA
  repoProfile: RepoProfile;
  agentsRun: string[];     // agent IDs that ran
  providersUsed: string[]; // provider names used
}
```

---

## Output Formats

### JSON

`<runId>.json` — Machine-readable. Contains full `PipelineResult`, `RunMetadata`, all published findings with confidence scores, and all rejected entries with rejection reasons.

### Markdown

`<runId>.md` — Human-readable report. Includes:
- Run summary (decision, agent count, finding counts)
- Published findings grouped by severity
- Per-finding: file, line, dimension, severity, reasoning, evidence

### HTML

`<runId>.html` — Standalone HTML file for sharing with stakeholders. Includes:
- Color-coded severity indicators
- Collapsible finding details
- Summary statistics
- No external dependencies (self-contained)

---

## Listing and Reading Reports

```typescript
import { ReportWriter } from '@engagement-harness/reports';

const writer = new ReportWriter({ outputDir: '.engagement-harness/reports' });

// List all run IDs
const runs = await writer.listRuns();
// [{ runId: 'run_abc123', timestamp: '2026-06-08T14:30:00Z', decision: 'approved' }, ...]

// Read a specific run's JSON report
const report = await writer.readRun('run_abc123');

// Read the most recent run
const latest = await writer.readLatest();
```

---

## Configuring Formats

In `.engagement-harness/config.json`:

```json
{
  "reports": {
    "formats": ["json", "markdown"],
    "outputDir": ".engagement-harness/reports"
  }
}
```

Omit `html` from `formats` to skip HTML generation (faster for CI-only use cases).
