import { MockProvider } from '@engagement-harness/providers';
import { describe, expect, it } from 'vitest';

import {
  RemediationAgent,
  RemediationOutputSchema,
  detectTechStack,
} from './remediation.js';
import { makeBundle } from './test-helpers.js';
import type { CandidateFinding, ContextEntry } from '@engagement-harness/core';

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

function makePkgEntry(content: object | string): ContextEntry {
  return {
    path: 'package.json',
    content: typeof content === 'string' ? content : JSON.stringify(content),
    reason: 'test',
    priority: 1,
    kind: 'changed-file',
  };
}

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

  it('remediate() returns a valid RemediationOutput', async () => {
    const agent = new RemediationAgent();
    const output = await agent.remediate(MOCK_FINDING, makeBundle(), new MockProvider());
    const result = RemediationOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
    expect(output.before.length).toBeGreaterThan(0);
    expect(output.after.length).toBeGreaterThan(0);
    expect(['low', 'medium', 'high']).toContain(output.riskLevel);
    expect(['minutes', 'hours', 'days']).toContain(output.effort);
  });

  it('remediate() prompt routes to mock fixture via Dimension: remediation', async () => {
    const agent = new RemediationAgent();
    const output = await agent.remediate(MOCK_FINDING, makeBundle(), new MockProvider());
    // If the fixture matched, findingId comes back as the mock value
    expect(output.findingId).toBe('EH-MOCK-SEC-1');
  });
});

describe('detectTechStack', () => {
  it('reads language/framework/testRunner from repoProfile', () => {
    // makeBundle() sets language:'typescript', packageManager:'pnpm', testFramework:'vitest'
    const stack = detectTechStack(makeBundle());
    expect(stack.language).toBe('typescript');
    expect(stack.packageManager).toBe('pnpm');
    expect(stack.testRunner).toBe('vitest');
  });

  it('defaults language to "unknown" when repoProfile.language is null', () => {
    const bundle = makeBundle({ repoProfile: { ...makeBundle().repoProfile, language: null } });
    const stack = detectTechStack(bundle);
    expect(stack.language).toBe('unknown');
  });

  it('detects postgresql from pg dependency', () => {
    const bundle = makeBundle({ entries: [makePkgEntry({ dependencies: { pg: '^8.0.0' } })] });
    const stack = detectTechStack(bundle);
    expect(stack.database).toBe('postgresql');
  });

  it('detects prisma ORM and postgresql database from @prisma/client', () => {
    const bundle = makeBundle({
      entries: [makePkgEntry({ dependencies: { '@prisma/client': '^5.0.0' } })],
    });
    const stack = detectTechStack(bundle);
    expect(stack.orm).toBe('prisma');
    expect(stack.database).toBe('postgresql');
  });

  it('detects esm import style from "type": "module"', () => {
    const bundle = makeBundle({ entries: [makePkgEntry({ type: 'module' })] });
    const stack = detectTechStack(bundle);
    expect(stack.importStyle).toBe('esm');
  });

  it('defaults to commonjs when no type field in package.json', () => {
    const bundle = makeBundle({ entries: [makePkgEntry({})] });
    const stack = detectTechStack(bundle);
    expect(stack.importStyle).toBe('commonjs');
  });

  it('does not throw on malformed package.json content', () => {
    const bundle = makeBundle({ entries: [makePkgEntry('NOT JSON { broken')] });
    expect(() => detectTechStack(bundle)).not.toThrow();
    const stack = detectTechStack(bundle);
    expect(stack.database).toBeNull();
    expect(stack.orm).toBeNull();
    expect(stack.importStyle).toBe('commonjs');
  });

  it('returns null for optional fields when no package.json entry', () => {
    const bundle = makeBundle({ entries: [] });
    const stack = detectTechStack(bundle);
    expect(stack.database).toBeNull();
    expect(stack.orm).toBeNull();
    expect(stack.importStyle).toBe('commonjs');
  });
});
