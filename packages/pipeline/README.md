# @engagement-harness/pipeline

Seven-stage finding processing pipeline for Engagement Harness. Transforms raw `CandidateFinding[]` from agents into verified, scored, deduplicated, quality-gated `Finding[]` with a `PolicyDecision`.

---

## Installation

```bash
pnpm add @engagement-harness/pipeline
```

---

## Usage

```typescript
import { FindingPipeline } from '@engagement-harness/pipeline';

const pipeline = new FindingPipeline({ config });
const result = await pipeline.run(candidateFindings, contextBundle, provider);
```

`provider` is optional. When provided, Stage 3.5 (LLM truth verifier) runs.

---

## The Seven Stages

| Stage | Name | What it does |
|---|---|---|
| 1 | **Schema Validation** | `CandidateFindingSchema.safeParse()` — rejects malformed findings |
| 2 | **Evidence Scoring** | Assigns `EvidenceLevel` per finding: `none \| weak \| medium \| strong` |
| 3 | **Heuristic Verification** | Schema-level rules per claim type (no API call) |
| 3.5 | **LLM Truth Verifier** | Claim-type-aware LLM re-verification (optional, requires provider) |
| 4 | **Confidence Calibration** | Computes 0–1 confidence score; promotes `CandidateFinding → Finding` |
| 5 | **Deduplication** | Keeps highest-confidence finding per `file::lineStart::dimension` key |
| 6 | **Quality Gate** | Filters by confidence threshold and severity threshold |
| 7 | **Policy Decision** | `PolicyEngine.decide()` → `PolicyDecision` |

---

## Evidence Scoring

```typescript
type EvidenceLevel = 'none' | 'weak' | 'medium' | 'strong';
```

| Level | Condition |
|---|---|
| `strong` | Verbatim diff line ≥ 10 chars appears in evidence |
| `medium` | File path reference, diff keywords, or code identifiers from evidence match diff lines |
| `weak` | Default fallback — evidence present but not strongly tied to diff |
| `none` | No evidence field or empty evidence |

---

## Confidence Calibration

Base score: `0.5`

| Condition | Delta |
|---|---|
| Evidence: `strong` | +0.2 |
| Evidence: `medium` | +0.1 |
| Evidence: `weak` | -0.2 |
| Evidence: `none` | -0.4 |
| Verifier approved | +0.1 |
| Verifier rejected | -0.3 |
| Client rule referenced | +0.1 |
| High false-positive risk pattern | -0.1 |

---

## Quality Gate Threshold Adjustments

Base threshold: `config.review.confidenceThreshold` (default `0.8`)

| File type | Adjustment |
|---|---|
| Config files | +0.1 |
| Test files | -0.2 |
| Frontend files | -0.2 |
| `high` severity | -0.1 |

Safety guards (findings that always pass):
- `critical` severity → always published
- `high` severity with confidence < 0.7 → published regardless of threshold

---

## Pipeline Result

```typescript
interface PipelineResult {
  published: Finding[];
  rejected: RejectedEntry[];
  decision: PolicyDecision;          // approved | approved_with_warnings | needs_manual_review | blocked_by_policy
  dimensionConfidence: Record<string, number>;
  overallConfidence: number;
  metrics: PipelineMetrics;
}

interface PipelineMetrics {
  totalCandidates: number;
  publishedCount: number;
  rejectedByStage: Record<string, number>;
  verifierApprovalRate: number;
  truthVerifierApprovalRate?: number;
  evidenceDistribution: Record<EvidenceLevel, number>;
}
```

---

## Delta Tracking

```typescript
import { FindingTracker } from '@engagement-harness/pipeline';

const tracker = new FindingTracker({ storePath: '.engagement-harness/findings.json' });
const delta = tracker.computeDelta(previousRun, currentRun);
// delta: { new: Finding[], outstanding: Finding[], resolved: Finding[] }
await tracker.save(currentRun);
```

Fingerprint format: `file::category::title::severity` (line-agnostic — shifted code doesn't re-fire old findings).

---

## Claim Types

The pipeline detects the claim type of each finding to apply type-appropriate verification:

```typescript
type ClaimType = 'bug' | 'security' | 'missing-test' | 'intent-gap' | 'architecture' | 'performance' | 'quality';
```

The LLM truth verifier uses the detected claim type to avoid cross-type evidence misuse (e.g., a bug claim is never rejected because "tests exist").
