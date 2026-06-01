import type { CandidateFinding, ContextBundle, FileDiff } from '@engagement-harness/core';
import type { Provider } from '@engagement-harness/providers';
import { describe, expect, it, vi } from 'vitest';

import type { TruthVerdict } from './truth-verifier-agent.js';
import { TruthVerifierStage } from './truth-verifier-stage.js';

function makeDiff(path = 'src/api/users.ts'): FileDiff[] {
  return [
    {
      path,
      status: 'modified',
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [{ type: 'added', content: 'some code', lineNumber: 1 }] }],
    },
  ];
}

function makeBundle(): ContextBundle {
  return {
    entries: [],
    diff: makeDiff(),
    repoProfile: {
      language: 'typescript',
      framework: null,
      packageManager: 'pnpm',
      testFramework: 'vitest',
      ciProvider: null,
      isMonorepo: false,
      importantPaths: [],
      suggestedIgnoredPaths: [],
    },
  };
}

function makeCandidate(overrides: Partial<CandidateFinding> = {}): CandidateFinding {
  return {
    id: 'EH-0001',
    title: 'SQL injection',
    category: 'security',
    dimension: 'security',
    severity: 'critical',
    file: 'src/api/users.ts',
    lineStart: 1,
    lineEnd: 1,
    evidence: [{ type: 'diff', content: 'some code' }],
    whyItMatters: 'Data breach risk.',
    suggestedFix: "Use db.query('SELECT * FROM users WHERE id = ?', [id])",
    clientRuleReferences: [],
    falsePositiveRisk: 'low',
    sourceAgent: 'security',
    modelProvider: 'mock',
    remediationReadiness: 'ready',
    verification: { status: 'pending', reason: '' },
    ...overrides,
  } as CandidateFinding;
}

function makeProvider(verdicts: TruthVerdict[]): Provider {
  return {
    name: 'mock',
    complete: vi.fn().mockResolvedValue({ content: JSON.stringify({ verdicts }) }),
  };
}

