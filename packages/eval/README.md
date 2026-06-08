# @engagement-harness/eval

Evaluation framework for Engagement Harness. Runs the orchestrator and pipeline against fixture repositories and scores precision, recall, true positives, false positives, and false negatives against expected findings.

---

## Installation

```bash
pnpm add @engagement-harness/eval
```

---

## Eval Case Schema

An eval case describes a fixture PR scenario and what findings are expected.

```typescript
interface EvalCase {
  name: string;
  description: string;
  fixtureRepoPath: string;     // relative to the eval-cases directory, or "."
  baseRef: string;             // informational git ref
  headRef: string;             // informational git ref
  prTitle: string;
  prBody: string;
  expectedFindings: ExpectedFinding[];
  expectedDecision: PolicyDecision;
  maxFalsePositives: number;   // default: 1
  contextRules?: ContextRule[];  // domain rules injected for this case
}

interface ExpectedFinding {
  category: FindingCategory;   // maps to agent dimension
  severity?: FindingSeverity;
  fileGlob: string;            // micromatch pattern — which file the finding must be in
  mustMatchPhrases: string[];  // all phrases must appear in the finding's title or reasoning
}

interface ContextRule {
  path: string;    // rule file path (e.g., 'rules/api-conventions.md')
  content: string; // rule file content
}
```

---

## Running Evals

```typescript
import { EvalRunner } from '@engagement-harness/eval';

const runner = new EvalRunner({ config, registry });
const results = await runner.run(evalCases);
```

From the CLI:
```bash
engagement-harness eval
```

---

## Eval Result

```typescript
interface EvalResult {
  caseName: string;
  passed: boolean;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  publishedFindings: Finding[];
  missedExpected: ExpectedFinding[];
  unexpectedFindings: Finding[];
  decision: PolicyDecision;
  expectedDecision: PolicyDecision;
  decisionMatch: boolean;
}
```

A case **passes** when:
- All `expectedFindings` are matched (true positive for each)
- False positive count ≤ `maxFalsePositives`
- `decision` matches `expectedDecision`

---

## Matching Logic

An expected finding is matched when a published finding satisfies all three conditions:
1. `finding.file` matches `expectedFinding.fileGlob` (micromatch)
2. `finding.dimension` matches `expectedFinding.category`
3. All strings in `mustMatchPhrases` appear (case-insensitive) in `finding.title + finding.reasoning`

---

## FeedbackImporter

Imports historical feedback from a JSON file for bulk-loading into `metrics.json`.

```typescript
import { FeedbackImporter } from '@engagement-harness/eval';

const importer = new FeedbackImporter({
  storePath: '.engagement-harness/feedback/metrics.json',
});

await importer.importFile('historical-feedback.json');
```

From the CLI:
```bash
engagement-harness feedback import historical-feedback.json
```
