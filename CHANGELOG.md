# Changelog

All notable changes are documented here. Grouped by feature area, built from the actual git history.

---

## [0.3.0] — 2026-06

### Added
- **Systematic verifier tuning with claim-type-aware verification** (`feat(pipeline)`): `detectClaimType()` in `claim-types.ts` infers one of eight claim types (bug, security, missing-test, intent-gap, architecture, performance, quality, unknown) from a finding's `title`, `sourceAgent`, and `dimension`. `verifier-prompts.ts` provides per-claim-type accept/reject criteria, ensuring bug findings are never rejected by pointing at test coverage and security findings are never dismissed because tests exist.
- **`TruthVerifierStage` safety guards**: Three overrides — critical findings bypass the LLM entirely (always approved), rejections with `claimAddressed=false` are published regardless of verdict, high-severity findings rejected with confidence < 0.7 are published to avoid missing real issues.
- **`claimAddressed` field in truth-verifier verdicts**: The LLM truth verifier now returns a boolean indicating whether its rejection reason directly addresses the type of claim being made.
- **Dynamic confidence thresholds and severity overrides in quality gate** (`feat(pipeline)`): Quality gate supports per-dimension confidence overrides and per-severity publishing rules.

### Fixed
- `pnpm link --global` replaced with `npm link` — pnpm v11 removed the no-argument form.
- `pnpm/action-setup` version conflict: removed explicit `version: 10` from `collect-feedback.yml` and `feedback-on-merge.yml`.
- CI clone: `feedback-on-merge.yml` and `collect-feedback.yml` now use bare HTTPS clone (repo is public); removed `HARNESS_PAT` requirement.

---

## [0.2.0] — 2026-05

### Added
- **LLM truth verifier as a second verification pass** (`feat(pipeline)`): `TruthVerifierAgent` sends all heuristically-approved findings to an LLM for a second opinion. Verdicts include `approved`, `downgrade`, `rejected`, `needs_context`. Hard gates enforce minimum confidence (0.75) and cross-file validity.
- **Quality gates in CI before AI review** (`feat(ci)`): CI template validates diff size before running agents.
- **Severity rubric** (`feat(agents)`): `SEVERITY_CRITERIA_BLOCK` with concrete ✅/❌ code examples added to all agent prompts.
- **`CONSERVATIVE_FINDING_BLOCK`**: Shared prompt block biasing all agents toward silence unless the issue is directly visible and confirmed.
- **Specialist system prompts** (`feat(agents)`): Expert persona in `systemPrompt()` for every agent. Extended thinking enabled for `security` (10,000 tokens) and `reviewer` (8,000 tokens) on Anthropic Opus/Sonnet models.
- **False positive suppression patterns**: Explicit `FALSE POSITIVE PATTERNS — DO NOT REPORT` sections in all agent prompts.
- **Per-file orchestrator and two-pass review** (`feat(agents)`): `PerFileOrchestrator` for Pass 1 (per-file isolation), `CrossFileReviewer` for Pass 2 (cross-file integration issues).
- **Structured remediation patches** (`feat(agents)`): `RemediationAgent` produces `codeReplacements[]` with file/lineStart/lineEnd/replacement in addition to unified diff patches.
- **`autoCollect: true`** default for feedback section.

### Fixed
- Inline PR comments posted on diff-visible lines (no longer always falling back to conversation comments).
- Summary comment upserted on re-runs instead of posting a new comment each time.
- Extended thinking: `anthropic-beta` header added; temperature forced to 1; max_tokens 400 errors resolved.
- JSON parse failures from providers wrapping responses in markdown fences.
- HTTP 400 errors from hardcoded extended thinking on unsupported models.
- `pnpm/action-setup` explicit version pin removed from CI.

---

## [0.1.0] — 2026-05 — Initial Release

### Added
- **Nine specialized AI agents**: `reviewer`, `security`, `testing`, `domain-policy`, `data-architecture`, `sre-observability`, `design-principles`, `pr-intent-gap`, `remediation`
- **`AgentOrchestrator`**: runs all enabled agents concurrently via `Promise.allSettled`; per-agent provider routing via `ModelRouter`
- **`FindingPipeline`**: 7 stages — schema validation, evidence scoring, verification, confidence calibration, deduplication, quality gate, policy decision
- **`FindingTracker`**: delta tracking (new / outstanding / resolved) with line-agnostic fingerprinting (`file::category::title::severity`)
- **`ContextEngine`**: builds `ContextBundle` — changed files, 1-hop imports, test sibling files, client rule files, budget at `maxFiles`/`maxTokens`
- **`SecretRedactor`**: strips PEM keys, AWS tokens, GitHub tokens, `sk-`-prefixed API keys, JWTs, Bearer tokens, env-style secrets
- **Three providers**: `MockProvider`, `AnthropicProvider`, `OpenAIProvider`
- **Three report formats**: JSON, Markdown, HTML
- **`ReactionCollector`**: polls GitHub API for emoji reactions on `<!-- eh-metadata: ... -->` tagged comments
- **`MetricsCalculator`**: per-agent acceptance and false-positive rates; FP alert at 20% threshold
- **CLI commands**: `init`, `uninit`, `doctor`, `review`, `report`, `config`, `agents`, `models`, `ci`, `eval`, `feedback`, `remediate`
- **GitHub Actions templates**: `engagement-harness.yml`, `feedback-on-merge.yml`, `collect-feedback.yml`
- **ALM adapters**: GitHub, GitLab, Azure DevOps, Bitbucket, none
- **`EvalRunner`**: fixture-based evaluation with precision/recall/TP/FP/FN scoring
- **World-class `init`** experience: `doctor` and `config-validate` commands; `init -y` for non-interactive CI
