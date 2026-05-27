# Architecture

This document explains how Engagement Harness is structured, how data flows through the system, and why key design decisions were made.

---

## Package Dependency Graph

```
cli
 ├── agents
 │    ├── core
 │    └── providers
 │         └── core
 ├── ci
 │    └── core
 ├── eval
 │    ├── agents
 │    ├── pipeline
 │    ├── providers
 │    └── reports
 ├── feedback  (no workspace dependencies)
 ├── pipeline
 │    └── core
 ├── providers
 │    └── core
 └── reports
      ├── core
      └── pipeline
```

All packages are private TypeScript modules compiled with project references (`tsc -b`). No package is published to npm; the CLI is consumed by cloning the repo and linking globally.

---

## Full Data Flow

```
1. User runs `engagement-harness review --base main --head HEAD`
   │
   ▼
2. GitDiffParser
   Calls simple-git to get the unified diff between base and head refs.
   Parses hunks into FileDiff[] with per-line add/remove/context tracking.
   │
   ▼
3. ContextEngine.build(diff, config, repoRoot)
   - Filters FileDiff[] against config.context.ignoredPaths (micromatch globs)
   - Reads full content of every changed file
   - Finds sibling test files (*.test.ts, *.spec.ts, __tests__/ directories)
   - Scans .engagement-harness/rules/*.md for rule files matching changed paths
   - Extracts 1-hop imports (files imported by changed files)
   - Extracts 1-hop importers (files that import changed files)
   - Assembles ContextBundle: entries[], diff, repoProfile, prMetadata, runMetadata
   - Applies budget: maxFiles (default 30) and maxTokens (default 80,000)
   │
   ▼
4. SecretRedactor.redactBundle(bundle)
   Applies regex patterns to all entry content, diff hunk lines, and PR metadata:
   PEM private keys, AWS access keys (AKIA...), GitHub tokens (gh[psuro]_...),
   sk- prefixed API keys, JWTs, Bearer tokens, env-style secrets (PASSWORD=, API_KEY=...).
   All matches replaced with [REDACTED_SECRET].
   │
   ▼
5. AgentOrchestrator.run(bundle, config)
   Instantiates each enabled agent, resolves its provider via ModelRouter,
   runs all agents concurrently (Promise.allSettled), collects CandidateFinding[].
   domain-policy skips if no rule entries matched; data-architecture skips if
   no migration/schema paths are in the diff; pr-intent-gap skips if no PR metadata.
   │
   ▼
6. FindingPipeline.process(candidates, bundle, config) — 7 stages:
   ┌─────────────────────────────────────────────────────────────────┐
   │ Stage 1: Schema validation — drop items failing CandidateFindingSchema
   │ Stage 2: Evidence scoring — grade each finding's grounding in the diff:
   │          strong (verbatim ≥10-char diff line in evidence)
   │          medium (file path in evidence, diff keywords, code identifiers)
   │          weak   (fallback)
   │          none   (no evidence at all)
   │ Stage 3: Verification — heuristic checks:
   │          file exists in diff, evidence array non-empty, diff evidence
   │          grounded in actual hunk content, fix avoids generic phrases
   │ Stage 4: Confidence calibration — base 0.5, then:
   │          +0.2 strong evidence, +0.1 medium, -0.2 weak, -0.4 none
   │          +0.1 verifier approved, -0.3 verifier rejected
   │          +0.1 client rule reference, -0.1 high falsePositiveRisk
   │          Clamp to [0, 1], round to 4 decimal places
   │ Stage 5: Deduplication — key: file::lineStart::dimension
   │          Keep highest-confidence finding per key; reject duplicates
   │ Stage 6: Quality gate — filter by confidenceThreshold (default 0.8)
   │          and severityThreshold (default low); optional verifier approval
   │ Stage 7: Policy decision:
   │          blocked_by_policy  — blockOnPolicy=true + high/critical above threshold
   │          needs_manual_review — high/critical findings present
   │          approved_with_warnings — medium findings present
   │          approved              — only low findings or none
   └─────────────────────────────────────────────────────────────────┘
   │
   ▼
7. ReportGenerator.generateAll(result, runMetadata, config)
   Produces content strings for all enabled formats (json, markdown, html).
   ReportWriter.write() saves to .engagement-harness/reports/run-<runId>/.
   │
   ▼
8. GitHubCommenter.postFindings(findings, prNumber)  [if ci.postComments=true]
   Posts each published finding as a PR comment with embedded HTML metadata:
   <!-- eh-metadata: findingId=EH-0001 runId=... sourceAgent=security ... -->
   This metadata is later read by ReactionCollector to link emoji reactions
   back to specific findings and agents.
```

