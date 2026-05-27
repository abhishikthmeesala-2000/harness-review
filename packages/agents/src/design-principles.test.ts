import { MockProvider } from '@engagement-harness/providers';
import { describe, expect, it } from 'vitest';

import { DesignPrinciplesAgent } from './design-principles.js';
import { assertAllValidCandidates, makeBundle } from './test-helpers.js';

describe('DesignPrinciplesAgent', () => {
  it('returns schema-valid design candidates', async () => {
    const agent = new DesignPrinciplesAgent();
    const candidates = await agent.run(makeBundle(), new MockProvider());
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    assertAllValidCandidates(candidates);
    for (const c of candidates) {
      expect(c.dimension).toBe('design');
      expect(c.sourceAgent).toBe('design-principles');
      expect(c.modelProvider).toBe('mock');
    }
  });

  it('emits the literal "Dimension: design" line in its prompt', () => {
    const prompt = new DesignPrinciplesAgent().promptTemplate(makeBundle());
    expect(prompt).toContain('Dimension: design');
  });

  it('prompt includes evidence strictness note', () => {
    const prompt = new DesignPrinciplesAgent().promptTemplate(makeBundle());
    expect(prompt.toLowerCase()).toContain('evidence must cite');
  });
});
