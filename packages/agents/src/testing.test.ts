import { MockProvider } from '@engagement-harness/providers';
import { describe, expect, it } from 'vitest';

import { TestingAgent } from './testing.js';
import { assertAllValidCandidates, makeBundle } from './test-helpers.js';

describe('TestingAgent', () => {
  it('returns schema-valid testing candidates', async () => {
    const agent = new TestingAgent();
    const candidates = await agent.run(makeBundle(), new MockProvider());
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    assertAllValidCandidates(candidates);
    for (const c of candidates) {
      expect(c.dimension).toBe('testing');
      expect(c.sourceAgent).toBe('testing');
    }
  });

  it('emits the literal "Dimension: testing" line in its prompt', () => {
    expect(new TestingAgent().promptTemplate(makeBundle())).toContain('Dimension: testing');
  });
});