---

## Package Summaries

### `@engagement-harness/core`

Foundation layer. Contains:

- **Schemas** (`src/schemas/`) — Zod definitions for `Config`, `Finding`, `CandidateFinding`, `PolicyDecision`
- **ConfigLoader** (`src/config/loader.ts`) — reads, validates, and writes `.engagement-harness/config.json`
- **RepoProfiler** (`src/profile/profiler.ts`) — detects language, framework, test framework, CI provider, and monorepo layout
- **GitDiffParser** (`src/git/diff-parser.ts`) — parses unified diff into `FileDiff[]` via simple-git
- **ContextEngine** (`src/context/engine.ts`) — builds `ContextBundle` from diff + repo content
- **SecretRedactor** (`src/redaction/redactor.ts`) — strips secrets from bundle before agent prompts
- **ALM interface** (`src/alm/`) — abstract `AlmAdapter` + implementations for GitHub, GitLab, Azure DevOps, Bitbucket, and none

Key exported types: `Config`, `Finding`, `CandidateFinding`, `ContextBundle`, `ContextEntry`, `FileDiff`, `RepoProfile`, `AlmAdapter`

### `@engagement-harness/providers`

Provider abstraction layer. Contains:

- **`Provider` interface** (`src/interface.ts`) — `complete(prompt, options?): Promise<CompletionResult>`
- **`MockProvider`** (`src/mock.ts`) — deterministic responses keyed on `Dimension:` line in prompt; supports scripted mode (SHA256 hash lookup); patches fixture file/line references against the actual diff
- **`AnthropicProvider`** (`src/anthropic.ts`) — calls `/v1/messages` with `ANTHROPIC_API_KEY`; default model `claude-sonnet-4-6`
- **`OpenAIProvider`** (`src/openai.ts`) — calls `/v1/chat/completions` with `OPENAI_API_KEY`; default model `gpt-4o-mini`
- **`ProviderRegistry`** (`src/registry.ts`) — register, resolve, and list providers

### `@engagement-harness/agents`

Nine specialized agents plus orchestration. Contains:

- **`BaseAgent`** (`src/base.ts`) — abstract class; handles provider call, JSON extraction, `CandidateFindingSchema` validation, and `sourceAgent`/`modelProvider` tagging
- **`AgentOrchestrator`** (`src/orchestrator.ts`) — runs all enabled agents concurrently via `Promise.allSettled`
- **`ModelRouter`** (`src/router.ts`) — maps agent ID to provider string from `config.models`
- **Nine agent classes** — each defines `id`, `dimension`, `description`, and `promptTemplate()`

### `@engagement-harness/pipeline`

The 7-stage processing pipeline. Contains:

- **`FindingPipeline`** (`src/pipeline.ts`) — orchestrates all stages, returns `PipelineResult`
- **`EvidenceScorer`** (`src/evidence-scorer.ts`) — grades diff grounding
- **`Verifier`** (`src/verifier.ts`) — heuristic quality checks
- **`ConfidenceScorer`** (`src/confidence-scorer.ts`) — weighted scoring + rollup
- **`Deduplicator`** (`src/deduplicator.ts`) — per-key best-finding selection
- **`QualityGate`** (`src/quality-gate.ts`) — threshold filtering
- **`PolicyEngine`** (`src/policy-engine.ts`) — final decision

