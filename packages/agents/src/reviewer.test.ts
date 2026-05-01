import { MockProvider } from '@engagement-harness/providers';
import { describe, expect, it } from 'vitest';

import { ReviewerAgent } from './reviewer.js';
import { assertAllValidCandidates, makeBundle } from './test-helpers.js';

describe('ReviewerAgent', () => {
  it('returns at least one schema-valid candidate tagged with the agent id', async () => {
    const agent = new ReviewerAgent();
    const candidates = await agent.run(makeBundle(), new MockProvider());
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    assertAllValidCandidates(candidates);
    for (const c of candidates) {
      expect(c.dimension).toBe('correctness');
      expect(c.sourceAgent).toBe('reviewer');
      expect(c.modelProvider).toBe('mock');
    }
  });

  it('emits the literal "Dimension: correctness" line in its prompt', () => {
    const agent = new ReviewerAgent();
    const prompt = agent.promptTemplate(makeBundle());
    expect(prompt).toContain('Dimension: correctness');
  });
});
