# Engagement Harness

[![CI](https://github.com/abhishikthmeesala-2000/harness-review/actions/workflows/ci.yml/badge.svg)](https://github.com/abhishikthmeesala-2000/harness-review/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-green)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A CI-native, multi-agent pull request review platform. Engagement Harness installs into any Git repository, runs nine specialized AI agents on every PR diff, and emits a single auditable decision — `approved`, `approved_with_warnings`, `needs_manual_review`, or `blocked_by_policy` — along with structured findings in JSON, Markdown, and HTML.

---

## How It Works

```
Pull Request diff
       │
       ▼
  ContextEngine          Builds ContextBundle: changed files, imports,
  SecretRedactor         tests, rule files; redacts secrets before any
                         agent prompt sees the content
       │
       ▼
  AgentOrchestrator ─────────────────────────────────────────────────┐
       │                                                               │
  ┌────┴────────────────────────────────────────────────────────┐     │
  │  reviewer │ security │ testing │ domain-policy │ data-arch  │     │
  │  sre-observability │ design-principles │ pr-intent-gap      │     │
  └────┬────────────────────────────────────────────────────────┘     │
       │ CandidateFinding[]                                            │
       ▼                                                               │
  FindingPipeline (7 stages)                                           │
    1. Schema validation                                               │
    2. Evidence scoring (none / weak / medium / strong)                │
    3. Verification (file presence, evidence grounding, fix quality)   │
    4. Confidence calibration → Finding[]                              │
    5. Deduplication (highest-confidence per file+line+dimension)      │
    6. Quality gate (confidence + severity thresholds)                 │
    7. Policy decision                                                 │
       │                                                               │
       ▼                                                               │
  Reports (JSON + Markdown + HTML)   ◄──── RemediationAgent ──────────┘
  ALM comments (GitHub/GitLab/…)
  Feedback reactions (👍 👎 🚀 😕 👀)
```

---

## Agents

| Agent ID | Dimension | Checks |
|---|---|---|
| `reviewer` | correctness | Logic bugs, off-by-one errors, null dereferences, risky behavior changes |
| `security` | security | SQL injection, XSS, missing authorization, unsafe crypto, secret exposure |
| `testing` | testing | Missing tests for new exports, weak assertions, untested edge cases |
| `domain-policy` | domain-policy | Violations of client rules in `.engagement-harness/rules/*.md` |
| `data-architecture` | data | Risky migrations, non-nullable columns without defaults, missing indices |
| `sre-observability` | observability | Silent error swallowing, missing structured logs, SLO-impacting changes |
| `design-principles` | design | SRP violations, high coupling, abstraction leaks, naming clarity |
| `pr-intent-gap` | intent-gap | Gaps between PR description and actual diff changes |
| `remediation` | remediation | Structured fix plans with estimated effort and test recommendations |

---

## Quick Start

```bash
# 1. Clone and build
git clone https://github.com/abhishikthmeesala-2000/harness-review.git
cd harness-review
pnpm install && pnpm build

# 2. Link the CLI globally
cd packages/cli && npm link && cd ../..

# 3. Initialize a client repository
cd /path/to/your/repo
engagement-harness init
```

See [docs/QUICK_START.md](docs/QUICK_START.md) for the full 5-minute setup guide, including how to add an API key and run your first review.

---

## Automatic Feedback Loop

After init, Engagement Harness installs three GitHub Actions workflows:

- **`engagement-harness.yml`** — Runs the review on every PR
- **`feedback-on-merge.yml`** — Collects emoji reactions when a PR merges
- **`collect-feedback.yml`** — Weekly sweep of all recent PR reactions

Developers react to finding comments with emoji to signal acceptance or rejection:

| Emoji | Meaning |
|---|---|
| 👍 | Accepted — will fix |
| 👎 | False positive |
| 🚀 | Already fixed |
| 😕 | Dismissed |

Reactions are aggregated per agent into `metrics.json`, which feeds back into provider routing decisions and helps you identify which agents produce the most actionable findings.

---

## CLI Reference

```
engagement-harness <command>

Core
  init                  Initialize in the current repository (interactive)
  uninit                Remove config, scaffold, and workflows
  doctor                Validate installation, config, and environment
  review                Run a PR review
    --ci                Headless CI mode
    --base <ref>        Base git ref for diff
    --head <ref>        Head git ref for diff
  remediate             Generate a remediation plan for a finding
    --finding <id>      Finding ID (e.g. EH-0001)

Reports
  report latest         Print the most recent report to stdout
  report run <id>       Print a specific run's report
  report list           List all run IDs with timestamps and decisions

Configuration
  config validate       Validate the current config.json

Agents & Models
  agents list           List registered agents with IDs and descriptions
  models list           List providers and per-agent routing
  models validate       Validate provider availability for each agent

CI Integration
  ci templates          Generate CI workflow templates
    --platform <name>   github | gitlab | azure-devops | bitbucket
    --context <mode>    client | source | auto (default: auto)
    --write             Write to disk (default for github)

Feedback
  feedback collect      Collect reactions from GitHub PR comments
    --repo <owner/repo> Repository to scan (required)
    --pr <number>       Scan a specific PR
    --days <number>     Days to look back (default: 7)
    --memory-dir <path> Write Claude memory file after collecting
  feedback import <file>  Import a feedback JSON file
  feedback report       Print a feedback metrics report
    --format text|json  Output format (default: text)

Evaluation
  eval                  Run eval suite against fixture cases
```

---

## Features

- **Multi-provider routing** — assign Anthropic Claude, OpenAI GPT, or the built-in `MockProvider` per agent; falls back to mock with no API key required
- **Secret redaction** — diff lines, file content, and PR metadata are scrubbed before any provider sees them (PEM keys, `sk-` tokens, JWTs, `API_KEY=...` env patterns, and more)
- **7-stage pipeline** — schema validation → evidence scoring → verification → confidence calibration → deduplication → quality gate → policy decision
- **Evidence-based confidence** — each finding carries a `[0, 1]` confidence score derived from diff grounding, verifier approval, and false-positive risk
- **Structured reports** — JSON, Markdown, and HTML written to `.engagement-harness/reports/run-<timestamp>/`
- **Client-specific rules** — Markdown files in `.engagement-harness/rules/` are loaded and enforced by the `domain-policy` agent
- **Feedback metrics** — per-agent acceptance and false-positive rates tracked in `.engagement-harness/feedback/metrics.json`

---

## Documentation

| Document | Contents |
|---|---|
| [docs/QUICK_START.md](docs/QUICK_START.md) | 5-minute setup guide |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Package graph, data flow, design decisions |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Complete `config.json` field reference |
| [docs/AGENTS.md](docs/AGENTS.md) | All 9 agents with example findings |
| [docs/FEEDBACK_SYSTEM.md](docs/FEEDBACK_SYSTEM.md) | Feedback loop, reaction mapping, metrics |
| [docs/CUSTOM_PROMPTS.md](docs/CUSTOM_PROMPTS.md) | Client customization and rule overrides |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development setup, adding agents, PR process |
| [SECURITY.md](SECURITY.md) | Security policy and vulnerability reporting |

---

## Project Structure

```
engagement-harness/
├── packages/
│   ├── core/          Schemas, config loader, context engine, secret redaction, ALM interface
│   ├── providers/     MockProvider, AnthropicProvider, OpenAIProvider, ProviderRegistry
│   ├── agents/        BaseAgent + 9 specialized agents, AgentOrchestrator, ModelRouter
│   ├── pipeline/      7-stage FindingPipeline, evidence scorer, verifier, confidence scorer
│   ├── reports/       ReportGenerator, JSON/Markdown/HTML renderers, ReportWriter
│   ├── feedback/      ReactionCollector, FeedbackStore, MetricsCalculator
│   ├── ci/            GitHubCommenter (posts findings with metadata for reaction collection)
│   ├── eval/          EvalRunner, case schema, FeedbackImporter
│   └── cli/           Commander.js entry point + all command implementations
├── .github/
│   └── workflows/     ci.yml, engagement-harness.yml, feedback-on-merge.yml, collect-feedback.yml
├── examples/
│   └── sample-repo/   Example repository with .engagement-harness/rules/payments.md
└── .engagement-harness/  (created in client repos by `engagement-harness init`)
    ├── config.json
    ├── rules/
    └── reports/
```

---

## Requirements

- Node.js ≥ 20
- pnpm ≥ 8 (`npm install -g pnpm`)
- An Anthropic or OpenAI API key (optional — mock provider works without one)

---

## Local Development

```bash
pnpm install        # Install all workspace dependencies
pnpm build          # Compile all packages (TypeScript project references)
pnpm test           # Run Vitest test suite
pnpm typecheck      # Type-check without emitting
pnpm lint           # ESLint all package sources
pnpm format         # Prettier all package sources
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a new agent or CLI command.

---

## License

MIT — see [LICENSE](LICENSE).
