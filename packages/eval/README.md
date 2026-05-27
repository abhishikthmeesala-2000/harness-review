# @engagement-harness/eval

Evaluation framework for Engagement Harness. Runs orchestrator + pipeline against fixture repositories and scores precision, recall, true positives, false positives, and false negatives against expected findings.

---

## Key Modules

| File | Purpose |
|---|---|
| `src/runner.ts` | `EvalRunner` — load cases, run pipeline, score results, write eval report |
| `src/case-schema.ts` | `EvalCaseSchema`, `EvalCase`, `ExpectedFinding`, `ContextRule` |
| `src/feedback.ts` | `FeedbackImporter` — merge `FeedbackEntry[]` into `metrics.json` |

---

## Key Exported Types and Classes

```typescript
// Case schema
export const EvalCaseSchema: z.ZodObject<...>;

export interface EvalCase {
  name: string;
  description: string;
  fixtureRepoPath: string;
  baseRef: string;
  headRef: string;
  prTitle?: string;
  prBody?: string;
  expectedFindings: ExpectedFinding[];
  expectedDecision: PolicyDecision;
  maxFalsePositives: number; // default 1
  contextRules?: ContextRule[];
}

export interface ExpectedFinding {
  category: FindingCategory;
  severity?: FindingSeverity;
  fileGlob?: string; // micromatch pattern
  mustMatchPhrases?: string[]; // case-insensitive, checked in title or evidence
}

export interface ContextRule {
  path: string;
  content: string;
}

// Runner
export class EvalRunner {
  static runAll(casesDir: string, config: Config): Promise<EvalReport>;
  static runCase(casePath: string, config: Config): Promise<EvalCaseResult>;
}

// Feedback importer
export interface FeedbackEntry {
  findingId: string;
  runId: string;
  state: FeedbackState;
  note?: string;
  timestamp: string; // ISO 8601
}

export class FeedbackImporter {
  import(filePath: string, repoRoot: string): Promise<void>;
}
```

---

## Eval Case Directory Structure

```
packages/eval/src/cases/
├── security-missing-auth/
│   ├── case.json          # EvalCase definition
│   └── diff.patch         # Synthetic unified diff
├── clean-pr/
│   ├── case.json
│   └── diff.patch
└── domain-policy-violation/
    ├── case.json
    └── diff.patch
```

`case.json` example:
```json
{
  "name": "security-missing-auth",
  "description": "Route handler added without authorization middleware",
  "fixtureRepoPath": ".",
  "baseRef": "HEAD~1",
  "headRef": "HEAD",
  "prTitle": "Add admin dashboard route",
  "expectedFindings": [
    {
      "category": "security",
      "severity": "high",
      "fileGlob": "src/**",
      "mustMatchPhrases": ["authorization", "auth"]
    }
  ],
  "expectedDecision": "needs_manual_review",
  "maxFalsePositives": 1
}
```

---

## Running the Eval Suite

```bash
engagement-harness eval
```

Or directly:
```typescript
import { EvalRunner } from '@engagement-harness/eval';

const report = await EvalRunner.runAll('./packages/eval/src/cases', config);
console.log(`Precision: ${report.precision}, Recall: ${report.recall}`);
```

---

## Dependencies

- `@engagement-harness/core` — schemas, config, context
- `@engagement-harness/agents` — `AgentOrchestrator`
- `@engagement-harness/pipeline` — `FindingPipeline`
- `@engagement-harness/providers` — `ProviderRegistry`
- `@engagement-harness/reports` — `ReportGenerator`
- `micromatch` — file glob matching for `ExpectedFinding.fileGlob`
- `zod` — `EvalCaseSchema` and `FeedbackEntrySchema` validation
