import { MockProvider } from '@engagement-harness/providers';
import { describe, expect, it } from 'vitest';

import { DomainPolicyAgent } from './domain-policy.js';
import { assertAllValidCandidates, makeBundle, makeRuleEntry } from './test-helpers.js';

describe('DomainPolicyAgent', () => {
  it('returns no candidates when the bundle has no rule entries (no rules to enforce)', async () => {
    const agent = new DomainPolicyAgent();
    const candidates = await agent.run(makeBundle({ entries: [] }), new MockProvider());
    expect(candidates).toEqual([]);
  });

  it('returns schema-valid domain-policy candidates when at least one rule applies', async () => {
    const agent = new DomainPolicyAgent();
    const bundle = makeBundle({ entries: [makeRuleEntry()] });
    const candidates = await agent.run(bundle, new MockProvider());
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    assertAllValidCandidates(candidates);
    for (const c of candidates) {
      expect(c.dimension).toBe('domain-policy');
      expect(c.sourceAgent).toBe('domain-policy');
    }
  });

  it('embeds rule body in the prompt and skips the dimension header when no rules are present', () => {
    const agent = new DomainPolicyAgent();
    expect(agent.promptTemplate(makeBundle({ entries: [] }))).toBe('');
    const withRules = agent.promptTemplate(makeBundle({ entries: [makeRuleEntry()] }));
    expect(withRules).toContain('Dimension: domain-policy');
    expect(withRules).toContain('payments.md');
    expect(withRules).toContain('idempotency');
  });
});
