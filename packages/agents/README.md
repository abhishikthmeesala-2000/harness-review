# @engagement-harness/agents

Nine specialized AI review agents plus the orchestrator and model router for Engagement Harness.

---

## Installation

```bash
pnpm add @engagement-harness/agents
```

---

## Agents

| Agent ID | Dimension | Short-circuits when |
|---|---|---|
| `reviewer` | `correctness` | Never |
| `security` | `security` | Never |
| `testing` | `testing` | Never |
| `domain-policy` | `domain-policy` | No rule files match diff |
| `data-architecture` | `data` | No migration/schema/ORM paths in diff |
| `sre-observability` | `observability` | Never |
| `design-principles` | `design` | Changed lines < 20 |
| `pr-intent-gap` | `intent-gap` | No PR metadata supplied |
| `remediation` | `remediation` | — (non-finding agent) |

---

## AgentOrchestrator

Runs all enabled agents across two passes and returns raw `CandidateFinding[]`.

```typescript
import { AgentOrchestrator } from '@engagement-harness/agents';
import { ProviderRegistry } from '@engagement-harness/providers';

const registry = new ProviderRegistry();
registry.register('anthropic', anthropicProvider);
registry.register('mock', mockProvider);

const orchestrator = new AgentOrchestrator({ config, registry });
const findings = await orchestrator.run(contextBundle);
```

The orchestrator runs:
1. **Pass 1 — per-file** (`PerFileOrchestrator`): all enabled agents × each changed file in parallel. Findings tagged `pass: "local"`.
2. **Pass 2 — cross-file** (`CrossFileReviewer`): all files in one prompt, skipped if only 1 file changed. Findings tagged `pass: "integration"`.

---

## ModelRouter

Resolves which provider to use for a given agent ID.

```typescript
import { ModelRouter } from '@engagement-harness/agents';

const router = new ModelRouter(registry);
const provider = router.route('security', config);
// Uses config.models['security'] if set, falls back to 'mock'
```

---

## Introspection

```typescript
import { listAgents, DEFAULT_AGENT_IDS } from '@engagement-harness/agents';

// All available agent IDs
console.log(DEFAULT_AGENT_IDS);
// ['reviewer', 'security', 'testing', 'domain-policy', 'data-architecture',
//  'sre-observability', 'design-principles', 'pr-intent-gap', 'remediation']

// Agent metadata (id, dimension, description)
const agents = listAgents();
```

---

## Remediation Agent

The `remediation` agent generates BEFORE/AFTER code patches for an existing finding. It is not part of the normal orchestrator finding pipeline — invoke it separately:

```typescript
import { RemediationAgent } from '@engagement-harness/agents';

const agent = new RemediationAgent(config);
const patch = await agent.remediate(finding, contextBundle, provider);
// patch: { before, after, effort, testRecommendation, notes }
```

The agent calls `detectTechStack(contextBundle)` to determine the repository's language, framework, ORM, test runner, and package manager before generating the patch.

---

## Adding a New Agent

1. Create `packages/agents/src/my-agent.ts` extending `BaseAgent`
2. Implement `getAgentDimension(): string` and `buildPrompt(context): string | null`
3. Add to `AGENT_FACTORIES` in `orchestrator.ts`: `'my-agent': (config) => new MyAgent(config)`
4. Add to `DEFAULT_AGENT_IDS` array

Return `null` from `buildPrompt()` to short-circuit and skip the API call.

---

## Extended Thinking

Two agents use Anthropic's extended thinking:

```typescript
// In reviewer.ts
return this.provider.complete(prompt, {
  system: REVIEWER_SYSTEM_PROMPT,
  extendedThinking: 8000,  // 8000-token thinking budget
});

// In security.ts
return this.provider.complete(prompt, {
  system: SECURITY_SYSTEM_PROMPT,
  extendedThinking: 10000, // 10000-token thinking budget
});
```
