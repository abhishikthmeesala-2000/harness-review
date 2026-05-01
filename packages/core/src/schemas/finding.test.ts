import { describe, expect, it } from 'vitest';

import {
  CandidateFindingSchema,
  FindingSchema,
  type CandidateFinding,
  type Finding,
} from './finding.js';

const baseShape = {
  id: 'EH-0001',
  title: 'Missing authorization check on admin route',
  category: 'security' as const,
  dimension: 'security',
  severity: 'high' as const,
  file: 'src/admin/route.ts',
  lineStart: 10,
  lineEnd: 14,
  evidence: [{ type: 'diff' as const, content: 'app.get("/admin", (req, res) => { ... })' }],
  whyItMatters: 'Unauthenticated users could reach admin actions.',
  suggestedFix: 'Wrap the route in requireAdmin() middleware before the handler runs.',
  clientRuleReferences: [],
  falsePositiveRisk: 'low' as const,
  sourceAgent: 'security',
  modelProvider: 'mock',
  remediationReadiness: 'ready' as const,
};

const validFinding: Finding = {
  ...baseShape,
  confidence: 0.9,
  verification: { status: 'approved', reason: 'Approved by verifier' },
};

const validCandidate: CandidateFinding = {
  ...baseShape,
  verification: { status: 'pending', reason: '' },
};

describe('FindingSchema', () => {
  it('accepts a fully populated finding', () => {
    const parsed = FindingSchema.parse(validFinding);
    expect(parsed.confidence).toBe(0.9);
    expect(parsed.verification.status).toBe('approved');
  });

  it('rejects findings without evidence', () => {
    const invalid = { ...validFinding, evidence: [] };
    const result = FindingSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('at least one'))).toBe(true);
    }
  });

  it('rejects out-of-range confidence', () => {
    const result = FindingSchema.safeParse({ ...validFinding, confidence: 1.5 });
    expect(result.success).toBe(false);
  });

  it('rejects lineEnd before lineStart', () => {
    const result = FindingSchema.safeParse({ ...validFinding, lineStart: 10, lineEnd: 5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('lineEnd must be >= lineStart');
    }
  });

  it('rejects unknown category enum', () => {
    const result = FindingSchema.safeParse({ ...validFinding, category: 'oops' });
    expect(result.success).toBe(false);
  });

  it('rejects oversized titles', () => {
    const result = FindingSchema.safeParse({ ...validFinding, title: 'x'.repeat(121) });
    expect(result.success).toBe(false);
  });
});

describe('CandidateFindingSchema', () => {
  it('accepts candidates without confidence (filled later)', () => {
    const { verification: _v, ...rest } = validFinding;
    void _v;
    const parsed = CandidateFindingSchema.parse(rest);
    expect(parsed.confidence).toBe(0.9);
    expect(parsed.verification.status).toBe('pending');
  });

  it('defaults verification to pending', () => {
    const { verification: _drop, ...rest } = validCandidate;
    void _drop;
    const parsed = CandidateFindingSchema.parse(rest);
    expect(parsed.verification.status).toBe('pending');
    expect(parsed.verification.reason).toBe('');
  });

  it('still requires evidence with at least one entry', () => {
    const result = CandidateFindingSchema.safeParse({ ...validCandidate, evidence: [] });
    expect(result.success).toBe(false);
  });
});
