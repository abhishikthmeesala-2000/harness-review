<div align="center">

# ⬡ Engagement Harness

**AI-powered code review that gets smarter with every pull request**

[![CI](https://github.com/abhishikthmeesala-2000/harness-review/actions/workflows/ci.yml/badge.svg)](https://github.com/abhishikthmeesala-2000/harness-review/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-548%20passing-brightgreen)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-green)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![pnpm](https://img.shields.io/badge/maintained%20with-pnpm-cc00ff.svg)](https://pnpm.io/)

[Quick Start](#quick-start) •
[How It Works](#how-it-works) •
[Documentation](#documentation) •
[Contributing](#contributing)

</div>

---

Engagement Harness is a CI-native, multi-agent pull request review platform. It runs nine specialized AI agents on every PR diff and emits a single auditable decision — `approved`, `approved_with_warnings`, `needs_manual_review`, or `blocked_by_policy` — along with structured findings in JSON, Markdown, and HTML. Reactions from developers (👍 👎 🚀 😕 👀) are automatically collected and used to improve agent accuracy over time.

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

See [docs/QUICK_START.md](docs/QUICK_START.md) for the full 5-minute guide including interactive `init` walkthrough, provider setup, and CI configuration.

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
│  5. Deduplication                                    │
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
| `pr-intent-gap` | `intent-gap` | Gaps between PR title/description and actual diff — scope creep, TODOs |
| `remediation` | `remediation` | Structured fix plans with effort estimates, patches, and test recommendations |

Each agent uses a specialist system prompt with conservative reporting rules. Agents short-circuit when they have nothing to evaluate (e.g., `domain-policy` with no rule files, `data-architecture` with no migration paths, `pr-intent-gap` with no PR metadata).

---

## Key Features

### Two-Pass Review System
Pass 1 gives every file focused attention. Pass 2 then reviews all files together to catch cross-cutting issues invisible in isolation — API contract mismatches, inconsistent validation patterns, architectural violations. This solves the attention dilution problem where a single large diff causes agents to miss per-file issues.

### Smart Re-Review (Delta Tracking)
Every finding is fingerprinted as `file::category::title::severity` — line-agnostic so shifted code doesn't re-fire old findings. On re-reviews, the summary comment shows:

```
✅ Resolved (2)    — fixed since last run
⚠️ Outstanding (3) — still present
🆕 New (1)         — first seen this run
```

### Claim-Type-Aware Verifier
The LLM truth verifier detects what *kind* of claim each finding makes (bug, security, missing-test, intent-gap, architecture, performance, quality) and uses evidence appropriate to that type. A bug finding is never rejected because "tests exist" — tests don't prove logic is correct. Three safety guards ensure high-signal findings are never silently dropped:
- `critical` findings always published regardless of verifier verdict
- `high` findings rejected with confidence < 0.7 are published anyway
- Rejections that don't address the claim type are overridden

### Automatic Feedback Loop
Developers react to finding comments. Reactions are collected on merge and weekly, aggregated per agent into `metrics.json`:

| Emoji | GitHub reaction | State | Meaning |
|---|---|---|---|
| 👍 | `+1` | `accepted` | Valid — will fix |
| 👎 | `-1` | `false_positive` | Incorrect finding |
| 🚀 | `rocket` | `fixed` | Already fixed |
| 😕 | `confused` | `dismissed` | Not actionable |


When the overall false-positive rate exceeds 20%, the system names the worst-offending agent and recommends prompt tightening.

### Multi-Provider Routing
Route each agent to a different AI provider — assign `security` and `reviewer` to Anthropic Claude for highest accuracy, and use `mock` for everything else to control costs during a pilot.

### Zero-Config Dry Run
All agents default to the built-in `MockProvider`. Run a full review on any PR with no API key and no cost to validate the pipeline is wired up correctly.

---

## Documentation

| Document | Contents |
|---|---|
| [docs/QUICK_START.md](docs/QUICK_START.md) | 5-minute setup: clone → init → API key → first review |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Package graph, full data flow, design decisions |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every `config.json` field with types, defaults, and examples |
| [docs/AGENTS.md](docs/AGENTS.md) | All 9 agents: what they check, example findings, false positive patterns |
| [docs/FEEDBACK_SYSTEM.md](docs/FEEDBACK_SYSTEM.md) | Feedback loop, reaction mapping, metrics interpretation |
| [docs/CUSTOM_PROMPTS.md](docs/CUSTOM_PROMPTS.md) | Client-specific rules for the `domain-policy` agent |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common errors with exact fix commands |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development setup, adding agents, PR process |
| [SECURITY.md](SECURITY.md) | Security policy and vulnerability reporting |

---

## Configuration

Configuration lives in `.engagement-harness/config.json` in the repository being reviewed. Created by `engagement-harness init`.

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
    "enabled": ["reviewer", "security", "testing", "domain-policy",
                "data-architecture", "sre-observability", "design-principles",
                "pr-intent-gap", "remediation"]
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

Core
  init                         Initialize in the current repository (interactive)
  doctor [--fix]               Validate installation, config, and environment
  review [--ci] [--base <ref>] [--head <ref>]   Run a PR review
  remediate --finding <id>     Generate a remediation plan (e.g. --finding EH-0001)

Reports
  report latest                Print the most recent report to stdout
  report run <id>              Print a specific run's report
  report list                  List all run IDs with timestamps and decisions

Configuration & Introspection
  config validate              Validate the current config.json against the schema
  agents list                  List registered agents with IDs and descriptions
  models list                  Show per-agent provider routing
  models validate              Check provider availability for each configured agent

CI Integration
  ci templates [--platform <name>] [--context <mode>] [--write]
                               Generate workflow templates
                               --platform: github | gitlab | azure-devops | bitbucket
                               --context:  client | source | auto

Feedback
  feedback collect --repo <owner/repo> [--pr <n>] [--days <n>]
  feedback import <file>
  feedback report [--format text|json]
  feedback pilot-report [--days <n>]

Evaluation
  eval                         Run the eval suite against fixture cases
```

---

## Project Structure

```
engagement-harness/
├── packages/
│   ├── core/        Schemas (Zod), config loader, ContextEngine, SecretRedactor, ALM adapter
│   ├── providers/   MockProvider, AnthropicProvider, OpenAIProvider, ProviderRegistry
│   ├── agents/      BaseAgent, 9 specialist agents, AgentOrchestrator, PerFileOrchestrator,
│   │                CrossFileReviewer, ModelRouter
│   ├── pipeline/    FindingPipeline (7 stages), EvidenceScorer, Verifier, TruthVerifierAgent,
│   │                ConfidenceScorer, Deduplicator, QualityGate, PolicyEngine, FindingTracker,
│   │                claim-types, verifier-prompts
│   ├── reports/     ReportGenerator, JSON/Markdown/HTML renderers, ReportWriter
│   ├── feedback/    ReactionCollector, FeedbackStore, MetricsCalculator, FeedbackDeduplicator
│   ├── ci/          GitHubCommenter (inline + summary comments with reaction metadata)
│   ├── eval/        EvalRunner, case schema, FeedbackImporter
│   └── cli/         Commander.js entry point, all command implementations
├── .github/
│   └── workflows/   ci.yml, engagement-harness.yml, feedback-on-merge.yml, collect-feedback.yml
└── docs/            ARCHITECTURE, QUICK_START, CONFIGURATION, AGENTS, FEEDBACK_SYSTEM,
                     CUSTOM_PROMPTS, TROUBLESHOOTING
```

---

## Requirements

- Node.js ≥ 20
- pnpm (`npm install -g pnpm`)
- An Anthropic or OpenAI API key (optional — mock provider works without one)

## Development

```bash
pnpm install    # install all workspace dependencies
pnpm build      # compile all packages (TypeScript project references)
pnpm test       # run 548 Vitest tests across 58 test files
pnpm typecheck  # type-check without emitting
pnpm lint       # ESLint all package sources
pnpm format     # Prettier all package sources
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a new agent or CLI command.

---

## License

MIT — see [LICENSE](LICENSE).
