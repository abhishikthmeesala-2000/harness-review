# Quick Start — 5-Minute Setup

This guide gets Engagement Harness running on a real repository in under five minutes.

---

## Prerequisites

- **Node.js ≥ 20** — check with `node --version`
- **pnpm** — install with `npm install -g pnpm`
- **Git** — the review command reads the local git diff
- **GitHub repository** — for CI and feedback collection (local-only mode works without it)

---

## Step 1: Clone and Build

```bash
git clone https://github.com/abhishikthmeesala-2000/harness-review.git
cd harness-review
pnpm install
pnpm build
```

This compiles all nine packages using TypeScript project references. Build output lands in each package's `dist/` directory.

### Link the CLI globally

```bash
cd packages/cli
npm link
cd ../..
```

Alternatively, invoke the CLI directly without global linking:
```bash
node /path/to/harness-review/packages/cli/dist/bin/engagement-harness.js <command>
```

---

## Step 2: Initialize a Repository

Run `init` inside the repository you want to review:

```bash
cd /path/to/your-client-repo
engagement-harness init
```

The interactive prompts ask for:
1. **Client name** — the organization or project name (e.g., `Acme Corp`)
2. **Engagement ID** — a short slug identifying this engagement (e.g., `payments-platform-2026`)
3. **CI platform** — `github`, `gitlab`, `azure-devops`, `bitbucket`, or `none`
4. Which agents to enable (defaults to all nine)

`init` creates:
- `.engagement-harness/config.json` — configuration file
- `.github/workflows/engagement-harness.yml` — PR review workflow
- `.github/workflows/feedback-on-merge.yml` — reaction collection on merge
- `.github/workflows/collect-feedback.yml` — weekly scheduled sweep

Use `-y` to skip prompts and accept all detected defaults:

```bash
engagement-harness init -y
```

---

## Step 3: Add an API Key

All agents default to the built-in `MockProvider`, which returns deterministic canned findings with no API call. To use real AI providers, export an API key and update `config.json`.

**Anthropic Claude (recommended):**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

In `.engagement-harness/config.json`:

```json
{
  "client": { "name": "Acme Corp", "engagement": "payments-platform-2026" },
  "models": {
    "security": "anthropic",
    "reviewer": "anthropic"
  },
  "providers": {
    "anthropic": { "model": "claude-sonnet-4-6" }
  }
}
```

**OpenAI GPT:**

```bash
export OPENAI_API_KEY=sk-...
```

```json
{
  "providers": {
    "openai": { "model": "gpt-4o-mini" }
  }
}
```

You can mix providers — route `security` to Anthropic and everything else to the mock to minimize costs during a trial.

---

## Step 4: Verify the Setup

```bash
engagement-harness doctor
```

This checks:
- `.engagement-harness/config.json` exists and validates against the schema
- All enabled agent IDs are registered
- Configured providers are reachable (if API keys are present)

Expected output:

```
✓ Config found at .engagement-harness/config.json
✓ Config is valid
✓ 9 agents enabled
✓ Provider 'anthropic' reachable
```

---

## Step 5: Run Your First Review

```bash
engagement-harness review --base main --head HEAD
```

Or compare any two refs:

```bash
engagement-harness review --base origin/main --head feature/my-feature
```

### What to Expect

Engagement Harness prints a summary to stdout and writes reports to `.engagement-harness/reports/run-<timestamp>/`:

```
Engagement Harness Review
Decision:   needs_manual_review
Confidence: 76%
Findings:   3 published / 12 rejected

TOP FINDINGS
  [HIGH] src/auth.ts:42   Missing authorization check on /admin route
  [MEDIUM] src/db.ts:17   Non-nullable column added without DEFAULT value
  [LOW] src/api.ts:88     Error response logged without request context
```

Reports are available in three formats:

```bash
engagement-harness report latest          # print most recent to stdout
ls .engagement-harness/reports/           # list all runs
```

---

## Step 6: Open a Pull Request

Once configured, push the generated workflow files and open a PR. The `engagement-harness.yml` workflow triggers automatically and posts findings as PR comments. Developers react with emoji to provide feedback, which is collected by the `feedback-on-merge.yml` workflow when the PR is merged.

---

## Next Steps

- [docs/CONFIGURATION.md](CONFIGURATION.md) — tune confidence thresholds, enable/disable agents, configure CI blocking
- [docs/AGENTS.md](AGENTS.md) — understand what each agent checks and how to reduce false positives
- [docs/FEEDBACK_SYSTEM.md](FEEDBACK_SYSTEM.md) — interpret feedback metrics and improve agent accuracy over time
- [docs/CUSTOM_PROMPTS.md](CUSTOM_PROMPTS.md) — add client-specific rules for the `domain-policy` agent
