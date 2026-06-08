# Configuration Reference

Configuration lives in `.engagement-harness/config.json` at the root of the repository being reviewed. Create it with `engagement-harness init` or write it by hand. Validate it at any time with `engagement-harness config validate`.

---

## Full Example

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
      "testing",
      "domain-policy",
      "data-architecture",
      "sre-observability",
      "design-principles",
      "pr-intent-gap",
      "remediation"
    ]
  },
  "models": {
    "security": "anthropic",
    "reviewer": "anthropic"
  },
  "providers": {
    "anthropic": {
      "model": "claude-sonnet-4-6",
      "maxTokens": 4000,
      "temperature": 0.1
    },
    "openai": {
      "model": "gpt-4o"
    }
  },
  "context": {
    "ignoredPaths": ["dist/**", "*.generated.ts", "vendor/**"],
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
    "autoCollect": true,
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

| Field | Type | Required | Description |
|---|---|---|---|
| `client.name` | string | ✅ | Organization or client name. Appears in report headers. |
| `client.engagement` | string | ✅ | Engagement identifier (e.g., `payments-api-2026`). Used in report file names. |

---

### `review`

Controls how the pipeline evaluates and publishes findings.

| Field | Type | Default | Description |
|---|---|---|---|
| `review.confidenceThreshold` | number (0–1) | `0.8` | Minimum confidence score for a finding to pass the quality gate. Lower this during a pilot (e.g., `0.2`) to see more findings; raise it for stricter filtering. |
| `review.severityThreshold` | `low` \| `medium` \| `high` \| `critical` | `low` | Only publish findings at or above this severity. `low` publishes everything; `critical` publishes only critical findings. |
| `review.requireVerifierApproval` | boolean | `true` | If `true`, findings rejected by the heuristic verifier are filtered unless they are `critical` severity or `high` severity with confidence < 0.7. |

**Confidence threshold adjustments by file type** (applied before the threshold check):

| File type | Adjustment |
|---|---|
| Config files | +0.1 (raise the bar) |
| Test files | -0.2 (lower the bar) |
| Frontend files | -0.2 (lower the bar) |
| `high` severity findings | -0.1 (easier to pass) |

---

### `agents`

| Field | Type | Default | Description |
|---|---|---|---|
| `agents.enabled` | string[] | all 9 agents | List of agent IDs to run. Any agent not in this list is skipped entirely. |

Available agent IDs:
```
reviewer  security  testing  domain-policy  data-architecture
sre-observability  design-principles  pr-intent-gap  remediation
```

To disable an agent, remove it from the list. To run a targeted review with only two agents:

```json
{
  "agents": {
    "enabled": ["security", "reviewer"]
  }
}
```

---

### `models`

Routes individual agents to specific AI providers. Any agent not listed falls back to `mock`.

```json
{
  "models": {
    "security": "anthropic",
    "reviewer": "anthropic",
    "testing": "openai"
  }
}
```

Provider names must match a key in `providers`. Use `"mock"` to explicitly force the mock provider.

---

### `providers`

Configures the AI providers available for routing.

#### `providers.anthropic`

| Field | Type | Default | Description |
|---|---|---|---|
| `model` | string | `claude-sonnet-4-6` | Anthropic model ID |
| `maxTokens` | number | `4000` | Maximum tokens in the response (or `budget_tokens + 4000` when extended thinking is active) |
| `temperature` | number | `0.1` | Sampling temperature (0–1). Ignored for agents that use extended thinking. |

Requires: `ANTHROPIC_API_KEY` environment variable.

#### `providers.openai`

| Field | Type | Default | Description |
|---|---|---|---|
| `model` | string | — | OpenAI model ID (e.g., `gpt-4o`) |
| `maxTokens` | number | — | Maximum tokens in the response |
| `temperature` | number | — | Sampling temperature |

Requires: `OPENAI_API_KEY` environment variable.

#### `providers.mock`

No configuration needed. The mock provider returns deterministic fixture responses and makes no API calls. Used by default when no provider is routed for an agent.

---

### `context`

Controls what the `ContextEngine` includes in the analysis bundle.

| Field | Type | Default | Description |
|---|---|---|---|
| `context.ignoredPaths` | string[] | `[]` | Glob patterns (micromatch) for files to exclude from context. Applied to both changed files and imported context files. |
| `context.maxFiles` | integer | `30` | Maximum number of changed files to include. PRs with more files are truncated. |
| `context.maxTokens` | integer | `80000` | Maximum total token budget for the context bundle sent to agents. |

Common ignored paths:

```json
{
  "context": {
    "ignoredPaths": [
      "dist/**",
      "build/**",
      "*.generated.ts",
      "*.generated.js",
      "vendor/**",
      "node_modules/**",
      "coverage/**",
      "*.lock"
    ]
  }
}
```

---

### `ci`

Controls CI-mode behavior when `engagement-harness review --ci` is used.

| Field | Type | Default | Description |
|---|---|---|---|
| `ci.blockOnPolicy` | boolean | `false` | If `true`, the CI step exits with a non-zero code when the policy decision is `blocked_by_policy`. Use this to make failing reviews block PR merges. |
| `ci.postComments` | boolean | `true` | Post inline diff comments and a summary comment to the PR via the ALM API. |
| `ci.artifactsOnly` | boolean | `true` | Write reports to disk as CI artifacts even when `postComments` is `false`. |

---

### `alm`

| Field | Type | Default | Description |
|---|---|---|---|
| `alm.platform` | `github` \| `gitlab` \| `azure-devops` \| `bitbucket` \| `none` | `none` | ALM platform for posting comments. Set to `none` for local runs or when using artifact-only mode. |

---

### `feedback`

| Field | Type | Default | Description |
|---|---|---|---|
| `feedback.enabled` | boolean | `true` | Enable the feedback system. Set to `false` to skip all feedback collection. |
| `feedback.autoCollect` | boolean | `true` | Automatically collect reactions when the generated `feedback-on-merge.yml` workflow runs on PR close. |
| `feedback.retentionDays` | integer | — | Keep only the most recent N days of feedback entries in `metrics.json`. No limit if unset. |

---

### `reports`

| Field | Type | Default | Description |
|---|---|---|---|
| `reports.formats` | `("json" \| "markdown" \| "html")[]` | `["json", "markdown", "html"]` | Report formats to generate after each review. |
| `reports.outputDir` | string | `.engagement-harness/reports` | Directory where report files are written. Relative to the repository root. |

---

## Environment Variables

| Variable | Required by | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | `providers.anthropic` | Anthropic API key |
| `OPENAI_API_KEY` | `providers.openai` | OpenAI API key |
| `GITHUB_TOKEN` | `alm.platform: github` | GitHub token for posting comments. Provided automatically by GitHub Actions. |

---

## Pilot Configuration

For a low-cost pilot with only the two highest-signal agents on Anthropic:

```json
{
  "client": { "name": "Acme Corp", "engagement": "pilot-2026" },
  "review": {
    "confidenceThreshold": 0.2,
    "severityThreshold": "low"
  },
  "agents": {
    "enabled": ["security", "reviewer"]
  },
  "models": {
    "security": "anthropic",
    "reviewer": "anthropic"
  },
  "providers": {
    "anthropic": { "model": "claude-sonnet-4-6" }
  },
  "ci": { "blockOnPolicy": false, "postComments": true }
}
```

Raise `confidenceThreshold` and `severityThreshold` once you have enough feedback to calibrate.
