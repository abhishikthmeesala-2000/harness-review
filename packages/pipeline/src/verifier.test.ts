import type { CandidateFinding, ContextBundle, FileDiff } from '@engagement-harness/core';
import { describe, expect, it } from 'vitest';

import { Verifier } from './verifier.js';

const DIFF_LINE = '  const id = req.body.userId;';

function makeDiff(path = 'src/api/charge.ts'): FileDiff[] {
  return [
    {
      path,
      status: 'modified',
      hunks: [
        {
          oldStart: 10,
          oldLines: 1,
          newStart: 10,
          newLines: 2,
          lines: [
            { type: 'added', content: DIFF_LINE, lineNumber: 11 },
            { type: 'added', content: '  res.send({ ok: true });', lineNumber: 12 },
          ],
        },
      ],
    },
  ];
}

function makeBundle(diff: FileDiff[] = makeDiff()): ContextBundle {
  return {
    entries: [],
    diff,
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
    id: 'V-001',
    title: 'Missing authorization check',
    category: 'security',
    dimension: 'security',
    severity: 'high',
    file: 'src/api/charge.ts',
    lineStart: 11,
    lineEnd: 12,
    evidence: [{ type: 'diff', content: DIFF_LINE }],
    whyItMatters: 'Unauthenticated access leaks data.',
    suggestedFix: 'Wrap handler in requireAuth() middleware.',
    clientRuleReferences: [],
    falsePositiveRisk: 'low',
    sourceAgent: 'security',
    modelProvider: 'mock',
    remediationReadiness: 'ready',
    verification: { status: 'pending', reason: '' },
    ...overrides,
  } as CandidateFinding;
}

describe('Verifier.verify', () => {
  it('approves a finding with strong evidence (exact diff content) and specific fix', () => {
    const result = Verifier.verify(makeCandidate(), makeBundle());
    expect(result.verification.status).toBe('approved');
    expect(result.verification.reason).toBeTruthy();
  });

  it('rejects when file is empty string', () => {
    const finding = makeCandidate({ file: '' }) as unknown as CandidateFinding;
    const result = Verifier.verify(finding, makeBundle());
    expect(result.verification.status).toBe('rejected');
    expect(result.verification.reason).toMatch(/file/i);
  });

  it('rejects when evidence array is empty', () => {
    const finding = makeCandidate({
      evidence: [] as unknown as CandidateFinding['evidence'],
    });
    const result = Verifier.verify(finding, makeBundle());
    expect(result.verification.status).toBe('rejected');
    expect(result.verification.reason).toMatch(/evidence/i);
  });

  it('passes through finding with paraphrased diff evidence (grounding check is advisory, not hard-reject)', () => {
    const finding = makeCandidate({
      evidence: [{ type: 'diff', content: 'completely unrelated text xyz123' }],
    });
    const result = Verifier.verify(finding, makeBundle());
    // Heuristic verifier no longer hard-rejects paraphrased evidence — LLM assesses grounding
    expect(result.verification.status).toBe('approved');
    expect(result.verification.reason).toContain('LLM will assess');
  });

  it('rejects generic suggestedFix: "consider refactoring"', () => {
    const result = Verifier.verify(
      makeCandidate({ suggestedFix: 'Consider refactoring this function.' }),
      makeBundle(),
    );
    expect(result.verification.status).toBe('rejected');
    expect(result.verification.reason).toMatch(/generic|suggestedFix|fix/i);
  });

  it('rejects generic suggestedFix: "could be improved"', () => {
    const result = Verifier.verify(
      makeCandidate({ suggestedFix: 'This could be improved for safety.' }),
      makeBundle(),
    );
    expect(result.verification.status).toBe('rejected');
  });

  it('rejects generic suggestedFix: "add tests"', () => {
    const result = Verifier.verify(
      makeCandidate({ suggestedFix: 'Add tests for this code path.' }),
      makeBundle(),
    );
    expect(result.verification.status).toBe('rejected');
  });

  it('rejects generic suggestedFix: "should be refactored"', () => {
    const result = Verifier.verify(
      makeCandidate({ suggestedFix: 'This should be refactored.' }),
      makeBundle(),
    );
    expect(result.verification.status).toBe('rejected');
  });

  it('rejects generic suggestedFix: "may want to"', () => {
    const result = Verifier.verify(
      makeCandidate({ suggestedFix: 'You may want to review this logic.' }),
      makeBundle(),
    );
    expect(result.verification.status).toBe('rejected');
  });

  it('rejects generic suggestedFix: "might want to"', () => {
    const result = Verifier.verify(
      makeCandidate({ suggestedFix: 'Developers might want to add a check here.' }),
      makeBundle(),
    );
    expect(result.verification.status).toBe('rejected');
  });

  it('rejects when file path is not in the diff', () => {
    const finding = makeCandidate({ file: 'src/unrelated/other.ts' });
    const result = Verifier.verify(finding, makeBundle());
    expect(result.verification.status).toBe('rejected');
    expect(result.verification.reason).toMatch(/file.*diff|diff.*file/i);
  });

  it('records verification.status and reason on every finding (approved path)', () => {
    const result = Verifier.verify(makeCandidate(), makeBundle());
    expect(result.verification.status).toMatch(/^(approved|rejected|pending)$/);
    expect(typeof result.verification.reason).toBe('string');
    expect(result.verification.reason.length).toBeGreaterThan(0);
  });

  it('records verification.status and reason on every finding (rejected path)', () => {
    const result = Verifier.verify(
      makeCandidate({ suggestedFix: 'Consider refactoring.' }),
      makeBundle(),
    );
    expect(result.verification.status).toBe('rejected');
    expect(result.verification.reason.length).toBeGreaterThan(0);
  });

  it('approves finding with context-type evidence when diff evidence also present', () => {
    const finding = makeCandidate({
      evidence: [
        { type: 'diff', content: DIFF_LINE },
        { type: 'context', content: 'The route is registered without middleware.' },
      ],
    });
    const result = Verifier.verify(finding, makeBundle());
    expect(result.verification.status).toBe('approved');
  });
});