Key types: `PipelineResult`, `PipelineMetrics`, `RejectedEntry`, `EvidenceLevel`

### `@engagement-harness/reports`

Three report renderers. Contains:

- **`ReportGenerator`** (`src/generator.ts`) — dispatches to enabled format renderers
- **`JsonReport`** (`src/json-report.ts`) — pretty-printed JSON with result + metadata
- **`MarkdownReport`** (`src/markdown-report.ts`) — grouped by dimension, severity badges (🔴🟠🟡🔵), quality summary
- **`HtmlReport`** (`src/html-report.ts`) — standalone HTML with inline CSS, HTML-entity-escaped content, collapsible dimension sections
- **`ReportWriter`** (`src/writer.ts`) — writes to `outputDir/run-<runId>/`

### `@engagement-harness/feedback`

Feedback collection and metrics. Contains:

- **`ReactionCollector`** (`src/reaction-collector.ts`) — polls GitHub API for reactions on EH-tagged PR comments
- **`FeedbackStore`** (`src/feedback-store.ts`) — reads/writes `.engagement-harness/feedback/metrics.json`
- **`MetricsCalculator`** (`src/metrics-calculator.ts`) — aggregates `FeedbackItem[]` into per-agent acceptance/FP rates
- **`FeedbackDeduplicator`** (`src/feedback-deduplicator.ts`) — priority-based dedup (false_positive > accepted > fixed > dismissed > acknowledged > ignored)
- **`ClaudeMemoryExporter`** (`src/claude-memory-exporter.ts`) — formats metrics for Claude memory files

Key types: `FeedbackItem`, `FeedbackMetrics`, `AgentMetrics`, `FeedbackState`, `ReactionCounts`

### `@engagement-harness/ci`

GitHub PR comment posting. Contains:

- **`GitHubCommenter`** (`src/github-commenter.ts`) — formats findings as Markdown comments with embedded `<!-- eh-metadata: ... -->` tags and posts them via GitHub Issues API

### `@engagement-harness/eval`

Evaluation framework. Contains:

- **`EvalRunner`** (`src/runner.ts`) — runs orchestrator+pipeline against fixture repos, scores precision/recall/TP/FP/FN
- **`EvalCaseSchema`** (`src/case-schema.ts`) — Zod schema for `case.json` files (expected findings with category, severity, fileGlob, mustMatchPhrases)
- **`FeedbackImporter`** (`src/feedback.ts`) — imports `FeedbackEntry[]` into `metrics.json`

### `@engagement-harness/cli`

Commander.js entry point. Binds all commands from `src/commands/` to the `engagement-harness` binary. See [CLI Reference in README.md](../README.md#cli-reference) for the full command list.

---

## Key Design Decisions

### Issue comments, not inline review comments

GitHub inline review comments require a specific `commit_id` + `path` + `line` combination and can only be posted during review creation. Issue comments (PR comment thread) work on any PR at any time and support emoji reactions — which are the mechanism for feedback collection. Reactions on issue comments are retrievable via a simple REST call; reactions on review comments require a different endpoint and have historically had API inconsistencies.

### `falsePositiveRisk` enum, not a numeric confidence score

A numeric score (0.0–1.0) feels precise but is difficult for prompt engineers to calibrate. An agent writing "confidence: 0.73" vs "confidence: 0.74" has no semantic basis for that difference. `falsePositiveRisk: low | medium | high` gives agents a meaningful vocabulary that maps cleanly to a confidence delta (`-0.1` per high risk).

### Mock provider as the default

Every agent defaults to `MockProvider` with no API key required. This eliminates the most common setup failure (missing env var) and makes the system safe to run in cost-sensitive environments. Opt-in real providers are explicit in config, with per-agent routing so teams can enable live AI incrementally.

### Source clone, not npm install

Engagement Harness is not yet published to npm. Clients clone the repo and build it locally. This ensures the exact same code runs in the client repo CI as in local development and avoids version skew between the published package and the actual source.
