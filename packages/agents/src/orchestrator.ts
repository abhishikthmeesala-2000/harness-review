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

/**
 * Agent IDs that are part of the canonical lineup (and thus appear in default
 * phase-2 configs) but whose implementations land in phase 7. The orchestrator
 * silently skips these — a warning would just be noise on every Phase 4/5/6
 * run. Anything NOT in this set and not registered as a factory is treated as
 * an unknown ID and gets a chalk warning naming the specific ID.
 */
export const PHASE_LATER_AGENT_IDS: readonly string[] = [
  'data-architecture',
  'sre-observability',
  'design-principles',
  'pr-intent-gap',
  'remediation',
];

const PHASE_LATER_SET = new Set<string>(PHASE_LATER_AGENT_IDS);

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
      if (PHASE_LATER_SET.has(id)) {
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
