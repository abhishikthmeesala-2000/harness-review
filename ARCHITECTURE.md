# Architecture

## Overview

Engagement Harness is a CI-native, multi-agent pull request review platform. It runs a configurable set of specialized analysis agents against a git diff, passes candidate findings through a quality pipeline, and emits structured reports in JSON, Markdown, and HTML formats. The entire system is designed to be safe-by-default: no live provider calls, no merge blocks, and no comment posting unless explicitly configured.

## Layer-by-Layer Walkthrough

**CLI** — The `engagement-harness` binary exposes 11 commands built with Commander. The primary entry point is `review`, which wires all downstream layers together. Supporting commands handle initialization (`init`), environment validation (`doctor`), configuration validation (`config validate`), agent and model inspection (`agents list`, `models list`, `models validate`), report inspection (`report latest`, `report run`, `report list`), CI template generation (`ci templates`), eval harness execution (`eval`), feedback ingestion (`feedback import`), and targeted remediation plan generation (`remediate`). The `--ci` flag on `review` suppresses interactive output and enforces headless-safe behavior.

**Config** — Configuration is loaded from `.engagement-harness/config.json` in the project root and validated at startup using a Zod schema (`ConfigSchema`). Every field has a declared default. The `defaultConfig()` factory produces a fully valid config from just `client.name` and `client.engagement`, routing all agents to the `mock` provider. The `config validate` command surfaces Zod errors in a human-readable format before any review run.

**Git / Diff** — The diff layer shells out to `git diff` between a base and head ref, parses the unified diff into a typed `FileDiff[]` structure with per-hunk line arrays, and extracts PR metadata (title, body) from the ALM platform or local environment variables.

**Context** — The context engine assembles a `ContextBundle` from three sources: the parsed diff, file content entries (up to `context.maxFiles` files, capped at `context.maxTokens` total tokens), and rule entries loaded from `.engagement-harness/rules/*.md`. Paths matching `context.ignoredPaths` patterns are excluded before assembly.

**Redaction** — Before the bundle is handed to any agent, `SecretRedactor.redactBundle()` rewrites all diff lines, file content entries, and PR metadata fields in place, replacing matched secret patterns with `[REDACTED_SECRET]`. Seven regex patterns cover the most common secret shapes. See SAFETY.md for the complete pattern list and known limitations.

**Agents** — The `AgentOrchestrator` instantiates each enabled agent from `config.agents.enabled`, looks up the configured provider via `ModelRouter`, and runs all finding-producing agents concurrently with `Promise.allSettled`. Each agent implements `BaseAgent`, which handles prompt construction, provider calls, JSON extraction, and per-item schema validation. Agents that have no work for the current diff (e.g., `data-architecture` on a diff with no migration files) return an empty prompt, and `BaseAgent.run()` short-circuits without calling the provider. The `remediation` agent is registered in the orchestrator but is a non-finding agent; it is invoked only through the `remediate` CLI command.

**Pipeline** — `FindingPipeline.process()` runs candidates through seven sequential stages: (1) schema validation against `CandidateFindingSchema`, (2) evidence scoring to classify each finding as `none / weak / medium / strong` based on diff citation quality, (3) verification by `Verifier` which cross-checks file and line references against the actual diff, (4) confidence calibration by `ConfidenceScorer` which combines verification status and evidence level into a `[0, 1]` score and upgrades candidates to full `Finding` objects, (5) deduplication by `Deduplicator` which drops findings with identical file+line+category fingerprints, (6) quality gating by `QualityGate` which filters out findings below `review.confidenceThreshold` or `review.severityThreshold`, and (7) policy decision by `PolicyEngine` which maps the surviving finding set to a `pass / warn / block` decision according to the config.

**Reports** — The reports package renders the `PipelineResult` into one or more of three formats: `json` (machine-readable, suitable for downstream tooling), `markdown` (human-readable summary with grouped findings), and `html` (self-contained single-page report). Reports are written to `reports.outputDir` (default `.engagement-harness/reports/`) keyed by a run ID derived from the current timestamp.

