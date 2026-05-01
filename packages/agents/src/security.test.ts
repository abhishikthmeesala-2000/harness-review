import { MockProvider } from '@engagement-harness/providers';
import { describe, expect, it } from 'vitest';

import { SecurityAgent } from './security.js';
import { assertAllValidCandidates, makeBundle } from './test-helpers.js';

describe('SecurityAgent', () => {
  it('returns schema-valid security candidates', async () => {
    const agent = new SecurityAgent();
    const candidates = await agent.run(makeBundle(), new MockProvider());
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    assertAllValidCandidates(candidates);
    for (const c of candidates) {
      expect(c.dimension).toBe('security');
      expect(c.sourceAgent).toBe('security');
      expect(c.modelProvider).toBe('mock');
    }
  });

  it('emits the literal "Dimension: security" line in its prompt', () => {
    const prompt = new SecurityAgent().promptTemplate(makeBundle());
    expect(prompt).toContain('Dimension: security');
  });
});
