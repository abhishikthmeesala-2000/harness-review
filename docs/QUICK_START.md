# Quick Start — 5-Minute Setup

This guide gets Engagement Harness running on a real repository in under five minutes, from clone to your first PR review.

---

## Prerequisites

- Node.js ≥ 20 (`node -v` to check)
- pnpm (`npm install -g pnpm`)
- An Anthropic API key (optional for Step 3 — mock provider works without one)

---

## Step 1 — Clone, Build, and Link

```bash
git clone https://github.com/abhishikthmeesala-2000/harness-review.git
cd harness-review
pnpm install
pnpm build
cd packages/cli && npm link && cd ../..
```

Verify the CLI is available:

```bash
engagement-harness --help
```

> **pnpm v11 note:** `pnpm link --global` (no-argument form) was removed in pnpm v11. Use `npm link` from `packages/cli` as shown above.

---

## Step 2 — Initialize in Your Repository

Navigate to the repository you want to review:

```bash
cd /path/to/your-repo
engagement-harness init
```

The interactive prompt asks for:
- **Client name** — your organization or client name (stored in config for report attribution)
- **Engagement name** — a slug identifying this project (e.g., `payments-api-2026`)
- **Enabled agents** — choose from the 9 available agents (all enabled by default)
- **CI platform** — GitHub, GitLab, Azure DevOps, Bitbucket, or none

For non-interactive use (CI, scripts):

```bash
engagement-harness init --yes
```

`init` creates:
```
your-repo/
└── .engagement-harness/
    ├── config.json          # main configuration
    ├── rules/               # empty directory for domain rules
    └── reports/             # review output written here
```

---

## Step 3 — Run a Dry Review (No API Key Required)

Without any API key, all agents use the built-in `MockProvider`. This validates that the pipeline is wired correctly without making any API calls:

```bash
engagement-harness review --base main --head HEAD
```

You should see output like:

```
✓ Context built: 4 changed files, 127 lines
✓ Pass 1: per-file analysis (4 files × 9 agents)
✓ Pass 2: cross-file integration
✓ Pipeline: 12 candidates → 3 published
  decision: approved_with_warnings
✓ Reports written to .engagement-harness/reports/
```

Run `engagement-harness doctor` to verify the full installation:

```bash
engagement-harness doctor
```

To auto-fix detected issues:

```bash
engagement-harness doctor --fix
```

---

## Step 4 — Add a Real API Key

Export your Anthropic API key and route the two highest-value agents to it:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Edit `.engagement-harness/config.json`:

```json
{
  "models": {
    "security": "anthropic",
    "reviewer": "anthropic"
  },
  "providers": {
    "anthropic": { "model": "claude-sonnet-4-6" }
  }
}
```

This routes `security` and `reviewer` to Anthropic Claude and keeps all other agents on mock. Run the review again:

```bash
engagement-harness review --base main --head HEAD
```

To enable all 9 agents on Anthropic:

```json
{
  "models": {
    "reviewer": "anthropic",
    "security": "anthropic",
    "testing": "anthropic",
    "domain-policy": "anthropic",
    "data-architecture": "anthropic",
    "sre-observability": "anthropic",
    "design-principles": "anthropic",
    "pr-intent-gap": "anthropic",
    "remediation": "anthropic"
  }
}
```

---

## Step 5 — Configure CI

Generate the CI workflow for your platform:

```bash
# GitHub Actions
engagement-harness ci templates --platform github --write

# GitLab CI
engagement-harness ci templates --platform gitlab --write

# Azure DevOps
engagement-harness ci templates --platform azure-devops --write

# Bitbucket Pipelines
engagement-harness ci templates --platform bitbucket --write
```

`--write` saves the template to the correct path in your repository (e.g., `.github/workflows/engagement-harness.yml` for GitHub). Without `--write`, it prints to stdout.

For GitHub, add your API key as a repository secret:

```
GitHub → Settings → Secrets and variables → Actions → New repository secret
Name: ANTHROPIC_API_KEY
Value: sk-ant-...
```

Commit and push. On the next PR, the workflow will run automatically.

---

## Step 6 — View Results

After a review runs:

```bash
# Print the most recent report
engagement-harness report latest

# List all runs
engagement-harness report list

# Print a specific run
engagement-harness report run <run-id>
```

Reports are also written to `.engagement-harness/reports/`:
- `<run-id>.json` — machine-readable
- `<run-id>.md` — human-readable
- `<run-id>.html` — for stakeholders

---

## What's Next

- [docs/CONFIGURATION.md](CONFIGURATION.md) — Full config field reference
- [docs/AGENTS.md](AGENTS.md) — What each agent checks and how to tune it
- [docs/CUSTOM_PROMPTS.md](CUSTOM_PROMPTS.md) — Add client-specific domain rules
- [docs/FEEDBACK_SYSTEM.md](FEEDBACK_SYSTEM.md) — How reactions improve accuracy over time
- [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) — Common errors and exact fixes

---

## Cleanup

To remove Engagement Harness configuration from a repository:

```bash
engagement-harness uninit
```

This removes `.engagement-harness/` and the generated CI workflow files. Pass `--yes` to skip confirmation prompts.
