import { MockProvider } from '@engagement-harness/providers';
import { describe, expect, it } from 'vitest';

import { SREObservabilityAgent } from './sre-observability.js';
import { assertAllValidCandidates, makeBundle } from './test-helpers.js';

describe('SREObservabilityAgent', () => {
  it('returns schema-valid observability candidates', async () => {
    const agent = new SREObservabilityAgent();
    const candidates = await agent.run(makeBundle(), new MockProvider());
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    assertAllValidCandidates(candidates);
    for (const c of candidates) {
      expect(c.dimension).toBe('observability');
      expect(c.sourceAgent).toBe('sre-observability');
      expect(c.modelProvider).toBe('mock');
    }
  });

  it('emits the literal "Dimension: observability" line in its prompt', () => {
    const prompt = new SREObservabilityAgent().promptTemplate(makeBundle());
    expect(prompt).toContain('Dimension: observability');
  });
});
