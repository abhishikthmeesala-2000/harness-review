# @engagement-harness/agents

Nine specialized AI review agents plus the orchestrator and model router for Engagement Harness.

---

## Key Modules

| File | Purpose |
|---|---|
| `src/base.ts` | `BaseAgent` abstract class — prompt execution, JSON parsing, schema validation |
| `src/orchestrator.ts` | `AgentOrchestrator` — runs all enabled agents concurrently |
| `src/router.ts` | `ModelRouter` — maps agent IDs to provider names from config |
| `src/prompt-utils.ts` | `renderDiffSummary`, `renderFileContext`, `renderFunctionContext`, `FINDING_SCHEMA_BLOCK` |
| `src/reviewer.ts` | `ReviewerAgent` — correctness dimension |
| `src/security.ts` | `SecurityAgent` — security dimension |
| `src/testing.ts` | `TestingAgent` — testing dimension |
| `src/domain-policy.ts` | `DomainPolicyAgent` — domain-policy dimension |
| `src/data-architecture.ts` | `DataArchitectureAgent` — data dimension |
| `src/sre-observability.ts` | `SREObservabilityAgent` — observability dimension |
| `src/design-principles.ts` | `DesignPrinciplesAgent` — design dimension |
| `src/pr-intent-gap.ts` | `PRIntentGapAgent` — intent-gap dimension |
| `src/remediation.ts` | `RemediationAgent` + `RemediationPlanSchema` — generates fix plans on demand |

---

## Key Exported Types and Classes

```typescript
// Base class
export abstract class BaseAgent {
  abstract readonly id: string;
  abstract readonly dimension: string;
  abstract readonly description: string;
  abstract promptTemplate(context: ContextBundle): string;
  async run(context: ContextBundle, provider: Provider): Promise<CandidateFinding[]>;
}

// Orchestrator
export class AgentOrchestrator {
  async run(bundle: ContextBundle, config: Config): Promise<CandidateFinding[]>;
}

// Router
export class ModelRouter {
  resolve(agentId: string, config: Config): string; // returns provider name
}

// Remediation
export const RemediationPlanSchema: z.ZodObject<...>;
export type RemediationPlan = {
  findingId: string;
  plan: string;
  suggestedPatch?: string;
  testRecommendations: string[];
  estimatedEffort: 'trivial' | 'small' | 'medium' | 'large';
};
```

---

## Usage

```typescript
import { AgentOrchestrator } from '@engagement-harness/agents';
import type { ContextBundle, Config } from '@engagement-harness/core';

const orchestrator = new AgentOrchestrator();
const candidates = await orchestrator.run(bundle, config);
// candidates: CandidateFinding[] from all enabled agents
```

The orchestrator uses `Promise.allSettled` — a single agent failure does not stop other agents from running. Failed agents log a warning and contribute zero findings.

---

## Agent Auto-Skip Behavior

| Agent | Skips when |
|---|---|
| `domain-policy` | No rule entries in `ContextBundle` match changed paths |
| `data-architecture` | No paths matching `/migration\|schema\|models\/\|db\/\|\.sql$/i` in diff |
| `pr-intent-gap` | No `prMetadata.title` and no `prMetadata.body` |
| `remediation` | Always (use `RemediationAgent.remediate()` directly, not via orchestrator) |

---

## Dependencies

- `@engagement-harness/core` — `ContextBundle`, `CandidateFinding`, `Config`
- `@engagement-harness/providers` — `Provider` interface
- `chalk` — colored console warnings
- `zod` — `RemediationPlanSchema` validation