**ALM** — The ALM layer is responsible for posting comments and status checks back to the source code host. It is gated behind `config.ci.postComments` (default `false`) and `config.ci.blockOnPolicy` (default `false`). When enabled, an `AlmAdapter` implementation for the configured platform (GitHub, GitLab, Azure DevOps, or Bitbucket) submits the review summary as a PR comment and optionally sets a commit status or check run.

**CI** — The `review --ci` command is the headless entry point for pipeline runs. It produces all configured report formats as artifacts (`config.ci.artifactsOnly` defaults to `true`), exits with code `0` unless `config.ci.blockOnPolicy` is `true` and the policy engine returned `block`. The `ci templates` command generates ready-to-use workflow YAML for GitHub Actions, GitLab CI, Azure Pipelines, and Bitbucket Pipelines.

## Data Flow Diagram

```
git diff
   |
   v
diff parser  ──────────────────────────────────────────────────────────────┐
   |                                                                        |
   v                                                                        |
context engine  (file entries + rule entries + PR metadata)                |
   |                                                                        |
   v                                                                        |
secret redactor  (7 regex patterns → [REDACTED_SECRET])                    |
   |                                                                        |
   v                                                                        |
orchestrator                                                                |
  ├── reviewer agent ──► mock / openai / anthropic                         |
  ├── security agent ──► mock / openai / anthropic                         |
  ├── domain-policy agent ──► mock / openai / anthropic                    |
  ├── testing agent ──► mock / openai / anthropic                          |
  ├── data-architecture agent ──► mock / openai / anthropic                |
  ├── sre-observability agent ──► mock / openai / anthropic                |
  ├── design-principles agent ──► mock / openai / anthropic                |
  └── pr-intent-gap agent ──► mock / openai / anthropic                    |
   |                                                                        |
   v  CandidateFinding[]                                                    |
pipeline                                                                    |
  1. schema validate ◄─────────────────────────────────────────────────────┘
  2. evidence score  (none / weak / medium / strong)
  3. verify          (approved / rejected / pending)
  4. confidence      (0.0 – 1.0)  →  Finding[]
  5. deduplicate     (file + line + category fingerprint)
  6. quality gate    (confidenceThreshold + severityThreshold)
  7. policy decide   (pass / warn / block)
   |
   v  PipelineResult
reports
  ├── report.json
  ├── report.md
  └── report.html
   |
   v
ALM  (postComments=false by default; blockOnPolicy=false by default)
```

## Extensibility Points

**Adding an agent** — Create a class that extends `BaseAgent` from `@engagement-harness/agents`. Implement the three abstract members (`id`, `dimension`, `description`) and `promptTemplate(context)`. The prompt must include a `Dimension: <name>` line so the `MockProvider` fixture map can route to the correct canned response during testing. Register the new class in `AGENT_FACTORIES` in `packages/agents/src/orchestrator.ts`, add its ID to `DEFAULT_AGENT_IDS` in `packages/core/src/schemas/config.ts`, and add a `mock` entry to the default model map. If the agent produces no `CandidateFinding` output (like `remediation`), add its ID to `NON_FINDING_AGENT_IDS` in the orchestrator.

**Adding a provider** — Implement the `Provider` interface from `@engagement-harness/providers` (see PROVIDERS.md for the full interface). The implementation must supply a `readonly name: string` and a `complete(prompt, options?)` method returning `Promise<CompletionResult>`. Register the provider by calling `ProviderRegistry.register(name, factory)` where `factory` is `(config: Config) => Provider`. After registration, agents can be routed to the provider by setting `models.<agentId>: "<name>"` in the project config.

**Adding an ALM platform** — Implement the `AlmAdapter` interface defined in `packages/alm`. Add a case to the ALM adapter factory that matches the new `AlmPlatform` enum value. Add the new platform name to the `AlmPlatformSchema` enum in `packages/core/src/schemas/config.ts`. Users opt in by setting `alm.platform` in their config.
