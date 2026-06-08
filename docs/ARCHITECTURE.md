# Architecture

This document describes how Engagement Harness is structured, how data flows through the system from a PR diff to a posted comment, and why key design decisions were made.

---

## Package Graph

```
cli
 ├── agents      ── core, providers
 ├── pipeline    ── core, providers
 ├── reports     ── core, pipeline
 ├── feedback    (standalone)
 ├── eval        ── core, pipeline, agents, providers, reports
 ├── ci          ── core
 └── core        (foundation)

providers ── core
```

`core` is the only package with no dependencies on other workspace packages. Everything else composes on top of it. `cli` is the integration layer that assembles all packages into user-facing commands.

---

## Package Responsibilities

| Package | Responsibility |
|---|---|
| `core` | Zod schemas (`ConfigSchema`, `CandidateFindingSchema`, `FindingSchema`), `loadConfig()`, `ContextEngine`, `SecretRedactor`, ALM adapter factory |
| `providers` | `Provider` interface, `ProviderRegistry`, `AnthropicProvider`, `OpenAIProvider`, `MockProvider` |
| `agents` | `BaseAgent`, 9 specialist agents, `AgentOrchestrator`, `PerFileOrchestrator`, `CrossFileReviewer`, `ModelRouter` |
| `pipeline` | `FindingPipeline` (7 stages), `EvidenceScorer`, `Verifier`, `TruthVerifierAgent`, `ConfidenceScorer`, `Deduplicator`, `QualityGate`, `PolicyEngine`, `FindingTracker`, claim-type detection |
| `reports` | `ReportGenerator`, JSON/Markdown/HTML renderers, `ReportWriter` |
| `feedback` | `ReactionCollector`, `FeedbackStore`, `MetricsCalculator`, `FeedbackDeduplicator` |
| `eval` | `EvalRunner`, `EvalCase` schema, fixture loader, `FeedbackImporter` |
| `ci` | `GitHubCommenter` (inline diff comments, summary comment upsert) |
| `cli` | Commander.js program, all command implementations, `pricing.ts` |

---

## Full Data Flow

```
git diff (base..head)
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  core: ContextEngine.build()                                  │
│  Input:  base ref, head ref, repository path                  │
│  Output: ContextBundle {                                      │
│    changedFiles: ChangedFile[]  (path, hunks, lines)          │
│    importedContext: ImportedFile[]                            │
│    testFiles: string[]                                        │
│    ruleFiles: RuleFile[]  (from .engagement-harness/rules/)   │
│    prMetadata?: { title, body }                               │
│  }                                                            │
│  SecretRedactor strips secrets before this bundle leaves core │
└──────────────────────────┬──────────────────────────────────┘
                           │  ContextBundle
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  agents: AgentOrchestrator.run()                              │
│                                                               │
│  Pass 1 — PerFileOrchestrator                                 │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  For each changedFile (in parallel):                 │     │
│  │    All 9 agents × file — each agent calls provider   │     │
│  │    Findings tagged: pass="local"                     │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                               │
│  Pass 2 — CrossFileReviewer (skipped if 1 file changed)      │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  All changed files in a single prompt               │     │
│  │  Catches API mismatches, inconsistent error handling │     │
│  │  Findings tagged: pass="integration"                │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                               │
│  Output: CandidateFinding[]                                   │
└──────────────────────────┬──────────────────────────────────┘
                           │  CandidateFinding[]
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  pipeline: FindingPipeline.run()                              │
│                                                               │
│  Stage 1: Schema Validation                                   │
│    CandidateFindingSchema.safeParse() on each finding         │
│    Malformed findings rejected here                           │
│                                                               │
│  Stage 2: Evidence Scoring                                    │
│    EvidenceScorer assigns EvidenceLevel per finding           │
│    strong: verbatim diff line ≥10 chars in evidence           │
│    medium: file path ref, diff keywords, code idents match    │
│    weak:   default fallback                                   │
│    none:   no evidence present                                │
│                                                               │
│  Stage 3: Heuristic Verification                              │
│    Verifier applies schema-level rules per claim type         │
│    Does not call an AI provider                               │
│                                                               │
│  Stage 3.5: LLM Truth Verifier (when provider available)     │
│    TruthVerifierStage sends finding + diff to LLM             │
│    Uses claim-type-aware prompts (bug ≠ missing-test)         │
│    Safety guards:                                             │
│      - critical → always published                            │
│      - high + confidence < 0.7 → published regardless         │
│      - rejection with claimAddressed=false → overridden       │
│                                                               │
│  Stage 4: Confidence Calibration                              │
│    ConfidenceScorer: base 0.5                                 │
│    + strong=+0.2, medium=+0.1, weak=-0.2, none=-0.4          │
│    + verifier approved=+0.1, rejected=-0.3                    │
│    + client rule reference=+0.1                               │
│    + high FP risk pattern=-0.1                                │
│    CandidateFinding → Finding (adds confidence field)         │
│                                                               │
│  Stage 5: Deduplication                                       │
│    Key: file::lineStart::dimension                            │
│    Keeps highest-confidence finding per key                   │
│                                                               │
│  Stage 6: Quality Gate                                        │
│    critical → always published                                │
│    requireVerifierApproval + rejected → filtered              │
│    confidence < threshold (adjusted by file type) → filtered  │
│    severity < severityThreshold → filtered                    │
│    File-type adjustments: config +0.1, test -0.2, frontend -0.2│
│                                                               │
│  Stage 7: Policy Decision                                     │
│    PolicyEngine.decide() → PolicyDecision:                    │
│    approved | approved_with_warnings |                        │
│    needs_manual_review | blocked_by_policy                    │
│                                                               │
│  Output: PipelineResult { published, rejected, decision,      │
│    dimensionConfidence, overallConfidence, metrics }          │
└──────────────────────────┬──────────────────────────────────┘
                           │  PipelineResult
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  pipeline: FindingTracker                                     │
│  Fingerprint: file::category::title::severity (line-agnostic)│
│  States: New | Outstanding | Resolved                         │
│  Prevents duplicate inline comments on re-reviews             │
└──────────────────────────┬──────────────────────────────────┘
                           │
                  ┌────────┴────────┐
                  ▼                 ▼
┌──────────────────┐    ┌──────────────────────────────────────┐
│  reports:         │    │  ci: GitHubCommenter                  │
│  ReportGenerator │    │  - Inline diff comments per finding   │
│  JSON + MD + HTML│    │  - Hidden metadata tag in each:       │
│  → disk          │    │    <!-- eh-metadata: findingId=...    │
│                  │    │    runId=... sourceAgent=... -->       │
│                  │    │  - Summary comment upserted each run  │
│                  │    │  - Falls back to review-level comment │
│                  │    │    if line not in visible diff hunk   │
└──────────────────┘    └──────────────────────────────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────────────┐
                    │  feedback: ReactionCollector              │
                    │  Collects on merge + weekly schedule      │
                    │  Maps reactions → FeedbackState           │
                    │  Writes metrics.json per agent            │
                    └──────────────────────────────────────────┘
```

