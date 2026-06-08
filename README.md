<div align="center">

# ⬡ Engagement Harness

**AI-powered code review that gets smarter with every pull request**

[![CI](https://github.com/abhishikthmeesala-2000/harness-review/actions/workflows/ci.yml/badge.svg)](https://github.com/abhishikthmeesala-2000/harness-review/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-566%20passing-brightgreen)](#development)
[![Version](https://img.shields.io/badge/version-0.1.0-blue)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-green)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![pnpm](https://img.shields.io/badge/maintained%20with-pnpm-cc00ff.svg)](https://pnpm.io/)

[Quick Start](#quick-start) •
[How It Works](#how-it-works) •
[Agents](#nine-specialized-agents) •
[Configuration](#configuration) •
[CLI Reference](#cli-reference) •
[Documentation](#documentation)

</div>

---

Engagement Harness is a CI-native, multi-agent pull request review platform. It runs nine specialized AI agents on every PR diff and emits a single auditable decision — `approved`, `approved_with_warnings`, `needs_manual_review`, or `blocked_by_policy` — along with structured findings in JSON, Markdown, and HTML. Reactions from developers (👍 👎 🚀 😕 👀) are automatically collected on merge and used to improve agent accuracy over time.

---

## Quick Start

```bash
# 1. Clone and build
git clone https://github.com/abhishikthmeesala-2000/harness-review.git
cd harness-review
pnpm install && pnpm build
cd packages/cli && npm link && cd ../..

# 2. Initialize in your repository
cd /path/to/your/repo
engagement-harness init

# 3. Add an API key and run a review
export ANTHROPIC_API_KEY=sk-ant-...
engagement-harness review --base main --head HEAD
```

See [docs/QUICK_START.md](docs/QUICK_START.md) for the full 5-minute guide with CI configuration.

---

## How It Works

```
Pull Request Opened
        │
        ▼
┌─────────────────────────────────────────────────────┐
│  ContextEngine + SecretRedactor                      │
│  Builds ContextBundle: changed files, imports,       │
│  test files, client rules. Redacts all secrets.      │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  Pass 1: Per-File Analysis                           │
│  Each changed file reviewed in isolation             │
│  All 9 agents × each file — running in parallel      │
│  Findings tagged  pass: "local"                      │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  Pass 2: Cross-File Integration                      │
│  All files together — one prompt                     │
│  Catches API mismatches, missing error propagation,  │
│  inconsistent patterns across files in the same PR   │
│  Skipped when only 1 file changed                    │
│  Findings tagged  pass: "integration"                │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  7-Stage Finding Pipeline                            │
│  1. Schema validation                                │
│  2. Evidence scoring (none/weak/medium/strong)       │
│  3. Heuristic verification                           │
│  3.5 LLM truth verifier (claim-type-aware)           │
│  4. Confidence calibration                           │
│  5. Deduplication (file::category::title::severity)  │
│  6. Quality gate (confidence + severity thresholds)  │
│  7. Policy decision                                  │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  Delta Tracking                                      │
│  Fingerprint: file :: category :: title :: severity  │
│  🆕 New  •  ⚠️ Outstanding  •  ✅ Resolved           │
│  No repeated inline comments on re-reviews           │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  PR Comments + Reports                               │
│  Inline diff comments with hidden metadata tags      │
│  JSON + Markdown + HTML reports written to disk      │
│  Summary comment upserted on every run               │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  Feedback Loop                                       │
│  👍 👎 🚀 😕 👀 reactions collected on merge         │
│  Per-agent acceptance + FP rates in metrics.json     │
│  Identifies which agents need prompt tuning          │
└─────────────────────────────────────────────────────┘
```

---

## Nine Specialized Agents

| Agent ID | Dimension | What It Checks |
|---|---|---|
| `reviewer` | `correctness` | Logic bugs, off-by-one errors, null dereferences, risky behavior changes |
| `security` | `security` | SQL injection, XSS, missing auth, unsafe crypto, hardcoded secrets, path traversal |
| `testing` | `testing` | Missing tests for new exports, weak assertions, untested error paths |
| `domain-policy` | `domain-policy` | Violations of client rules in `.engagement-harness/rules/*.md` |
| `data-architecture` | `data` | Risky migrations, NOT NULL without DEFAULT, missing FK indices, unsafe ORM raw queries |
| `sre-observability` | `observability` | Silent error swallowing, missing structured logs, unhandled promise rejections |
| `design-principles` | `design` | SRP violations, high coupling, abstraction leaks, misleading names |
| `pr-intent-gap` | `intent-gap` | Gaps between PR title/description and actual diff — scope creep, missing TODOs |
| `remediation` | `remediation` | Structured BEFORE/AFTER code patches, tech-stack-aware fix plans |

Agents short-circuit when they have nothing meaningful to evaluate: `domain-policy` with no rule files, `data-architecture` with no migration/schema/ORM paths, `design-principles` on diffs under 20 lines, and `pr-intent-gap` with no PR metadata. No API call is made in those cases.

---

## Key Features

| Feature | Description |
|---|---|
| **Two-pass review** | Pass 1: per-file focus. Pass 2: cross-file integration finds API mismatches and inconsistent patterns invisible in isolation. |
| **Claim-type-aware verifier** | LLM truth verifier detects the claim type (bug, security, missing-test, intent-gap, architecture, performance, quality) and uses evidence appropriate to that type. |
| **Confidence calibration** | Each finding gets a confidence score (0–1) based on evidence strength, verifier verdict, and severity. Quality gate filters below threshold. |
| **Smart re-review** | Findings fingerprinted as `file::category::title::severity`. Re-reviews show ✅ Resolved / ⚠️ Outstanding / 🆕 New — no duplicate inline comments. |
| **Automatic feedback loop** | GitHub reactions collected on merge. Per-agent acceptance and false-positive rates written to `metrics.json`. |
| **Multi-provider routing** | Assign each agent to a different AI provider. Run `security` + `reviewer` on Anthropic; use `mock` for the rest to control pilot costs. |
| **Zero-config dry run** | `MockProvider` built in. Run a full review on any PR with no API key and zero cost to validate the pipeline is wired correctly. |
| **Custom domain rules** | Drop Markdown rule files into `.engagement-harness/rules/`. The `domain-policy` agent applies them literally. |
| **Three report formats** | JSON for tooling, Markdown for humans, HTML for stakeholders — all written to `.engagement-harness/reports/`. |
| **CI native** | GitHub Actions templates generated by `engagement-harness ci templates --platform github --write`. Supports GitHub, GitLab, Azure DevOps, Bitbucket. |

---

## Cost Estimates

All estimates use `claude-sonnet-4-6` with all 9 agents enabled.

| PR Size | Changed Files | Approximate Cost |
|---|---|---|
| Small | 1–3 files, ~50 lines | ~$0.05 |
| Medium | 4–8 files, ~200 lines | ~$0.15 |
| Large | 10–20 files, ~500 lines | ~$0.40 |
| XL | 20+ files, ~1000 lines | ~$0.80 |

To reduce costs: route low-signal agents (`design-principles`, `sre-observability`) to `mock` and enable them only on targeted PRs.

---

## Documentation

| Document | Contents |
|---|---|
| [docs/QUICK_START.md](docs/QUICK_START.md) | 5-minute setup: clone → init → API key → first review → CI |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Package graph, full data flow, design decisions |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every `config.json` field with types, defaults, and examples |
| [docs/AGENTS.md](docs/AGENTS.md) | All 9 agents: what they check, short-circuit conditions, example findings |
| [docs/FEEDBACK_SYSTEM.md](docs/FEEDBACK_SYSTEM.md) | Feedback loop, reaction mapping, metrics interpretation |
| [docs/CUSTOM_PROMPTS.md](docs/CUSTOM_PROMPTS.md) | Client-specific rules for the `domain-policy` agent |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common errors with exact symptoms and fix commands |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development setup, adding agents/commands, PR process |
| [SECURITY.md](SECURITY.md) | Security policy and vulnerability reporting |

---

## Configuration

Configuration lives in `.engagement-harness/config.json` in the repository being reviewed. Created automatically by `engagement-harness init`.

```json
{
  "client": {
    "name": "Acme Corp",
    "engagement": "payments-platform-2026"
  },
  "review": {
    "confidenceThreshold": 0.8,
    "severityThreshold": "low",
    "requireVerifierApproval": true
  },
  "agents": {
    "enabled": [
      "reviewer", "security", "testing", "domain-policy",
      "data-architecture", "sre-observability", "design-principles",
      "pr-intent-gap", "remediation"
    ]
  },
  "models": {
    "security": "anthropic",
    "reviewer": "anthropic"
  },
  "providers": {
    "anthropic": { "model": "claude-sonnet-4-6" }
  },
  "ci": {
    "blockOnPolicy": false,
    "postComments": true
  },
  "feedback": {
    "enabled": true,
    "autoCollect": true
  }
}
```

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for the complete field reference.

---

## CLI Reference

```
engagement-harness <command>

Setup
  init [--yes]                     Initialize in the current repository (interactive)
  uninit [--yes]                   Remove config, scaffold, and workflows
  doctor [--fix]                   Validate installation, config, and environment

Review
  review [--ci] [--base <ref>] [--head <ref>]
                                   Run a PR review
  remediate --finding <id>         Generate a BEFORE/AFTER patch for a finding

Reports
  report latest                    Print the most recent report to stdout
  report run <id>                  Print a specific run report
  report list                      List all run IDs with timestamps and decisions

Introspection
  config validate                  Validate the current config.json
  agents list                      List registered agents with IDs and descriptions
  models list                      Show per-agent provider routing
  models validate                  Check provider availability for each configured agent

CI Integration
  ci templates [--platform <name>] [--context <mode>] [--write] [--no-print]
                                   Generate CI workflow templates
                                   --platform: github | gitlab | azure-devops | bitbucket
                                   --context:  client | source | auto

Feedback
  feedback collect [--repo <owner/repo>] [--pr <n>] [--days <n>] [--since <ISO>]
  feedback import <file>
  feedback report [--format text|json]
  feedback pilot-report [--days <n>]

Evaluation
  eval                             Run the eval suite against fixture cases
```

---

## Project Structure

```
engagement-harness/
├── packages/
│   ├── core/        Zod schemas, config loader, ContextEngine, SecretRedactor, ALM adapters
│   ├── providers/   MockProvider, AnthropicProvider, OpenAIProvider, ProviderRegistry
│   ├── agents/      BaseAgent, 9 specialist agents, AgentOrchestrator, ModelRouter
│   ├── pipeline/    FindingPipeline (7 stages), EvidenceScorer, TruthVerifierAgent,
│   │                ConfidenceScorer, Deduplicator, QualityGate, PolicyEngine, FindingTracker
│   ├── reports/     ReportGenerator, JSON/Markdown/HTML renderers, ReportWriter
│   ├── feedback/    ReactionCollector, FeedbackStore, MetricsCalculator, FeedbackDeduplicator
│   ├── eval/        EvalRunner, EvalCase schema, FeedbackImporter
│   ├── ci/          GitHubCommenter (inline diff + summary comments with reaction metadata)
│   └── cli/         Commander.js entry point, all 13 command groups
├── .github/
│   └── workflows/   ci.yml, engagement-harness.yml, feedback-on-merge.yml, collect-feedback.yml
└── docs/            ARCHITECTURE, QUICK_START, CONFIGURATION, AGENTS, FEEDBACK_SYSTEM,
                     CUSTOM_PROMPTS, TROUBLESHOOTING
```

Package READMEs:
[core](packages/core/README.md) •
[providers](packages/providers/README.md) •
[agents](packages/agents/README.md) •
[pipeline](packages/pipeline/README.md) •
[reports](packages/reports/README.md) •
[feedback](packages/feedback/README.md) •
[eval](packages/eval/README.md) •
[ci](packages/ci/README.md) •
[cli](packages/cli/README.md)

---

## Requirements

- Node.js ≥ 20
- pnpm (`npm install -g pnpm`)
- An Anthropic or OpenAI API key (optional — mock provider works without one)

## Development

```bash
pnpm install    # install all workspace dependencies
pnpm build      # compile all packages (TypeScript project references)
pnpm test       # run 566 Vitest tests across 58 test files
pnpm typecheck  # type-check without emitting
pnpm lint       # ESLint all package sources
pnpm format     # Prettier all package sources
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a new agent, pipeline stage, or CLI command.

---

## License

MIT — see [LICENSE](LICENSE).
