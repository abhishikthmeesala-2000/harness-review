# @engagement-harness/pipeline

Seven-stage finding processing pipeline for Engagement Harness. Transforms raw `CandidateFinding[]` from agents into verified, scored, deduplicated `Finding[]` with a policy decision.

---

## Key Modules

| File | Purpose |
|---|---|
| `src/pipeline.ts` | `FindingPipeline` — orchestrates all 7 stages |
| `src/evidence-scorer.ts` | `EvidenceScorer` — grades diff grounding |
| `src/verifier.ts` | `Verifier` — heuristic quality checks |
| `src/confidence-scorer.ts` | `ConfidenceScorer` — weighted confidence + rollup |
| `src/deduplicator.ts` | `Deduplicator` — best-finding per key |
| `src/quality-gate.ts` | `QualityGate` — threshold filtering |
| `src/policy-engine.ts` | `PolicyEngine` — final policy decision |
| `src/types.ts` | `PipelineResult`, `PipelineMetrics`, `RejectedEntry`, `EvidenceLevel` |

---

## Key Exported Types

```typescript
export type EvidenceLevel = 'none' | 'weak' | 'medium' | 'strong';

export interface PipelineResult {
  published: Finding[];
  rejected: RejectedEntry[];
  decision: PolicyDecision;
  dimensionConfidence: Record<string, number>;
  overallConfidence: number;
  metrics: PipelineMetrics;
}

export interface PipelineMetrics {
  totalCandidates: number;
  publishedCount: number;
  rejectedByStage: Record<string, number>;
  verifierApprovalRate: number;
  evidenceDistribution: Record<EvidenceLevel, number>;
}

export interface RejectedEntry {
  finding: CandidateFinding;
  reason: string;
  stage: string;
}
```

---

## Pipeline Stages

| Stage | What it does | Rejection reason |
|---|---|---|
| 1. Schema validation | Validates against `CandidateFindingSchema` | Invalid schema |
| 2. Evidence scoring | Grades evidence grounding: strong/medium/weak/none | — |
| 3. Verification | File in diff, evidence non-empty, fix non-generic | Verifier rejected |
| 4. Confidence calibration | Computes `[0,1]` confidence score; upgrades to `Finding` | — |
| 5. Deduplication | Keeps highest-confidence per `file::lineStart::dimension` | Duplicate |
| 6. Quality gate | Filters by `confidenceThreshold` and `severityThreshold` | Below threshold |
| 7. Policy decision | Computes `PolicyDecision`; attaches rollup metrics | — |

### Confidence Scoring Weights

| Factor | Delta |
|---|---|
| Base score | +0.5 |
| Strong evidence | +0.2 |
| Medium evidence | +0.1 |
| Weak evidence | −0.2 |
| No evidence | −0.4 |
| Verifier approved | +0.1 |
| Verifier rejected | −0.3 |
| Client rule reference | +0.1 |
| High `falsePositiveRisk` | −0.1 |

---

## Usage

```typescript
import { FindingPipeline } from '@engagement-harness/pipeline';
import type { CandidateFinding, ContextBundle, Config } from '@engagement-harness/core';

const pipeline = new FindingPipeline();
const result = await pipeline.process(candidates, bundle, config);

console.log(result.decision);        // 'approved' | 'approved_with_warnings' | ...
console.log(result.published);       // Finding[]
console.log(result.metrics);         // PipelineMetrics
```

---

## Dependencies

- `@engagement-harness/core` — `Finding`, `CandidateFinding`, `Config`, `ContextBundle`, schemas
