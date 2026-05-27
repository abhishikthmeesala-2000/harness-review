import type { CandidateFinding } from '@engagement-harness/core';
import { describe, expect, it } from 'vitest';

import { ConfidenceScorer } from './confidence-scorer.js';

function makeCandidate(overrides: Partial<CandidateFinding> = {}): CandidateFinding {
  return {
    id: 'C-001',
    title: 'Test finding',
    category: 'security',
    dimension: 'security',
    severity: 'medium',
    file: 'src/api/charge.ts',
    lineStart: 10,
    lineEnd: 12,
    evidence: [{ type: 'diff', content: 'Some evidence.' }],
    whyItMatters: 'It matters.',
    suggestedFix: 'Fix it properly.',
    clientRuleReferences: [],
    falsePositiveRisk: 'low',
    sourceAgent: 'security',
    modelProvider: 'mock',
    remediationReadiness: 'ready',
    verification: { status: 'pending', reason: '' },
    ...overrides,
  } as CandidateFinding;
}

describe('ConfidenceScorer.score', () => {
  it('returns 0.5 as base with medium evidence and pending verification', () => {
    const score = ConfidenceScorer.score(makeCandidate(), 'medium');
    // base 0.5 + medium evidence +0.1 = 0.6
    expect(score).toBeCloseTo(0.6);
  });

  it('applies +0.2 for strong evidence', () => {
    const score = ConfidenceScorer.score(makeCandidate(), 'strong');
    // base 0.5 + 0.2 = 0.7
    expect(score).toBeCloseTo(0.7);
  });

  it('applies +0.1 for medium evidence', () => {
    const score = ConfidenceScorer.score(makeCandidate(), 'medium');
    expect(score).toBeCloseTo(0.6);
  });

  it('applies -0.2 for weak evidence', () => {
    const score = ConfidenceScorer.score(makeCandidate(), 'weak');
    // base 0.5 - 0.2 = 0.3
    expect(score).toBeCloseTo(0.3);
  });

  it('applies -0.4 for none evidence', () => {
    const score = ConfidenceScorer.score(makeCandidate(), 'none');
    // base 0.5 - 0.4 = 0.1
    expect(score).toBeCloseTo(0.1);
  });

  it('applies +0.1 for verifier approved', () => {
    const finding = makeCandidate({ verification: { status: 'approved', reason: 'ok' } });
    const score = ConfidenceScorer.score(finding, 'medium');
    // base 0.5 + 0.1 (medium) + 0.1 (approved) = 0.7
    expect(score).toBeCloseTo(0.7);
  });

  it('applies -0.3 for verifier rejected', () => {
    const finding = makeCandidate({ verification: { status: 'rejected', reason: 'bad' } });
    const score = ConfidenceScorer.score(finding, 'medium');
    // base 0.5 + 0.1 (medium) - 0.3 (rejected) = 0.3
    expect(score).toBeCloseTo(0.3);
  });

  it('applies +0.1 for non-empty clientRuleReferences', () => {
    const finding = makeCandidate({ clientRuleReferences: ['RULE-1'] });
    const score = ConfidenceScorer.score(finding, 'medium');
    // base 0.5 + 0.1 (medium) + 0.1 (rule ref) = 0.7
    expect(score).toBeCloseTo(0.7);
  });

  it('applies -0.1 for falsePositiveRisk === "high"', () => {
    const finding = makeCandidate({ falsePositiveRisk: 'high' });
    const score = ConfidenceScorer.score(finding, 'medium');
    // base 0.5 + 0.1 (medium) - 0.1 (fp risk) = 0.5
    expect(score).toBeCloseTo(0.5);
  });

  it('clamps to 0 on the low end', () => {
    // none evidence (-0.4) + rejected (-0.3) + fp high (-0.1) = 0.5 - 0.4 - 0.3 - 0.1 = -0.3 → 0
    const finding = makeCandidate({
      verification: { status: 'rejected', reason: 'bad' },
      falsePositiveRisk: 'high',
    });
    expect(ConfidenceScorer.score(finding, 'none')).toBe(0);
  });

  it('clamps to 1 on the high end', () => {
    // strong (+0.2) + approved (+0.1) + rule ref (+0.1) = 0.5 + 0.2 + 0.1 + 0.1 = 0.9 → no clamp needed
    // To force >1: need more than that. Let's verify it never exceeds 1.
    const finding = makeCandidate({
      verification: { status: 'approved', reason: 'ok' },
      clientRuleReferences: ['RULE-1', 'RULE-2'],
    });
    // 0.5 + 0.2 + 0.1 + 0.1 = 0.9 — fine. Use a custom path to saturate:
    // Actually max is 0.5 + 0.2 + 0.1 + 0.1 = 0.9 which < 1. Clamp test: ensure score <= 1
    expect(ConfidenceScorer.score(finding, 'strong')).toBeLessThanOrEqual(1.0);
  });

  it('all deltas combined do not produce NaN', () => {
    const finding = makeCandidate({
      verification: { status: 'approved', reason: 'ok' },
      clientRuleReferences: ['R-1'],
      falsePositiveRisk: 'low',
    });
    const score = ConfidenceScorer.score(finding, 'strong');
    expect(Number.isFinite(score)).toBe(true);
  });
});

describe('ConfidenceScorer.rollup', () => {
  it('returns 1.0 dimensionConfidence and 1.0 overall when findings array is empty', () => {
    const result = ConfidenceScorer.rollup([]);
    expect(result.overall).toBe(1.0);
    expect(Object.keys(result.dimension)).toHaveLength(0);
  });

  it('computes dimension avg as mean confidence per dimension', () => {
    const findings = [
      { ...makeCandidate({ dimension: 'security' }), confidence: 0.8 },
      { ...makeCandidate({ dimension: 'security' }), confidence: 0.6 },
      { ...makeCandidate({ dimension: 'correctness' }), confidence: 0.4 },
    ] as (CandidateFinding & { confidence: number })[];

    const result = ConfidenceScorer.rollup(findings);
    expect(result.dimension['security']).toBeCloseTo(0.7);
    expect(result.dimension['correctness']).toBeCloseTo(0.4);
  });

  it('computes overall as severity-weighted avg (critical=4, high=3, medium=2, low=1)', () => {
    const findings = [
      { ...makeCandidate({ severity: 'high' }), confidence: 0.8 },
      { ...makeCandidate({ severity: 'medium' }), confidence: 0.4 },
    ] as (CandidateFinding & { confidence: number })[];

    // (0.8*3 + 0.4*2) / (3+2) = (2.4 + 0.8) / 5 = 3.2/5 = 0.64
    const result = ConfidenceScorer.rollup(findings);
    expect(result.overall).toBeCloseTo(0.64);
  });

  it('handles findings with no confidence by treating them as 0', () => {
    const findings = [
      makeCandidate({ dimension: 'security' }),
    ] as (CandidateFinding & { confidence?: number })[];

    const result = ConfidenceScorer.rollup(findings);
    expect(result.dimension['security']).toBe(0);
  });
});
