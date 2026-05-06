import type { CandidateFinding, Config, ContextBundle } from '@engagement-harness/core';
import chalk from 'chalk';

import type { BaseAgent } from './base.js';
import { DataArchitectureAgent } from './data-architecture.js';
import { DesignPrinciplesAgent } from './design-principles.js';
import { DomainPolicyAgent } from './domain-policy.js';
import { PRIntentGapAgent } from './pr-intent-gap.js';
import { RemediationAgent } from './remediation.js';
import { ReviewerAgent } from './reviewer.js';
import { SecurityAgent } from './security.js';
import { SREObservabilityAgent } from './sre-observability.js';
import { TestingAgent } from './testing.js';
import { ModelRouter } from './router.js';

type AgentFactory = () => BaseAgent;

const AGENT_FACTORIES: Record<string, AgentFactory> = {
  reviewer: () => new ReviewerAgent(),
  security: () => new SecurityAgent(),
  'domain-policy': () => new DomainPolicyAgent(),
  testing: () => new TestingAgent(),
  'data-architecture': () => new DataArchitectureAgent(),
  'sre-observability': () => new SREObservabilityAgent(),
  'design-principles': () => new DesignPrinciplesAgent(),
  'pr-intent-gap': () => new PRIntentGapAgent(),
  remediation: () => new RemediationAgent(),
};

/** All phase-later IDs have landed in phase 7 — nothing left to defer. */
export const PHASE_LATER_AGENT_IDS: readonly string[] = [];

const PHASE_LATER_SET = new Set<string>(PHASE_LATER_AGENT_IDS);

/** Agent IDs that register in factories but produce no findings — skip in run(). */
export const NON_FINDING_AGENT_IDS = new Set<string>(['remediation']);

export interface OrchestratorOptions {
  /** Override the default agent factories. Used by tests. */
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
        if (NON_FINDING_AGENT_IDS.has(id)) continue; // quiet skip — not a finding producer
        runnable.push(factory());
        continue;
      }
      if (PHASE_LATER_SET.has(id)) {
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

  /** Inspect available agents — useful for `agents list`. */
  listAgents(): Array<{ id: string; dimension: string; description: string }> {
    return Object.values(this.factories).map((f) => {
      const a = f();
      return { id: a.id, dimension: a.dimension, description: a.description };
    });
  }
}
