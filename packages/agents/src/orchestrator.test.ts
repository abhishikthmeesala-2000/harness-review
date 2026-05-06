import { ProviderRegistry } from '@engagement-harness/providers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentOrchestrator, NON_FINDING_AGENT_IDS, PHASE_LATER_AGENT_IDS } from './orchestrator.js';
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

  it('PHASE_LATER_AGENT_IDS is now empty — all phase-7 agents are implemented', () => {
    expect([...PHASE_LATER_AGENT_IDS]).toEqual([]);
  });

  it('silently skips non-finding agents without warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const orchestrator = new AgentOrchestrator();
    const config = makeConfig({
      agents: { enabled: ['reviewer', ...NON_FINDING_AGENT_IDS] },
    });
    const candidates = await orchestrator.run(makeBundle(), config);
    expect(warnSpy).not.toHaveBeenCalled();
    // Reviewer still ran — the silent skip didn't short-circuit the orchestrator.
    expect(candidates.some((c) => c.dimension === 'correctness')).toBe(true);
    warnSpy.mockRestore();
  });

  it('warns once per unknown agent ID, names it in the message, and continues running known agents', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const orchestrator = new AgentOrchestrator();
    const config = makeConfig({
      agents: { enabled: ['reviewer', 'totally-made-up', 'verifier'] },
    });
    const candidates = await orchestrator.run(makeBundle(), config);
    // Reviewer ran despite the two bogus IDs.
    expect(candidates.some((c) => c.dimension === 'correctness')).toBe(true);
    // Two warnings — one per unknown ID — and each names the offending ID.
    expect(warnSpy).toHaveBeenCalledTimes(2);
    const messages = warnSpy.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes('totally-made-up'))).toBe(true);
    expect(messages.some((m) => m.includes('verifier'))).toBe(true);
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

  it('listAgents reports id, dimension, description for all 9 agents', () => {
    const list = new AgentOrchestrator().listAgents();
    const ids = list.map((a) => a.id).sort();
    expect(ids).toEqual([
      'data-architecture',
      'design-principles',
      'domain-policy',
      'pr-intent-gap',
      'remediation',
      'reviewer',
      'security',
      'sre-observability',
      'testing',
    ]);
    for (const a of list) {
      expect(a.dimension).toBeTruthy();
      expect(a.description).toBeTruthy();
    }
  });
});
