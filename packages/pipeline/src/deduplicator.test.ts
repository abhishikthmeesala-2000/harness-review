import type { Finding } from '@engagement-harness/core';
import { describe, expect, it } from 'vitest';

import { Deduplicator } from './deduplicator.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'D-001',
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

describe('Deduplicator.dedupe', () => {
  it('returns all findings when no duplicates exist', () => {
    const findings = [
      makeFinding({ id: 'D-001', file: 'src/a.ts', lineStart: 1, dimension: 'security' }),
      makeFinding({ id: 'D-002', file: 'src/b.ts', lineStart: 1, dimension: 'security' }),
      makeFinding({ id: 'D-003', file: 'src/a.ts', lineStart: 5, dimension: 'security' }),
    ];
    const { kept, dropped } = Deduplicator.dedupe(findings);
    expect(kept).toHaveLength(3);
    expect(dropped).toHaveLength(0);
  });

  it('keeps the highest-confidence finding when duplicates share (file, lineStart, dimension)', () => {
    const findings = [
      makeFinding({
        id: 'D-001',
        confidence: 0.5,
        file: 'src/a.ts',
        lineStart: 10,
        dimension: 'security',
      }),
      makeFinding({
        id: 'D-002',
        confidence: 0.9,
        file: 'src/a.ts',
        lineStart: 10,
        dimension: 'security',
      }),
      makeFinding({
        id: 'D-003',
        confidence: 0.7,
        file: 'src/a.ts',
        lineStart: 10,
        dimension: 'security',
      }),
    ];
    const { kept, dropped } = Deduplicator.dedupe(findings);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.id).toBe('D-002');
    expect(dropped).toHaveLength(2);
  });

  it('sets dropped reason to "duplicate, lower confidence"', () => {
    const findings = [
      makeFinding({
        id: 'D-001',
        confidence: 0.6,
        file: 'src/a.ts',
        lineStart: 10,
        dimension: 'security',
      }),
      makeFinding({
        id: 'D-002',
        confidence: 0.9,
        file: 'src/a.ts',
        lineStart: 10,
        dimension: 'security',
      }),
    ];
    const { dropped } = Deduplicator.dedupe(findings);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.reason).toBe('duplicate, lower confidence');
  });

  it('different dimensions at same file+lineStart are NOT duplicates', () => {
    const findings = [
      makeFinding({ id: 'D-001', file: 'src/a.ts', lineStart: 10, dimension: 'security' }),
      makeFinding({ id: 'D-002', file: 'src/a.ts', lineStart: 10, dimension: 'correctness' }),
    ];
    const { kept, dropped } = Deduplicator.dedupe(findings);
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });

  it('different lineStart at same file+dimension are NOT duplicates', () => {
    const findings = [
      makeFinding({ id: 'D-001', file: 'src/a.ts', lineStart: 10, dimension: 'security' }),
      makeFinding({ id: 'D-002', file: 'src/a.ts', lineStart: 20, dimension: 'security' }),
    ];
    const { kept, dropped } = Deduplicator.dedupe(findings);
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });

  it('different file at same lineStart+dimension are NOT duplicates', () => {
    const findings = [
      makeFinding({ id: 'D-001', file: 'src/a.ts', lineStart: 10, dimension: 'security' }),
      makeFinding({ id: 'D-002', file: 'src/b.ts', lineStart: 10, dimension: 'security' }),
    ];
    const { kept, dropped } = Deduplicator.dedupe(findings);
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });

  it('handles equal confidence by keeping the first occurrence', () => {
    const findings = [
      makeFinding({
        id: 'D-001',
        confidence: 0.8,
        file: 'src/a.ts',
        lineStart: 10,
        dimension: 'security',
      }),
      makeFinding({
        id: 'D-002',
        confidence: 0.8,
        file: 'src/a.ts',
        lineStart: 10,
        dimension: 'security',
      }),
    ];
    const { kept, dropped } = Deduplicator.dedupe(findings);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.id).toBe('D-001');
    expect(dropped).toHaveLength(1);
  });

  it('handles empty array', () => {
    const { kept, dropped } = Deduplicator.dedupe([]);
    expect(kept).toHaveLength(0);
    expect(dropped).toHaveLength(0);
  });

  it('handles three-way tie: keeps highest, drops the rest', () => {
    const findings = [
      makeFinding({ id: 'A', confidence: 0.3, file: 'src/a.ts', lineStart: 1, dimension: 'd' }),
      makeFinding({ id: 'B', confidence: 0.9, file: 'src/a.ts', lineStart: 1, dimension: 'd' }),
      makeFinding({ id: 'C', confidence: 0.6, file: 'src/a.ts', lineStart: 1, dimension: 'd' }),
    ];
    const { kept, dropped } = Deduplicator.dedupe(findings);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.id).toBe('B');
    expect(dropped.map((d) => d.finding.id).sort()).toEqual(['A', 'C']);
  });
});