describe('TruthVerifierStage.run', () => {
  it('approves a finding when verdict is approved with confidence >= 0.75', async () => {
    const provider = makeProvider([
      { findingId: 'EH-0001', decision: 'approved', finalSeverity: 'critical', confidence: 0.9, reason: 'Proven.', failureType: 'none' },
    ]);
    const { candidates } = await TruthVerifierStage.run([makeCandidate()], makeBundle(), provider);

    expect(candidates[0]!.verification.status).toBe('approved');
    expect(candidates[0]!.verification.reason).toContain('truth-verifier approved');
  });

  it('rejects a finding when verdict is rejected', async () => {
    const provider = makeProvider([
      { findingId: 'EH-0001', decision: 'rejected', finalSeverity: 'low', confidence: 0.85, reason: 'ORM already handles this.', failureType: 'contradicted_by_evidence' },
    ]);
    const { candidates } = await TruthVerifierStage.run([makeCandidate()], makeBundle(), provider);

    expect(candidates[0]!.verification.status).toBe('rejected');
    expect(candidates[0]!.verification.reason).toContain('contradicted_by_evidence');
  });

  it('downgrades severity when verdict is downgrade', async () => {
    const provider = makeProvider([
      { findingId: 'EH-0001', decision: 'downgrade', finalSeverity: 'medium', confidence: 0.8, reason: 'Impact is lower than stated.', failureType: 'severity_too_high' },
    ]);
    const { candidates } = await TruthVerifierStage.run([makeCandidate()], makeBundle(), provider);

    expect(candidates[0]!.severity).toBe('medium');
    expect(candidates[0]!.verification.status).toBe('approved');
    expect(candidates[0]!.verification.reason).toContain('downgraded to medium');
  });

  it('rejects a finding when verdict is needs_context', async () => {
    const provider = makeProvider([
      { findingId: 'EH-0001', decision: 'needs_context', finalSeverity: 'high', confidence: 0.7, reason: 'Need to see the middleware.', failureType: 'needs_more_context' },
    ]);
    const { candidates } = await TruthVerifierStage.run([makeCandidate()], makeBundle(), provider);

    expect(candidates[0]!.verification.status).toBe('rejected');
    expect(candidates[0]!.verification.reason).toContain('needs_context');
  });

  it('rejects when confidence < 0.75 even if decision is approved', async () => {
    const provider = makeProvider([
      { findingId: 'EH-0001', decision: 'approved', finalSeverity: 'critical', confidence: 0.6, reason: 'Probably real.', failureType: 'none' },
    ]);
    const { candidates } = await TruthVerifierStage.run([makeCandidate()], makeBundle(), provider);

    expect(candidates[0]!.verification.status).toBe('rejected');
    expect(candidates[0]!.verification.reason).toContain('hard gate');
  });

  it('rejects cross-file finding when filesInvolved < 2 and failureType is not_cross_file', async () => {
    const candidate = makeCandidate({ pass: 'integration', filesInvolved: ['src/a.ts'] });
    const provider = makeProvider([
      { findingId: 'EH-0001', decision: 'approved', finalSeverity: 'high', confidence: 0.85, reason: 'Mismatch detected.', failureType: 'not_cross_file' },
    ]);
    const { candidates } = await TruthVerifierStage.run([candidate], makeBundle(), provider);

    expect(candidates[0]!.verification.status).toBe('rejected');
    expect(candidates[0]!.verification.reason).toContain('cross-file gate');
  });

  it('passes through finding with no verdict unchanged', async () => {
    const provider = makeProvider([]); // no verdicts
    const candidate = makeCandidate({ verification: { status: 'approved', reason: 'Heuristic checks passed.' } });
    const { candidates } = await TruthVerifierStage.run([candidate], makeBundle(), provider);

    expect(candidates[0]!.verification.status).toBe('approved');
  });

  it('skips already-rejected findings and does not re-process them', async () => {
    const rejected = makeCandidate({ verification: { status: 'rejected', reason: 'file missing' } });
    const approved = makeCandidate({ id: 'EH-0002', title: 'Other issue', verification: { status: 'pending', reason: '' } });
    const provider = makeProvider([
      { findingId: 'EH-0002', decision: 'approved', finalSeverity: 'critical', confidence: 0.9, reason: 'Proven.', failureType: 'none' },
    ]);
    const { candidates } = await TruthVerifierStage.run([rejected, approved], makeBundle(), provider);

    const rejectedResult = candidates.find((c) => c.id === 'EH-0001');
    const approvedResult = candidates.find((c) => c.id === 'EH-0002');

    expect(rejectedResult!.verification.status).toBe('rejected');
    expect(rejectedResult!.verification.reason).toBe('file missing');
    expect(approvedResult!.verification.status).toBe('approved');
  });

  it('reports truthVerifierApprovalRate correctly', async () => {
    const c1 = makeCandidate({ id: 'EH-0001' });
    const c2 = makeCandidate({ id: 'EH-0002', title: 'Issue 2' });
    const provider = makeProvider([
      { findingId: 'EH-0001', decision: 'approved', finalSeverity: 'critical', confidence: 0.9, reason: 'Proven.', failureType: 'none' },
      { findingId: 'EH-0002', decision: 'rejected', finalSeverity: 'low', confidence: 0.9, reason: 'False positive.', failureType: 'unsupported_claim' },
    ]);
    const { truthVerifierApprovalRate } = await TruthVerifierStage.run([c1, c2], makeBundle(), provider);

    expect(truthVerifierApprovalRate).toBe(0.5);
  });

  it('returns 1.0 approval rate when all findings pass', async () => {
    const provider = makeProvider([
      { findingId: 'EH-0001', decision: 'approved', finalSeverity: 'critical', confidence: 0.9, reason: 'Proven.', failureType: 'none' },
    ]);
    const { truthVerifierApprovalRate } = await TruthVerifierStage.run([makeCandidate()], makeBundle(), provider);

    expect(truthVerifierApprovalRate).toBe(1.0);
  });
});
