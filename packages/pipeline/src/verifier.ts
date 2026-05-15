import type { CandidateFinding, ContextBundle } from '@engagement-harness/core';

const GENERIC_FIX_PHRASES = [
  'consider refactoring',
  'could be improved',
  'add tests',
  'should be refactored',
  'may want to',
  'might want to',
];

const STRONG_MIN_LENGTH = 10;

function allDiffLineContents(context: ContextBundle): string[] {
  return context.diff.flatMap((f) => f.hunks.flatMap((h) => h.lines.map((l) => l.content)));
}

function allDiffFilePaths(context: ContextBundle): Set<string> {
  return new Set(context.diff.map((f) => f.path));
}

function hasGenericFix(suggestedFix: string): boolean {
  const lower = suggestedFix.toLowerCase();
  return GENERIC_FIX_PHRASES.some((phrase) => lower.includes(phrase));
}

function hasDiffEvidence(finding: CandidateFinding, diffLines: string[]): boolean {
  const diffItems = finding.evidence.filter((e) => e.type === 'diff');
  if (diffItems.length === 0) return true; // non-diff evidence types don't trigger this check
  return diffItems.some((e) => {
    const ec = e.content.trim();
    return diffLines.some((line) => {
      const lc = line.trim();
      return lc.length >= STRONG_MIN_LENGTH && (ec.includes(lc) || lc.includes(ec));
    });
  });
}

function reject(finding: CandidateFinding, reason: string): CandidateFinding {
  return { ...finding, verification: { status: 'rejected', reason } };
}

function approve(finding: CandidateFinding): CandidateFinding {
  return { ...finding, verification: { status: 'approved', reason: 'Heuristic checks passed.' } };
}

export const Verifier = {
  verify(finding: CandidateFinding, context: ContextBundle): CandidateFinding {
    if (!finding.file || finding.file.trim() === '') {
      return reject(finding, 'file is missing or empty');
    }

    if (!finding.evidence || finding.evidence.length === 0) {
      return reject(finding, 'evidence array is empty');
    }

    const diffPaths = allDiffFilePaths(context);
    if (diffPaths.size > 0 && !diffPaths.has(finding.file)) {
      return reject(finding, `file "${finding.file}" not found in diff`);
    }

    const diffLines = allDiffLineContents(context);
    if (diffLines.length > 0 && !hasDiffEvidence(finding, diffLines)) {
      return reject(finding, 'diff evidence content does not appear in diff hunks');
    }

    if (hasGenericFix(finding.suggestedFix)) {
      return reject(finding, 'suggestedFix uses generic phrasing');
    }

    return approve(finding);
  },
};
