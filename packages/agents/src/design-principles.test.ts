import type { FileDiff } from '@engagement-harness/core';
import { MockProvider } from '@engagement-harness/providers';
import { describe, expect, it } from 'vitest';

import { DesignPrinciplesAgent } from './design-principles.js';
import { assertAllValidCandidates, makeBundle } from './test-helpers.js';

/** Diff with newLines=25 so the size gate (totalChangedLines >= 20) is satisfied. */
function makeLargeDiff(): FileDiff[] {
  return [
    {
      path: 'src/admin/route.ts',
      status: 'modified',
      hunks: [{ oldStart: 10, oldLines: 25, newStart: 10, newLines: 25, lines: [] }],
    },
  ];
}

describe('DesignPrinciplesAgent', () => {
  it('returns schema-valid design candidates', async () => {
    const agent = new DesignPrinciplesAgent();
    const candidates = await agent.run(makeBundle({ diff: makeLargeDiff() }), new MockProvider());
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    assertAllValidCandidates(candidates);
    for (const c of candidates) {
      expect(c.dimension).toBe('design');
      expect(c.sourceAgent).toBe('design-principles');
      expect(c.modelProvider).toBe('mock');
    }
  });

  it('emits the literal "Dimension: design" line in its prompt', () => {
    const prompt = new DesignPrinciplesAgent().promptTemplate(makeBundle({ diff: makeLargeDiff() }));
    expect(prompt).toContain('Dimension: design');
  });

  it('prompt includes evidence strictness note', () => {
    const prompt = new DesignPrinciplesAgent().promptTemplate(makeBundle({ diff: makeLargeDiff() }));
    expect(prompt.toLowerCase()).toContain('evidence must cite');
  });

  it('returns empty string for diffs under 20 total changed lines', () => {
    // makeBundle() default diff has newLines=5, well under the gate
    const prompt = new DesignPrinciplesAgent().promptTemplate(makeBundle());
    expect(prompt).toBe('');
  });
});
