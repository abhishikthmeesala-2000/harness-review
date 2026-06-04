# Configuration Reference

Configuration lives in `.engagement-harness/config.json` at the root of the repository being reviewed. Create it with `engagement-harness init` or write it by hand.

---

## Full Annotated Example

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
      "reviewer",
      "security",
      "domain-policy",
      "testing",
      "data-architecture",
      "sre-observability",
      "design-principles",
      "pr-intent-gap",
      "remediation"
    ]
  },
  "models": {
    "security": "anthropic",
    "reviewer": "anthropic",
    "domain-policy": "anthropic",
    "testing": "anthropic",
    "data-architecture": "anthropic",
    "sre-observability": "anthropic",
    "design-principles": "anthropic",
    "pr-intent-gap": "anthropic",
    "remediation": "anthropic"
  },
  "providers": {
    "mock": {},
    "anthropic": { "model": "claude-sonnet-4-6" },
    "openai": { "model": "gpt-4o-mini" }
  },
  "context": {
    "ignoredPaths": [
      "**/*.generated.ts",
      "dist/**",
      "node_modules/**",
      "coverage/**"
    ],
    "maxFiles": 30,
    "maxTokens": 80000
  },
  "ci": {
    "blockOnPolicy": false,
    "postComments": true,
    "artifactsOnly": true
  },
  "alm": {
    "platform": "github"
  },
  "feedback": {
    "enabled": true,
    "autoCollect": false,
    "collectionSchedule": "0 9 * * 1",
    "retentionDays": 90
  },
  "reports": {
    "formats": ["json", "markdown", "html"],
    "outputDir": ".engagement-harness/reports"
  }
}
```

---

## Field Reference

### `client` (required)

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Human-readable client or organization name. Appears in reports. |
| `engagement` | `string` | Short identifier for this engagement (e.g., `payments-platform-2026`). Appears in reports and report directory names. |

Both fields are required. The config will fail validation without them.

---

### `review`

Controls the quality gate and policy engine.

| Field | Type | Default | Description |
|---|---|---|---|
| `confidenceThreshold` | `number` (0–1) | `0.8` | Findings with confidence below this value are filtered out by the quality gate. Raise to reduce noise; lower to surface more findings. |
| `severityThreshold` | `"low"` \| `"medium"` \| `"high"` \| `"critical"` | `"low"` | Minimum severity to pass the quality gate. `"medium"` filters out all low-severity findings. |
| `requireVerifierApproval` | `boolean` | `true` | When `true`, findings that fail the heuristic verifier are rejected even if their confidence is above threshold. |

---

### `agents`

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `string[]` | `[]` | List of agent IDs to run. An empty array runs no agents. Use `engagement-harness agents list` to see all valid IDs. |

Valid agent IDs: `reviewer`, `security`, `domain-policy`, `testing`, `data-architecture`, `sre-observability`, `design-principles`, `pr-intent-gap`, `remediation`.

---

### `models`

A map from agent ID to provider name. Any agent ID not listed here uses `MockProvider` by default.

```json
{
  "models": {
    "security": "anthropic",
    "reviewer": "openai"
  }
}
```

Valid provider names: `mock`, `anthropic`, `openai`.

---

### `providers`

Configuration for each provider. `mock` is always available and requires no configuration. `openai` and `anthropic` are optional; if configured, they require the corresponding environment variable.

| Provider | Environment Variable | Default Model |
|---|---|---|
| `mock` | none required | — |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |

```json
{
  "providers": {
    "mock": {},
    "anthropic": { "model": "claude-sonnet-4-6" },
    "openai": { "model": "gpt-4o-mini" }
  }
}
```

---

### `context`

Controls what the ContextEngine includes in each agent prompt.

| Field | Type | Default | Description |
|---|---|---|---|
| `ignoredPaths` | `string[]` | `[]` | Glob patterns (micromatch). Files matching any pattern are excluded from the diff and context. Generated files, lockfiles, and build artifacts should go here. |
| `maxFiles` | `integer` | `30` | Maximum number of file entries in the ContextBundle. Entries are prioritized: changed files (100) > rules (90) > tests (80) > importers (70) > imports (60). |
| `maxTokens` | `integer` | `80000` | Maximum total token budget for context entries. Token count is estimated at ~4 characters per token. |

---

### `ci`

Controls CI integration behavior.

| Field | Type | Default | Description |
|---|---|---|---|
| `blockOnPolicy` | `boolean` | `false` | When `true`, the review command exits with code 1 if the policy decision is `blocked_by_policy`. Use with branch protection rules to enforce blocking. |
| `postComments` | `boolean` | `true` | When `true` and a GitHub token is available, publish each finding as a PR comment. |
| `artifactsOnly` | `boolean` | `true` | When `true`, report files are written as CI artifacts but not posted. Combine with `postComments: true` to do both. |

---

### `alm`

Application Lifecycle Management platform integration.

| Field | Type | Default | Description |
|---|---|---|---|
| `platform` | `"github"` \| `"gitlab"` \| `"azure-devops"` \| `"bitbucket"` \| `"none"` | `"none"` | The ALM platform to use for posting summaries and check status updates. |

---

### `feedback`

Feedback collection settings.

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Enable the feedback collection system. |
| `autoCollect` | `boolean` | `true` | Automatically collect reactions after each review run. |
| `collectionSchedule` | `string` (cron) | — | Cron expression for the scheduled sweep workflow (e.g., `"0 9 * * 1"` for Mondays at 9 AM). |
| `retentionDays` | `integer` | — | How many days of feedback entries to retain in `metrics.json`. Older entries are pruned. |

---

### `reports`

| Field | Type | Default | Description |
|---|---|---|---|
| `formats` | `("json" \| "markdown" \| "html")[]` | `["json", "markdown", "html"]` | Which report formats to generate. At least one format is required. |
| `outputDir` | `string` | `".engagement-harness/reports"` | Directory where run subdirectories are written. Relative paths are resolved from the repository root. |

---

## Common Configuration Patterns

### Security-only (low cost)

Run only the `security` agent with Anthropic. Useful during initial pilot to validate findings quality before enabling all agents.

```json
{
  "client": { "name": "Acme Corp", "engagement": "pilot" },
  "agents": { "enabled": ["security"] },
  "models": { "security": "anthropic" },
  "providers": {
    "mock": {},
    "anthropic": { "model": "claude-sonnet-4-6" }
  }
}
```

### Balanced — security and correctness only

```json
{
  "client": { "name": "Acme Corp", "engagement": "phase-2" },
  "agents": {
    "enabled": ["security", "reviewer", "testing"]
  },
  "models": {
    "security": "anthropic",
    "reviewer": "anthropic",
    "testing": "anthropic"
  },
  "providers": {
    "mock": {},
    "anthropic": { "model": "claude-sonnet-4-6" }
  },
  "review": {
    "confidenceThreshold": 0.75
  }
}
```

### Comprehensive — all agents, CI blocking enabled

```json
{
  "client": { "name": "Acme Corp", "engagement": "full-review" },
  "agents": {
    "enabled": [
      "reviewer", "security", "domain-policy", "testing",
      "data-architecture", "sre-observability", "design-principles",
      "pr-intent-gap", "remediation"
    ]
  },
  "models": {
    "reviewer": "anthropic",
    "security": "anthropic",
    "domain-policy": "anthropic",
    "testing": "anthropic",
    "data-architecture": "anthropic",
    "sre-observability": "anthropic",
    "design-principles": "anthropic",
    "pr-intent-gap": "anthropic",
    "remediation": "anthropic"
  },
  "providers": {
    "mock": {},
    "anthropic": { "model": "claude-sonnet-4-6" }
  },
  "ci": {
    "blockOnPolicy": true,
    "postComments": true,
    "artifactsOnly": true
  },
  "alm": { "platform": "github" },
  "review": {
    "confidenceThreshold": 0.8,
    "severityThreshold": "medium",
    "requireVerifierApproval": true
  }
}
```

---

## Cost Optimization

- **Start with mock** — no API calls, free. Validates the pipeline end-to-end.
- **Enable one agent at a time** — start with `security`, confirm finding quality, then expand.
- **Set `severityThreshold: "medium"`** — eliminates low-severity findings before they consume tokens in downstream processing.
- **Use `context.maxFiles`** — default 30 files per review. Lower to 15–20 for large monorepos where most changed files are unrelated to the PR's purpose.
- **Scope `ignoredPaths`** — exclude generated files, lockfiles (`pnpm-lock.yaml`, `package-lock.json`), migration snapshots, and build artifacts. Each excluded file saves tokens across all nine agent prompts.

Validate your config at any time:

```bash
engagement-harness config validate
```
