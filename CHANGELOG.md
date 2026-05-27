# Changelog

All notable changes to Engagement Harness are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added

- **Feedback collection system** — `ReactionCollector` polls GitHub API for emoji reactions on EH-tagged PR comments and maps them to `FeedbackState` values (`accepted`, `false_positive`, `fixed`, `dismissed`, `acknowledged`)
- **`GitHubCommenter`** — posts findings as PR issue comments with embedded `<!-- eh-metadata: ... -->` tags containing `findingId`, `runId`, `sourceAgent`, `dimension`, and `severity` for reaction correlation
- **Per-agent metrics** — `MetricsCalculator` aggregates feedback into per-agent `acceptanceRate` and `falsePositiveRate`, stored in `.engagement-harness/feedback/metrics.json`
- **`FeedbackDeduplicator`** — priority-based deduplication when a comment has multiple reactions (`false_positive > accepted > fixed > dismissed > acknowledged > ignored`)
- **`ClaudeMemoryExporter`** — exports feedback metrics in Claude memory format for AI-assisted analysis
- **Automatic workflow generation on `init`** — `engagement-harness init` now writes all three workflows (`engagement-harness.yml`, `feedback-on-merge.yml`, `collect-feedback.yml`) alongside the review workflow when the git platform is GitHub or unknown
- **Priority-based context deduplication** — `ContextEngine` applies entry priority ordering (changed-file 100 > rule 90 > test 80 > imported-by 70 > imports 60) when enforcing `maxFiles` budget
- **`ExtendedFinding` metadata** — findings now carry `runId`, `prNumber`, `sourceAgent`, and `modelProvider` fields for full traceability
- **CLI feedback commands** — `feedback collect`, `feedback import`, and `feedback report` subcommands
- **CLI uninit command** — `engagement-harness uninit` removes config, scaffold, and generated workflows

### Changed

- All nine agent prompts rewritten to be more conservative — each now includes explicit mitigating factors and safe examples to reduce false positives
- `DataArchitectureAgent` now auto-skips (returns empty prompt) when no migration/schema paths appear in the diff
- `DomainPolicyAgent` now auto-skips when no rule files match changed paths
- `PRIntentGapAgent` now auto-skips when no PR metadata is available

---

## [0.1.0] — 2025-01-01

### Initial release

- **9 specialized agents** — `reviewer`, `security`, `domain-policy`, `testing`, `data-architecture`, `sre-observability`, `design-principles`, `pr-intent-gap`, `remediation`
- **Multi-provider routing** — `MockProvider` (deterministic fixtures, no API key required), `AnthropicProvider` (`claude-sonnet-4-6`), `OpenAIProvider` (`gpt-4o-mini`)
- **`ProviderRegistry`** — register and resolve providers by name; per-agent routing via `config.models`
- **`ContextEngine`** — builds `ContextBundle` from changed files, imports, importers, test files, and rule files; enforces `maxFiles` and `maxTokens` budgets
- **`SecretRedactor`** — redacts PEM keys, AWS access keys, GitHub tokens, `sk-` API keys, JWTs, Bearer tokens, and env-style secrets before any agent prompt
- **`FindingPipeline`** — 7-stage pipeline: schema validation, evidence scoring, verification, confidence calibration, deduplication, quality gate, policy decision
- **`ConfidenceScorer`** — weighted scoring based on evidence level, verifier status, client rule references, and `falsePositiveRisk`
- **`PolicyEngine`** — produces `approved`, `approved_with_warnings`, `needs_manual_review`, or `blocked_by_policy`
- **Report generation** — JSON, Markdown (severity emoji badges, dimension grouping), and HTML (inline CSS, HTML-entity-escaped content) reports
- **`ConfigLoader`** — reads and validates `.engagement-harness/config.json` against `ConfigSchema` (Zod)
- **`RepoProfiler`** — detects language, framework, test framework, CI provider, and monorepo layout
- **`GitDiffParser`** — parses unified diff into `FileDiff[]` with per-line tracking via simple-git
- **`EvalRunner`** — case-based evaluation with precision/recall/TP/FP/FN metrics; 6 fixture cases
- **CLI commands** — `init`, `doctor`, `review`, `report`, `config validate`, `agents list`, `models list`, `models validate`, `ci templates`, `eval`, `remediate`
- **Client rule files** — `.engagement-harness/rules/*.md` enforced by `domain-policy` agent with frontmatter glob matching
- **ALM adapters** — GitHub, GitLab, Azure DevOps, Bitbucket, and none implementations of `AlmAdapter`
