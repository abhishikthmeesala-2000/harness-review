# Configuration Reference

Configuration is loaded from `.engagement-harness/config.json` at the repository root and validated against `ConfigSchema` (a strict Zod schema) at startup. Unknown top-level keys are rejected. Run `engagement-harness config validate` to surface errors before a review run.

All fields are optional except `client.name` and `client.engagement`. Every other field has a default listed below.

---

## client

Identity fields that label every report produced for this engagement.

| Field | Type | Default | Description |
|---|---|---|---|
| `client.name` | `string` (min 1) | required | Name of the client organization. Appears in report headers. Example: `"Acme Corp"` |
| `client.engagement` | `string` (min 1) | required | Engagement or project identifier. Example: `"payments-platform-2026"` |

---

## review

Controls which findings survive the quality gate.

| Field | Type | Default | Range / Enum | Description |
|---|---|---|---|---|
| `review.confidenceThreshold` | `number` | `0.8` | `0.0` – `1.0` | Findings whose calibrated confidence score falls below this value are dropped by the quality gate. Lower values pass more findings; higher values require stronger evidence. Example: `0.75` |
| `review.severityThreshold` | `string` | `"low"` | `"low"`, `"medium"`, `"high"`, `"critical"` | Findings whose severity is below this level are dropped. `"low"` passes everything; `"high"` passes only high and critical. Example: `"medium"` |
| `review.requireVerifierApproval` | `boolean` | `true` | — | When `true`, findings with verification status `rejected` are excluded from the published set. Set to `false` only in debugging scenarios. Example: `false` |

---

## agents

Controls which agents run during a review.

| Field | Type | Default | Description |
|---|---|---|---|
| `agents.enabled` | `string[]` | `[]` | Array of agent IDs to run. An empty array means no agents run; `defaultConfig()` populates this with all nine built-in IDs. Example: `["reviewer", "security", "testing"]` |

The full list of built-in agent IDs: `reviewer`, `security`, `domain-policy`, `testing`, `data-architecture`, `sre-observability`, `design-principles`, `pr-intent-gap`, `remediation`.

---

## models

Maps each agent ID to a provider name. Entries missing from this map default to `"mock"`.

| Field | Type | Default | Description |
|---|---|---|---|
| `models` | `Record<string, string>` | `{}` | Keys are agent IDs; values are provider names registered in `ProviderRegistry`. Example: `{ "security": "anthropic", "reviewer": "openai" }` |

`defaultConfig()` pre-populates every agent with `"mock"`. To use a live provider for a specific agent, set its entry and configure the matching `providers.*` block.

---

## providers

Provider-level configuration. Only `mock` is enabled by default. `openai` and `anthropic` are optional and only become active when an agent's `models` entry references them.

| Field | Type | Default | Description |
|---|---|---|---|
| `providers.mock` | `object` | `{}` | No configuration options. The mock provider is always registered and requires no credentials. |
| `providers.openai.model` | `string` (min 1) | absent | Required when any agent routes to `"openai"`. Specifies the OpenAI model name. Example: `"gpt-4o"` |
| `providers.anthropic.model` | `string` (min 1) | absent | Required when any agent routes to `"anthropic"`. Specifies the Anthropic model name. Example: `"claude-opus-4-5"` |

---

## context

Controls how much source code context is assembled before agents run.

| Field | Type | Default | Constraints | Description |
|---|---|---|---|---|
| `context.ignoredPaths` | `string[]` | `[]` | — | Glob patterns for paths to exclude from context assembly. Diff lines in these paths are still included; only full-file context entries are excluded. Example: `["dist/**", "*.lock"]` |
| `context.maxFiles` | `integer` | `30` | positive integer | Maximum number of file content entries to include in the context bundle. Files are prioritized by diff relevance. Example: `50` |
| `context.maxTokens` | `integer` | `80000` | positive integer | Maximum total token budget for all file content entries combined. Assembly stops when this limit would be exceeded. Example: `60000` |

---

## ci

Controls behavior in CI (headless) mode.

| Field | Type | Default | Description |
|---|---|---|---|
| `ci.blockOnPolicy` | `boolean` | `false` | When `true`, `review --ci` exits with code `1` if the policy engine returns a `block` decision. Leave `false` to run in audit-only mode without blocking merges. Example: `true` |
| `ci.postComments` | `boolean` | `false` | When `true`, the ALM adapter posts a review summary comment on the PR. Requires `alm.platform` to be set to a value other than `"none"`. Example: `true` |
| `ci.artifactsOnly` | `boolean` | `true` | When `true`, report files are written to `reports.outputDir` but not printed to stdout. Set to `false` to stream the Markdown report to stdout in CI. Example: `false` |

---

## alm

Application Lifecycle Management platform integration.

| Field | Type | Default | Enum | Description |
|---|---|---|---|---|
| `alm.platform` | `string` | `"none"` | `"github"`, `"gitlab"`, `"azure-devops"`, `"bitbucket"`, `"none"` | Target platform for comment posting and status checks. Has no effect unless `ci.postComments` is also `true`. Example: `"github"` |

---

## feedback

Controls the feedback ingestion subsystem.

| Field | Type | Default | Description |
|---|---|---|---|
| `feedback.enabled` | `boolean` | `true` | When `true`, the `feedback import` command processes feedback JSON files and persists them for future use. Set to `false` to disable all feedback ingestion. Example: `false` |

---

## reports

Controls report output.

| Field | Type | Default | Constraints | Description |
|---|---|---|---|---|
| `reports.formats` | `string[]` | `["json", "markdown", "html"]` | at least one of `"json"`, `"markdown"`, `"html"` | Report formats to produce on every run. Example: `["json", "markdown"]` |
| `reports.outputDir` | `string` (min 1) | `".engagement-harness/reports"` | — | Directory where reports are written. Relative to the repository root. The directory is created if it does not exist. Example: `"ci-artifacts/harness"` |

---

## Minimal example config

```json
{
  "client": {
    "name": "Acme Corp",
    "engagement": "payments-platform-2026"
  }
}
```

All other fields take their defaults: all nine agents enabled and routed to mock, confidence threshold 0.8, severity threshold low, CI non-blocking, no ALM posting, reports in all three formats.

## Full example config

```json
{
  "client": {
    "name": "Acme Corp",
    "engagement": "payments-platform-2026"
  },
  "review": {
    "confidenceThreshold": 0.75,
    "severityThreshold": "medium",
    "requireVerifierApproval": true
  },
  "agents": {
    "enabled": ["reviewer", "security", "domain-policy", "testing", "data-architecture",
                "sre-observability", "design-principles", "pr-intent-gap", "remediation"]
  },
  "models": {
    "reviewer": "anthropic",
    "security": "anthropic",
    "domain-policy": "anthropic",
    "testing": "mock",
    "data-architecture": "mock",
    "sre-observability": "mock",
    "design-principles": "mock",
    "pr-intent-gap": "mock",
    "remediation": "mock"
  },
  "providers": {
    "mock": {},
    "anthropic": { "model": "claude-opus-4-5" }
  },
  "context": {
    "ignoredPaths": ["dist/**", "*.lock", "coverage/**"],
    "maxFiles": 40,
    "maxTokens": 80000
  },
  "ci": {
    "blockOnPolicy": false,
    "postComments": false,
    "artifactsOnly": true
  },
  "alm": {
    "platform": "github"
  },
  "feedback": {
    "enabled": true
  },
  "reports": {
    "formats": ["json", "markdown", "html"],
    "outputDir": ".engagement-harness/reports"
  }
}
```
