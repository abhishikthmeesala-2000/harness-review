# Changelog

All notable changes to Engagement Harness are documented here.

---

## [Unreleased]

No unreleased changes.

---

## [0.1.0] — Initial Release

### Features

**Verifier**
- `feat(verifier)` — 10 systematic improvements to reduce false positives and false negatives, including claim-type-aware evidence rules and safety guards that prevent high-signal findings from being silently dropped

**Remediation**
- `feat(remediation)` — BEFORE/AFTER structured code patches, `detectTechStack()` for language/framework/ORM-aware fixes, and `remediate --finding <id>` CLI subcommand

**Pipeline**
- `feat(pipeline)` — LLM truth verifier as a second verification pass; claim-type-aware prompts prevent cross-type evidence misuse
- `feat(pipeline)` — Systematic verifier tuning with claim-type-aware verification rules per finding category
- `feat(pipeline)` — Dynamic confidence thresholds and severity overrides in the quality gate; file-type adjustments (config, test, frontend, backend)

**Agents**
- `feat(agents)` — 9 specialist agents with expert personas and extended thinking (reviewer: 8000 tokens, security: 10000 tokens)
- `feat(agents)` — `CONSERVATIVE_FINDING_BLOCK` and false-positive suppression rules embedded in agent system prompts
- `feat(agents)` — Structured BEFORE/AFTER remediation patches generated alongside findings

**CI**
- `feat(ci)` — Quality gates before AI review: checks diff size, file count, and commit message format
- `feat(ci)` — Severity rubric enforced as a pre-review gate
- `feat(ci)` — Inline PR comments posted on diff-visible lines; falls back to review-level comments when line is not in the visible hunk

**Config**
- `feat(config)` — `feedback.autoCollect` enabled by default in generated configs

**CLI**
- `feat(cli)` — Auto-detect repository from git remote in `feedback collect`; no `--repo` flag needed inside a git repository

**Reviews**
- `feat` — Two-pass review as the default CI behavior: per-file pass followed by cross-file integration pass
- `feat` — Real Anthropic and OpenAI provider integrations with streaming and extended thinking support

**Other**
- `feat` — Feedback collection system with GitHub reaction parsing, deduplication, metrics aggregation, and pilot-report generation
- `feat` — 9 specialist agents, eval runner, ALM adapters (GitHub, GitLab, Azure DevOps, Bitbucket), and CI templates for all four platforms
- `feat` — Reports package: JSON, Markdown, and HTML output formats written to `.engagement-harness/reports/`
- `feat` — 7-stage finding pipeline: schema validation, evidence scoring, heuristic verification, LLM truth verifier, confidence calibration, deduplication, quality gate + policy decision
- `feat` — Provider interface, agent orchestrator, and model router with per-agent provider routing
- `feat` — ContextEngine, diff parser, and secret redaction
- `feat` — Monorepo scaffold with 9 workspace packages and core Zod schemas

### Fixes

**CI**
- `fix(ci)` — Pin pnpm to version 10 in feedback collection workflows
- `fix(ci)` — Remove explicit pnpm version from `action-setup` — `packageManager` field in `package.json` handles it
- `fix(ci)` — Revert `packageManager` to `pnpm@10.33.2` — pnpm v11 requires Node 22; CI runs Node 20
- `fix(ci)` — Remove `HARNESS_PAT` requirement — repository is public, bare HTTPS clone works without credentials
- `fix(ci)` — Correct clone auth format; add preflight secret check before clone
- `fix(ci)` — Authenticate git clone with token to fix non-interactive CI failures
- `fix(ci)` — Post inline PR comments on diff-visible lines instead of always falling back to review-level
- `fix(ci)` — Upsert summary comment on re-reviews instead of posting a new comment each run
- `fix(ci)` — Summary comment shows current PR status only, not cumulative run history
- `fix(ci)` — Remove explicit pnpm version to resolve conflict with `packageManager` in `package.json`
- `fix(ci)` — Bake quality gates into the generated source-repo CI template
- `fix(ci)` — Pin workflow action versions for reproducibility

**Providers**
- `fix(providers)` — Add `anthropic-beta: interleaved-thinking-2025-05-14` header; drop temperature for extended thinking requests
- `fix(providers)` — Update tests to expect temperature omitted when extended thinking is enabled

**Agents**
- `fix(agents)` — Resolve JSON parse failures and HTTP 400 `max_tokens` errors for extended thinking; ensure `max_tokens >= budget_tokens + margin`
- `fix(agents)` — Address review findings on specialist personas: tighten system prompt conservatism

**Feedback**
- `fix(feedback)` — Paginate review comments; capture outdated/resolved threads via `state=all`; fix lint errors

**CLI**
- `fix(cli)` — Replace `pnpm link --global` with `npm link` for pnpm v11 compatibility
- `fix(cli,ci)` — Remove unused imports and pin workflow action versions

**Other**
- `fix` — Resolve HTTP 400 errors and hardcoded extended thinking configuration bugs
- `fix(repo)` — Add `.claire/` to `.gitignore`

### Documentation

- `docs` — Production-grade documentation overhaul: README, CONTRIBUTING, CHANGELOG, SECURITY, ARCHITECTURE, QUICK_START, CONFIGURATION, AGENTS, FEEDBACK_SYSTEM, CUSTOM_PROMPTS, TROUBLESHOOTING, all 9 package READMEs, GitHub issue templates and PR template

---

[Unreleased]: https://github.com/abhishikthmeesala-2000/harness-review/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/abhishikthmeesala-2000/harness-review/releases/tag/v0.1.0
