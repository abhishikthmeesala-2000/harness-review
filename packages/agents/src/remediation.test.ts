import { MockProvider } from '@engagement-harness/providers';
import { describe, expect, it } from 'vitest';

import { RemediationAgent, RemediationPlanSchema } from './remediation.js';
import { makeBundle } from './test-helpers.js';
import type { CandidateFinding } from '@engagement-harness/core';

const MOCK_FINDING: CandidateFinding = {
  id: 'EH-MOCK-SEC-1',
  title: 'Missing authorization check on admin endpoint',
  category: 'security',
  dimension: 'security',
  severity: 'high',
  file: 'src/routes/admin.ts',
  lineStart: 12,
  lineEnd: 18,
  evidence: [{ type: 'diff', content: 'app.post("/admin/delete", async (req, res) => {' }],
  whyItMatters: 'Unauthenticated callers can reach a destructive endpoint.',
  suggestedFix: 'Wrap the handler in requireAdmin().',
  clientRuleReferences: [],
  falsePositiveRisk: 'low',
  sourceAgent: 'security',
  modelProvider: 'mock',
  remediationReadiness: 'ready',
  verification: { status: 'pending', reason: '' },
};

describe('RemediationAgent', () => {
  it('run() always returns [] — it is a non-finding agent', async () => {
    const agent = new RemediationAgent();
    const candidates = await agent.run(makeBundle(), new MockProvider());
    expect(candidates).toEqual([]);
  });

  it('promptTemplate() always returns empty string', () => {
    const agent = new RemediationAgent();
    expect(agent.promptTemplate(makeBundle())).toBe('');
  });

  it('remediate() returns a valid RemediationPlan', async () => {
    const agent = new RemediationAgent();
    const plan = await agent.remediate(MOCK_FINDING, makeBundle(), new MockProvider());
    const result = RemediationPlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
    expect(plan.plan.length).toBeGreaterThan(0);
    expect(Array.isArray(plan.testRecommendations)).toBe(true);
    expect(['trivial', 'small', 'medium', 'large']).toContain(plan.estimatedEffort);
  });
});