---

## Model Router

Each agent can be routed to a different AI provider. Resolution order:

1. `config.models[agentId]` — explicit per-agent routing (e.g., `"security": "anthropic"`)
2. Falls back to `"mock"` if no routing is configured

```typescript
// ModelRouter.route(agentId, config) → Provider
const providerName = config.models[agentId] ?? 'mock';
return registry.get(providerName);
```

This lets you selectively enable real AI for high-value agents while keeping others on mock during a pilot.

---

## Extended Thinking

Two agents use Anthropic's extended thinking (interleaved reasoning):

| Agent | Thinking Budget |
|---|---|
| `reviewer` | 8,000 tokens |
| `security` | 10,000 tokens |

Extended thinking is activated via `extendedThinking` in `CompletionOptions`. The `AnthropicProvider` adds:
- Beta header: `anthropic-beta: interleaved-thinking-2025-05-14`
- No `temperature` field (required by the API when thinking is enabled)
- `max_tokens` set to `budget_tokens + 4000` minimum to accommodate thinking + output

---

## FindingTracker and Delta Detection

Re-reviews do not re-post inline comments for findings that haven't changed. The tracker fingerprints each finding as:

```
file :: category :: title :: severity
```

This is intentionally line-agnostic — shifted code from unrelated changes doesn't re-fire old findings. The summary comment shows:

```
✅ Resolved (N)    — present last run, not present now
⚠️ Outstanding (N) — present both runs
🆕 New (N)         — not present last run, present now
```

---

## ALM Adapters

The `alm.platform` config field selects the ALM adapter:

| Value | Adapter |
|---|---|
| `github` | GitHub REST API (`GITHUB_TOKEN`) |
| `gitlab` | GitLab API (`GITLAB_TOKEN`) |
| `azure-devops` | Azure DevOps REST API |
| `bitbucket` | Bitbucket Cloud API |
| `none` | No ALM integration (local/CI-artifacts-only mode) |

---

## Design Decisions

### Why two passes instead of one?
A single pass over the entire diff dilutes agent attention on large PRs. In testing, per-file focus increased precision by catching issues that were missed when agents processed 15+ files in one prompt. The integration pass then catches cross-cutting issues that per-file focus misses.

### Why claim-type-aware verification?
The LLM truth verifier originally used generic evidence rules. This caused valid bug findings to be rejected because "unit tests cover this function" — tests do not prove logic is correct. Claim-type-aware prompts give the verifier the right lens: a bug claim is evaluated by whether the logic error is real, not by test coverage.

### Why confidence scores instead of binary pass/fail?
Binary pass/fail forces a hard threshold that either misses real issues (threshold too high) or floods with noise (threshold too low). Continuous confidence enables per-file-type adjustments: test files get a lower threshold because they have more benign patterns; config files get a higher threshold because findings there are usually critical.

### Why pnpm workspaces?
TypeScript project references (`tsc -b`) require a monorepo. pnpm workspaces provide hermetic installs and workspace protocol linking (`workspace:*`) without hoisting. The `packageManager` field in `package.json` pins the exact pnpm version used in CI.
