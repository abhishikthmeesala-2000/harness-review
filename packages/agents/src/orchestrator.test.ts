import { ProviderRegistry } from '@engagement-harness/providers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentOrchestrator } from './orchestrator.js';
import { makeBundle, makeConfig, makeRuleEntry } from './test-helpers.js';

afterEach(() => {
  ProviderRegistry.reset();
  vi.restoreAllMocks();
});

describe('AgentOrchestrator.run', () => {
  it('runs the four phase-4 agents in parallel and aggregates candidates', async () => {
    const orchestrator = new AgentOrchestrator();
    const bundle = makeBundle({ entries: [makeRuleEntry()] });
    const config = makeConfig({
      agents: { enabled: ['reviewer', 'security', 'domain-policy', 'testing'] },
    });
    const candidates = await orchestrator.run(bundle, config);
    const dimensions = new Set(candidates.map((c) => c.dimension));
    expect(dimensions.has('correctness')).toBe(true);
    expect(dimensions.has('security')).toBe(true);
    expect(dimensions.has('testing')).toBe(true);
    expect(dimensions.has('domain-policy')).toBe(true);
  });

  it('quietly skips known phase-later agents (data-architecture, etc.)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const orchestrator = new AgentOrchestrator();
    const bundle = makeBundle();
    const config = makeConfig({
      agents: { enabled: ['reviewer', 'data-architecture', 'sre-observability'] },
    });
    await orchestrator.run(bundle, config);
    // No warning should fire for the known later-phase ids.
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('warns and skips unknown agent IDs without failing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const orchestrator = new AgentOrchestrator();
    const config = makeConfig({ agents: { enabled: ['reviewer', 'totally-made-up'] } });
    const candidates = await orchestrator.run(makeBundle(), config);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it('survives a failing agent and still returns results from the others', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Register a bomb provider; route the security agent to it.
    ProviderRegistry.register('bomb', () => ({
      name: 'bomb',
      complete: async () => {
        throw new Error('detonated');
      },
    }));
    const config = makeConfig({
      agents: { enabled: ['reviewer', 'security'] },
      models: { security: 'bomb' },
    });
    const orchestrator = new AgentOrchestrator();
    const candidates = await orchestrator.run(makeBundle(), config);
    // Reviewer should still produce a candidate; security should drop out via BaseAgent's catch.
    expect(candidates.some((c) => c.dimension === 'correctness')).toBe(true);
    expect(candidates.some((c) => c.dimension === 'security')).toBe(false);
    // BaseAgent logged the provider error.
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('listAgents reports id, dimension, description for each phase-4 agent', () => {
    const list = new AgentOrchestrator().listAgents();
    const ids = list.map((a) => a.id).sort();
    expect(ids).toEqual(['domain-policy', 'reviewer', 'security', 'testing']);
    for (const a of list) {
      expect(a.dimension).toBeTruthy();
      expect(a.description).toBeTruthy();
    }
  });
});
