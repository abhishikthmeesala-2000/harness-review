import type { Config, Finding } from '@engagement-harness/core';
import { ConfigSchema } from '@engagement-harness/core';
import { describe, expect, it } from 'vitest';

import { QualityGate } from './quality-gate.js';

function makeConfig(overrides: Partial<Config['review']> = {}): Config {
  return ConfigSchema.parse({
    client: { name: 'Test', engagement: 'Test' },
    review: {
      confidenceThreshold: 0.7,
      severityThreshold: 'medium',
      requireVerifierApproval: true,
      ...overrides,
    },
  });
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'QG-001',
    title: 'Test finding',
    category: 'security',
    dimension: 'security',
    severity: 'high',
    confidence: 0.8,
    file: 'src/api/charge.ts',
    lineStart: 10,
    lineEnd: 12,
    evidence: [{ type: 'diff', content: 'some evidence content here' }],
    whyItMatters: 'It matters.',
    suggestedFix: 'Fix it properly with requireAuth().',
    clientRuleReferences: [],
    falsePositiveRisk: 'low',
    sourceAgent: 'security',
    modelProvider: 'mock',
    remediationReadiness: 'ready',
    verification: { status: 'approved', reason: 'ok' },
    ...overrides,
  } as Finding;
}

describe('QualityGate.filter', () => {
  it('passes a finding that meets all thresholds', () => {
    const { passed, failed } = QualityGate.filter([makeFinding()], makeConfig());
    expect(passed).toHaveLength(1);
    expect(failed).toHaveLength(0);
  });

  it('drops a finding below confidenceThreshold', () => {
    const finding = makeFinding({ confidence: 0.5 }); // threshold is 0.7
    const { passed, failed } = QualityGate.filter([finding], makeConfig());
    expect(passed).toHaveLength(0);
    expect(failed).toHaveLength(1);
  });

  it('passes a finding exactly at confidenceThreshold', () => {
    const finding = makeFinding({ confidence: 0.7 });
    const { passed, failed } = QualityGate.filter([finding], makeConfig());
    expect(passed).toHaveLength(1);
    expect(failed).toHaveLength(0);
  });

  it('drops a finding below severityThreshold (low when threshold is medium)', () => {
    const finding = makeFinding({ severity: 'low' }); // threshold is 'medium'
    const { passed, failed } = QualityGate.filter([finding], makeConfig());
    expect(passed).toHaveLength(0);
    expect(failed).toHaveLength(1);
  });

  it('passes a finding exactly at severityThreshold (medium when threshold is medium)', () => {
    const finding = makeFinding({ severity: 'medium' });
    const { passed, failed } = QualityGate.filter([finding], makeConfig());
    expect(passed).toHaveLength(1);
    expect(failed).toHaveLength(0);
  });

  it('drops a finding with verification.status === "rejected"', () => {
    const finding = makeFinding({ verification: { status: 'rejected', reason: 'bad' } });
    const { passed, failed } = QualityGate.filter([finding], makeConfig());
    expect(passed).toHaveLength(0);
    expect(failed).toHaveLength(1);
  });

  it('passes a finding with verification.status === "pending" (not rejected)', () => {
    const finding = makeFinding({ verification: { status: 'pending', reason: '' } });
    const { passed, failed } = QualityGate.filter([finding], makeConfig());
    expect(passed).toHaveLength(1);
    expect(failed).toHaveLength(0);
  });

  it('handles empty findings array', () => {
    const { passed, failed } = QualityGate.filter([], makeConfig());
    expect(passed).toHaveLength(0);
    expect(failed).toHaveLength(0);
  });

  it('correctly splits a mixed batch', () => {
    const findings = [
      makeFinding({
        id: 'F1',
        confidence: 0.9,
        severity: 'high',
        verification: { status: 'approved', reason: 'ok' },
      }),
      makeFinding({ id: 'F2', confidence: 0.5, severity: 'high' }), // fails confidence
      makeFinding({ id: 'F3', confidence: 0.8, severity: 'low' }), // fails severity
      makeFinding({
        id: 'F4',
        confidence: 0.8,
        severity: 'medium',
        verification: { status: 'rejected', reason: 'bad' },
      }), // fails verification
    ];
    const { passed, failed } = QualityGate.filter(findings, makeConfig());
    expect(passed.map((f) => f.id)).toEqual(['F1']);
    expect(failed.map((f) => f.id).sort()).toEqual(['F2', 'F3', 'F4']);
  });

  it('uses severity ordering: low < medium < high < critical', () => {
    const config = makeConfig({ severityThreshold: 'high' });
    const findings = [
      makeFinding({ id: 'L', severity: 'low' }),
      makeFinding({ id: 'M', severity: 'medium' }),
      makeFinding({ id: 'H', severity: 'high' }),
      makeFinding({ id: 'C', severity: 'critical' }),
    ];
    const { passed, failed } = QualityGate.filter(findings, config);
    expect(passed.map((f) => f.id).sort()).toEqual(['C', 'H']);
    expect(failed.map((f) => f.id).sort()).toEqual(['L', 'M']);
  });
});
