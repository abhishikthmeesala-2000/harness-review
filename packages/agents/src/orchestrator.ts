import type { CandidateFinding, Config, ContextBundle } from '@engagement-harness/core';
import chalk from 'chalk';

import type { BaseAgent } from './base.js';
import { DomainPolicyAgent } from './domain-policy.js';
import { ReviewerAgent } from './reviewer.js';
import { SecurityAgent } from './security.js';
import { TestingAgent } from './testing.js';
import { ModelRouter } from './router.js';

type AgentFactory = () => BaseAgent;

const AGENT_FACTORIES: Record<string, AgentFactory> = {
  reviewer: () => new ReviewerAgent(),
  security: () => new SecurityAgent(),
  'domain-policy': () => new DomainPolicyAgent(),
  testing: () => new TestingAgent(),
};

// Specialist agents land in phase 7. The verifier is a pipeline component but
// the canonical agent list places it here. We acknowledge these IDs so a phase-2
// default config (which enables all of them) doesn't fail the orchestrator.
const KNOWN_PHASE_LATER_IDS = new Set([
  'data-architecture',
  'sre-observability',
  'design-principles',
  'pr-intent-gap',
  'remediation',
  'verifier',
]);

export interface OrchestratorOptions {
  /** Override the default phase-4 agent factories. Used by tests. */
  factories?: Record<string, AgentFactory>;
}

export class AgentOrchestrator {
  private readonly factories: Record<string, AgentFactory>;

  constructor(options: OrchestratorOptions = {}) {
    this.factories = options.factories ?? AGENT_FACTORIES;
  }

  async run(context: ContextBundle, config: Config): Promise<CandidateFinding[]> {
    const enabled = config.agents.enabled;
    const runnable: BaseAgent[] = [];

    for (const id of enabled) {
      const factory = this.factories[id];
      if (factory) {
        runnable.push(factory());
        continue;
      }
      if (KNOWN_PHASE_LATER_IDS.has(id)) {
        // Quiet skip — these are scheduled for a later phase.
        continue;
      }
      console.warn(chalk.yellow(`[orchestrator] unknown agent "${id}"; skipping`));
    }

    const results = await Promise.allSettled(
      runnable.map(async (agent) => {
        const provider = ModelRouter.route(agent.id, config);
        return agent.run(context, provider);
      }),
    );

    const aggregated: CandidateFinding[] = [];
    results.forEach((result, idx) => {
      const agentId = runnable[idx]?.id ?? 'unknown';
      if (result.status === 'fulfilled') {
        aggregated.push(...result.value);
      } else {
        const reason =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        console.warn(chalk.yellow(`[orchestrator] agent "${agentId}" failed: ${reason}`));
      }
    });
    return aggregated;
  }

  /** Inspect available agents — useful for `agents list` (phase 7). */
  listAgents(): Array<{ id: string; dimension: string; description: string }> {
    return Object.values(this.factories).map((f) => {
      const a = f();
      return { id: a.id, dimension: a.dimension, description: a.description };
    });
  }
}
