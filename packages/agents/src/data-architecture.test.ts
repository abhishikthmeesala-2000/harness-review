import { MockProvider } from '@engagement-harness/providers';
import { describe, expect, it } from 'vitest';

import { DataArchitectureAgent } from './data-architecture.js';
import { assertAllValidCandidates, makeBundle } from './test-helpers.js';
import type { FileDiff } from '@engagement-harness/core';

function makeDbDiff(): FileDiff[] {
  return [
    {
      path: 'db/migrations/001_add_payments.sql',
      status: 'added',
      hunks: [
        {
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 3,
          lines: [
            {
              type: 'added',
              content: 'ALTER TABLE payments ADD COLUMN amount_cents INTEGER NOT NULL;',
              lineNumber: 1,
            },
          ],
        },
      ],
    },
  ];
}

describe('DataArchitectureAgent', () => {
  it('returns schema-valid data candidates when diff has db paths', async () => {
    const agent = new DataArchitectureAgent();
    const candidates = await agent.run(makeBundle({ diff: makeDbDiff() }), new MockProvider());
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    assertAllValidCandidates(candidates);
    for (const c of candidates) {
      expect(c.dimension).toBe('data');
      expect(c.sourceAgent).toBe('data-architecture');
    }
  });

  it('returns [] when diff has no db/migration paths', async () => {
    const agent = new DataArchitectureAgent();
    const candidates = await agent.run(makeBundle(), new MockProvider());
    expect(candidates).toEqual([]);
  });

  it('emits the literal "Dimension: data" line in its prompt', () => {
    const agent = new DataArchitectureAgent();
    const prompt = agent.promptTemplate(makeBundle({ diff: makeDbDiff() }));
    expect(prompt).toContain('Dimension: data');
  });

  it('returns empty prompt (no provider call) when no db paths', () => {
    const agent = new DataArchitectureAgent();
    expect(agent.promptTemplate(makeBundle())).toBe('');
  });
});
