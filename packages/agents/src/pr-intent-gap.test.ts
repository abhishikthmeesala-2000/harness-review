import { MockProvider } from '@engagement-harness/providers';
import { describe, expect, it } from 'vitest';

import { PRIntentGapAgent } from './pr-intent-gap.js';
import { assertAllValidCandidates, makeBundle } from './test-helpers.js';

describe('PRIntentGapAgent', () => {
  it('returns [] when no prMetadata provided', async () => {
    const agent = new PRIntentGapAgent();
    const candidates = await agent.run(makeBundle(), new MockProvider());
    expect(candidates).toEqual([]);
  });

  it('returns empty prompt when prMetadata has no title or body', () => {
    const agent = new PRIntentGapAgent();
    expect(agent.promptTemplate(makeBundle({ prMetadata: {} }))).toBe('');
    expect(agent.promptTemplate(makeBundle())).toBe('');
  });

  it('returns schema-valid intent-gap candidates when prMetadata is provided', async () => {
    const agent = new PRIntentGapAgent();
    const bundle = makeBundle({
      prMetadata: { title: 'Read-only refactor', body: 'No writes introduced.' },
    });
    const candidates = await agent.run(bundle, new MockProvider());
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    assertAllValidCandidates(candidates);
    for (const c of candidates) {
      expect(c.dimension).toBe('intent-gap');
      expect(c.sourceAgent).toBe('pr-intent-gap');
    }
  });

  it('emits "Dimension: intent-gap" and PR title in prompt', () => {
    const agent = new PRIntentGapAgent();
    const prompt = agent.promptTemplate(
      makeBundle({ prMetadata: { title: 'Chore: cleanup', body: 'Minor refactor.' } }),
    );
    expect(prompt).toContain('Dimension: intent-gap');
    expect(prompt).toContain('Chore: cleanup');
  });
});
