import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConfigSchema } from '@engagement-harness/core';
import { describe, expect, it } from 'vitest';

import { EvalRunner } from './runner.js';

const CASES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../examples/eval-cases',
);

const ALL_AGENTS_CONFIG = ConfigSchema.parse({
  client: { name: 'EvalTest', engagement: 'Phase7' },
  agents: {
    enabled: [
      'reviewer',
      'security',
      'domain-policy',
      'testing',
      'data-architecture',
      'sre-observability',
      'design-principles',
      'pr-intent-gap',
      'remediation',
    ],
  },
  models: {},
  // Use 0.75 so findings at exactly 0.8 aren't lost to IEEE-754 rounding (0.5+0.2+0.1 = 0.7999...).
  review: { confidenceThreshold: 0.75 },
});

describe('EvalRunner integration', () => {
  it('runs all 6 cases and returns a report', async () => {
    const report = await EvalRunner.runAll(CASES_DIR, ALL_AGENTS_CONFIG);
    expect(report.totalCases).toBe(6);
    expect(report.results.length).toBe(6);
  });

  it('all 6 eval cases pass', async () => {
    const report = await EvalRunner.runAll(CASES_DIR, ALL_AGENTS_CONFIG);
    for (const result of report.results) {
      expect(result.errors, `case ${result.caseId} errors: ${result.errors.join('; ')}`).toEqual(
        [],
      );
      expect(result.passed, `case ${result.caseId} should pass`).toBe(true);
    }
    expect(report.passed).toBe(6);
    expect(report.failed).toBe(0);
  });

  it('security-missing-auth produces needs_manual_review', async () => {
    const report = await EvalRunner.runAll(CASES_DIR, ALL_AGENTS_CONFIG);
    const result = report.results.find((r) => r.caseId === 'security-missing-auth');
    expect(result?.decision).toBe('needs_manual_review');
    expect(result?.findings.some((f) => f.dimension === 'security')).toBe(true);
  });

  it('clean-pr produces approved decision', async () => {
    const report = await EvalRunner.runAll(CASES_DIR, ALL_AGENTS_CONFIG);
    const result = report.results.find((r) => r.caseId === 'clean-pr');
    expect(result?.decision).toBe('approved');
    expect(result?.falsePositiveCount).toBe(0);
  });

  it('domain-policy-violation produces needs_manual_review', async () => {
    const report = await EvalRunner.runAll(CASES_DIR, ALL_AGENTS_CONFIG);
    const result = report.results.find((r) => r.caseId === 'domain-policy-violation');
    expect(result?.decision).toBe('needs_manual_review');
    expect(result?.findings.some((f) => f.dimension === 'domain-policy')).toBe(true);
  });
});
