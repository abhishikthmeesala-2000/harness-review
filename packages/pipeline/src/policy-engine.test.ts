import type { Config, Finding } from '@engagement-harness/core';
import { ConfigSchema } from '@engagement-harness/core';
import { describe, expect, it } from 'vitest';

import { PolicyEngine } from './policy-engine.js';

function makeConfig(
  ciOverrides: Partial<Config['ci']> = {},
  reviewOverrides: Partial<Config['review']> = {},
): Config {
  return ConfigSchema.parse({
    client: { name: 'Test', engagement: 'Test' },
    ci: { blockOnPolicy: false, ...ciOverrides },
    review: { confidenceThreshold: 0.7, severityThreshold: 'low', ...reviewOverrides },
  });
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'PE-001',
    title: 'Test finding',
    category: 'security',
    dimension: 'security',
    severity: 'medium',
    confidence: 0.8,
    file: 'src/api/charge.ts',
    lineStart: 10,
    lineEnd: 12,
    evidence: [{ type: 'diff', content: 'some evidence content here' }],
    whyItMatters: 'It matters.',
    suggestedFix: 'Fix it with requireAuth().',
    clientRuleReferences: [],
    falsePositiveRisk: 'low',
    sourceAgent: 'security',
    modelProvider: 'mock',
    remediationReadiness: 'ready',
    verification: { status: 'approved', reason: 'ok' },
    ...overrides,
  } as Finding;
}

describe('PolicyEngine.decide', () => {
  it('returns "approved" when findings array is empty', () => {
    expect(PolicyEngine.decide([], makeConfig())).toBe('approved');
  });

  it('returns "approved" when only low-severity findings present', () => {
    const findings = [makeFinding({ severity: 'low' })];
    expect(PolicyEngine.decide(findings, makeConfig())).toBe('approved');
  });

  it('returns "approved_with_warnings" when only medium-severity findings present', () => {
    const findings = [
      makeFinding({ severity: 'medium' }),
      makeFinding({ severity: 'medium', id: 'PE-002' }),
    ];
    expect(PolicyEngine.decide(findings, makeConfig())).toBe('approved_with_warnings');
  });

  it('returns "needs_manual_review" when high finding present and blockOnPolicy is false', () => {
    const findings = [makeFinding({ severity: 'high' })];
    expect(PolicyEngine.decide(findings, makeConfig({ blockOnPolicy: false }))).toBe(
      'needs_manual_review',
    );
  });

  it('returns "needs_manual_review" when critical finding present and blockOnPolicy is false', () => {
    const findings = [makeFinding({ severity: 'critical' })];
    expect(PolicyEngine.decide(findings, makeConfig({ blockOnPolicy: false }))).toBe(
      'needs_manual_review',
    );
  });

  it('returns "blocked_by_policy" when high severity + confidence >= threshold + blockOnPolicy = true', () => {
    const findings = [makeFinding({ severity: 'high', confidence: 0.9 })];
    expect(PolicyEngine.decide(findings, makeConfig({ blockOnPolicy: true }))).toBe(
      'blocked_by_policy',
    );
  });

  it('returns "blocked_by_policy" when critical severity + confidence >= threshold + blockOnPolicy = true', () => {
    const findings = [makeFinding({ severity: 'critical', confidence: 0.8 })];
    expect(PolicyEngine.decide(findings, makeConfig({ blockOnPolicy: true }))).toBe(
      'blocked_by_policy',
    );
  });

  it('returns "needs_manual_review" (not blocked) when blockOnPolicy=true but confidence < threshold', () => {
    const findings = [makeFinding({ severity: 'high', confidence: 0.5 })]; // threshold 0.7
    expect(PolicyEngine.decide(findings, makeConfig({ blockOnPolicy: true }))).toBe(
      'needs_manual_review',
    );
  });

  it('returns "needs_manual_review" (not blocked) when blockOnPolicy=true but severity is medium', () => {
    const findings = [makeFinding({ severity: 'medium', confidence: 0.9 })];
    expect(PolicyEngine.decide(findings, makeConfig({ blockOnPolicy: true }))).toBe(
      'approved_with_warnings',
    );
  });

  it('precedence: blocked_by_policy beats needs_manual_review when conditions met', () => {
    const findings = [
      makeFinding({ severity: 'high', confidence: 0.9 }),
      makeFinding({ id: 'PE-002', severity: 'medium', confidence: 0.8 }),
    ];
    expect(PolicyEngine.decide(findings, makeConfig({ blockOnPolicy: true }))).toBe(
      'blocked_by_policy',
    );
  });

  it('precedence: needs_manual_review beats approved_with_warnings', () => {
    const findings = [
      makeFinding({ severity: 'high', confidence: 0.9 }),
      makeFinding({ id: 'PE-002', severity: 'medium', confidence: 0.8 }),
    ];
    expect(PolicyEngine.decide(findings, makeConfig({ blockOnPolicy: false }))).toBe(
      'needs_manual_review',
    );
  });

  it('uses confidence exactly at threshold for blocked_by_policy', () => {
    const findings = [makeFinding({ severity: 'high', confidence: 0.7 })]; // exactly at threshold
    expect(PolicyEngine.decide(findings, makeConfig({ blockOnPolicy: true }))).toBe(
      'blocked_by_policy',
    );
  });
});
