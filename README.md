# Engagement Harness

Engagement Harness is a CI-native, multi-agent code review platform that installs into a client repository, learns the project through an interactive setup, and runs automatically on every pull request. It routes each PR diff through nine specialized AI agents — security, correctness, testing, domain-policy, data architecture, SRE observability, design principles, PR intent gap, and remediation — then aggregates their findings through a verification pipeline, confidence scorer, policy engine, and quality gate to produce a single, auditable decision: `approved`, `needs_manual_review`, or `rejected`. Unlike a generic AI reviewer, Engagement Harness is the harness _around_ the AI: it controls context selection, secret redaction, finding deduplication, and provider routing so the AI's output is trustworthy and measurable.

---

## Features

- **9 specialized agents** — each focused on one review dimension (security, correctness, testing, domain-policy, data, observability, design, intent-gap, remediation)
- **Multi-provider routing** — assign different AI providers (Anthropic Claude, OpenAI GPT, or the built-in MockProvider) per agent; falls back to mock when no key is configured
- **CI-native** — single `review` command designed for GitHub Actions; exits non-zero on `rejected` decision
- **Secret redaction** — diff lines, file content, and PR metadata are redacted before reaching any agent prompt
- **Finding verification** — every candidate finding is checked for file presence in the diff, evidence grounded in diff content, and non-generic fix phrasing
- **Confidence scoring** — weighted evidence scoring drives a per-finding confidence level that feeds the quality gate
- **Policy engine** — configurable thresholds for auto-approve and auto-reject; per-severity suppression lists
- **Structured JSON reports** — machine-readable reports written to `.engagement-harness/reports/` on every run
- **Interactive setup** — `engagement-harness init` walks through configuration and generates `.engagement-harness/config.json`
- **Client-specific rules** — drop Markdown rule files into `.engagement-harness/rules/` and the domain-policy agent enforces them

---

## Quick Start

### Prerequisites

- Node.js ≥ 18
- pnpm ≥ 8 (`npm install -g pnpm`)

### Installation

```bash
git clone https://github.com/abhishikthmeesala-2000/harness-review.git
cd harness-review
pnpm install
pnpm build
```

Link the CLI globally (optional — you can also call it via `node packages/cli/dist/bin/engagement-harness.js`):

```bash
cd packages/cli
pnpm link --global
```

> **Troubleshooting:** If `pnpm link --global` fails with `ERR_PNPM_NO_GLOBAL_BIN_DIR`, pnpm has no global bin directory configured. Fix it with:
> ```bash
> pnpm setup          # adds PNPM_HOME to your shell profile
> source ~/.zshrc     # or ~/.bashrc — reload the profile
> pnpm link --global  # retry
> ```
> Alternatively, skip global linking entirely and invoke the CLI directly via `node packages/cli/dist/bin/engagement-harness.js`.

### Initialize a repository

Run this inside the repository you want to review:

```bash
cd /path/to/your/repo
engagement-harness init
```

This creates `.engagement-harness/config.json` with your client name, engagement ID, and agent configuration.

### Verify setup

```bash
engagement-harness doctor
```

Checks that the config file is valid, all enabled agents are registered, and providers are reachable.

### Run a review

```bash
engagement-harness review --base main --head feature/my-branch
```

Or omit `--head` to review uncommitted working-tree changes against `main`.

### Example output

```
Engagement Harness Review
Decision:   needs_manual_review
Confidence: 80%
Findings:   1 published / 4 rejected

Top findings:
  [HIGH] server.js:8  Hardcoded database credentials in source
```

Reports are written to `.engagement-harness/reports/run-<timestamp>/`.

---

## Configuration

Configuration lives in `.engagement-harness/config.json` at the repository root. All fields are optional except `client.name` and `client.engagement`.

```json
{
  "client": {
    "name": "Acme Corp",
    "engagement": "payments-platform-2026"
  },
  "models": {
    "security": "anthropic",
    "reviewer": "openai"
  },
  "providers": {
    "anthropic": { "model": "claude-haiku-4-5-20251001" },
    "openai":    { "model": "gpt-4o-mini" }
  }
}
```

See [CONFIG.md](CONFIG.md) for the full configuration reference, including `review`, `agents`, `ci`, `alm`, and `policy` sections.

---

## Using Live AI Providers

By default all agents use the built-in `MockProvider` (deterministic canned responses, no API key required). To use real models, set environment variables and add providers to your config:

**Anthropic (Claude)**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

```json
{
  "models": { "security": "anthropic" },
  "providers": { "anthropic": { "model": "claude-haiku-4-5-20251001" } }
}
```

**OpenAI (GPT)**

```bash
export OPENAI_API_KEY=sk-...
```

```json
{
  "models": { "reviewer": "openai" },
  "providers": { "openai": { "model": "gpt-4o-mini" } }
}
```

Per-agent model assignment lets you mix providers — for example, route the security agent to Anthropic Claude and all other agents to the mock during a cost-sensitive pilot.

See [PROVIDERS.md](PROVIDERS.md) for the provider interface and how to register a custom provider.

---

## Running in CI (GitHub Actions)

```yaml
name: Engagement Harness Review
on:
  pull_request:
    branches: [main]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v3
        with:
          version: 8

      - run: pnpm install && pnpm build
        working-directory: /path/to/harness-review

      - name: Run review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          node /path/to/harness-review/packages/cli/dist/bin/engagement-harness.js \
            review --base ${{ github.event.pull_request.base.sha }} \
                   --head ${{ github.event.pull_request.head.sha }}
```

The `review` command exits with code `1` when the decision is `rejected`, integrating naturally with branch protection rules.

---

## Safety Guarantees

- **Never executes code** — diffs are read as text only; no subprocess runs application code
- **Never exposes secrets** — `SecretRedactor` rewrites diff lines and file content before any agent sees them
- **Never auto-fixes or commits** — reports are read-only; the `remediate` command produces plan text only
- **Never posts comments by default** — `config.ci.postComments` defaults to `false`

See [SAFETY.md](SAFETY.md) for the full list of guarantees and redaction pattern details.

---

## Documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System layers, data flow, and package dependency graph |
| [AGENTS.md](AGENTS.md) | All 9 agent IDs, dimensions, finding categories, and when to disable |
| [CONFIG.md](CONFIG.md) | Full configuration schema reference |
| [PROVIDERS.md](PROVIDERS.md) | Provider interface, built-in providers, custom provider registration |
| [SAFETY.md](SAFETY.md) | Safety guarantees and secret redaction patterns |
| [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) | Pre-pilot checklist |

---

## License

MIT
