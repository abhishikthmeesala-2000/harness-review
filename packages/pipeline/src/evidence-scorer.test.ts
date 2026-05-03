import type { CandidateFinding, FileDiff } from '@engagement-harness/core';
import { describe, expect, it } from 'vitest';

import { EvidenceScorer } from './evidence-scorer.js';

function makeDiff(lineContent = '  const id = req.body.userId;'): FileDiff[] {
  return [
    {
      path: 'src/api/charge.ts',
      status: 'modified',
      hunks: [
        {
          oldStart: 10,
          oldLines: 2,
          newStart: 10,
          newLines: 3,
          lines: [
            { type: 'context', content: '// start of function', lineNumber: 10 },
            { type: 'added', content: lineContent, lineNumber: 11 },
            { type: 'added', content: '  res.send({ ok: true });', lineNumber: 12 },
          ],
        },
      ],
    },
  ];
}

function makeCandidate(
  overrides: Partial<CandidateFinding> & { evidence?: CandidateFinding['evidence'] } = {},
): CandidateFinding {
  return {
    id: 'T-001',
    title: 'Test finding',
    category: 'security',
    dimension: 'security',
    severity: 'high',
    file: 'src/api/charge.ts',
    lineStart: 10,
    lineEnd: 12,
    evidence: [{ type: 'diff', content: 'Unrelated generic text about the code.' }],
    whyItMatters: 'Matters because of security.',
    suggestedFix: 'Add authorization check.',
    clientRuleReferences: [],
    falsePositiveRisk: 'low',
    sourceAgent: 'security',
    modelProvider: 'mock',
    remediationReadiness: 'ready',
    verification: { status: 'pending', reason: '' },
    ...overrides,
  } as CandidateFinding;
}

describe('EvidenceScorer.score', () => {
  it('returns "none" when evidence array is empty', () => {
    const finding = makeCandidate({ evidence: [] as unknown as CandidateFinding['evidence'] });
    expect(EvidenceScorer.score(finding, makeDiff())).toBe('none');
  });

  it('returns "weak" when evidence exists but does not reference file path, diff keywords, or diff content', () => {
    const finding = makeCandidate({
      evidence: [{ type: 'context', content: 'Some generic observation about code quality.' }],
    });
    expect(EvidenceScorer.score(finding, makeDiff())).toBe('weak');
  });

  it('returns "medium" when evidence content references the finding file path', () => {
    const finding = makeCandidate({
      evidence: [{ type: 'diff', content: 'In src/api/charge.ts the handler is missing auth.' }],
    });
    expect(EvidenceScorer.score(finding, makeDiff())).toBe('medium');
  });

  it('returns "medium" when evidence content contains diff keyword "diff"', () => {
    const finding = makeCandidate({
      evidence: [{ type: 'diff', content: 'The diff shows an unprotected endpoint.' }],
    });
    expect(EvidenceScorer.score(finding, makeDiff())).toBe('medium');
  });

  it('returns "medium" when evidence content contains diff keyword "hunk"', () => {
    const finding = makeCandidate({
      evidence: [{ type: 'diff', content: 'This hunk adds a route without authentication.' }],
    });
    expect(EvidenceScorer.score(finding, makeDiff())).toBe('medium');
  });

  it('returns "medium" when evidence content contains a short snippet (<10 chars) from a diff hunk', () => {
    const finding = makeCandidate({
      evidence: [{ type: 'diff', content: 'The req.body access is unsafe.' }],
    });
    // "req.body" (8 chars) appears in diff line "  const id = req.body.userId;"
    expect(EvidenceScorer.score(finding, makeDiff())).toBe('medium');
  });

  it('returns "strong" when evidence content contains a verbatim substring ≥10 chars from a diff hunk', () => {
    const finding = makeCandidate({
      evidence: [
        {
          type: 'diff',
          content: 'Line `  const id = req.body.userId;` reads userId without authorization.',
        },
      ],
    });
    // "  const id = req.body.userId;" is 30 chars and appears verbatim in the diff
    expect(EvidenceScorer.score(finding, makeDiff())).toBe('strong');
  });

  it('returns "strong" for a finding with rule evidence that quotes exact diff content', () => {
    const diffLine = 'app.post("/charge", handler)';
    const diff = makeDiff(diffLine);
    const finding = makeCandidate({
      evidence: [
        { type: 'rule', content: `Rule R-1 violated: '${diffLine}' is missing requireAuth.` },
      ],
    });
    expect(EvidenceScorer.score(finding, diff)).toBe('strong');
  });

  it('uses the best tier across multiple evidence items', () => {
    const finding = makeCandidate({
      evidence: [
        { type: 'context', content: 'Generic observation.' },
        { type: 'diff', content: 'The diff shows an issue.' },
      ],
    });
    // second item hits "medium" via keyword
    expect(EvidenceScorer.score(finding, makeDiff())).toBe('medium');
  });

  it('returns "weak" when diff is empty', () => {
    const finding = makeCandidate({
      evidence: [{ type: 'diff', content: 'Some change was made.' }],
    });
    expect(EvidenceScorer.score(finding, [])).toBe('weak');
  });
});
