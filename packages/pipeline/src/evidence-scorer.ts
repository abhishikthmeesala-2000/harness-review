import type { CandidateFinding, FileDiff } from '@engagement-harness/core';

import type { EvidenceLevel } from './types.js';

const DIFF_KEYWORDS = ['diff', 'hunk', 'line '];
const STRONG_MIN_LENGTH = 10;

function allDiffLineContents(diff: FileDiff[]): string[] {
  return diff.flatMap((f) => f.hunks.flatMap((h) => h.lines.map((l) => l.content)));
}

/** Extract code identifier tokens (≥4 chars) from text for fuzzy medium-tier matching. */
function extractIdents(text: string): string[] {
  return text.match(/[a-zA-Z_$][a-zA-Z0-9_$.]{3,}/g) ?? [];
}

function scoreItem(content: string, filePath: string, diffLines: string[]): EvidenceLevel {
  // Strong: evidence contains a verbatim diff line of ≥10 chars
  if (diffLines.length > 0) {
    for (const line of diffLines) {
      if (line.length >= STRONG_MIN_LENGTH && content.includes(line)) {
        return 'strong';
      }
    }
  }

  // Medium: file path reference
  if (content.includes(filePath)) return 'medium';

  // Medium: explicit diff keywords
  for (const kw of DIFF_KEYWORDS) {
    if (content.toLowerCase().includes(kw)) return 'medium';
  }

  // Medium: short snippet — any code ident from evidence appears in a diff line
  if (diffLines.length > 0) {
    const idents = extractIdents(content);
    for (const ident of idents) {
      for (const line of diffLines) {
        if (line.includes(ident)) return 'medium';
      }
    }
  }

  return 'weak';
}

export const EvidenceScorer = {
  score(finding: CandidateFinding, diff: FileDiff[]): EvidenceLevel {
    if (!finding.evidence || finding.evidence.length === 0) return 'none';

    const diffLines = allDiffLineContents(diff);

    let best: EvidenceLevel = 'weak';
    for (const item of finding.evidence) {
      const tier = scoreItem(item.content, finding.file, diffLines);
      if (tier === 'strong') return 'strong';
      if (tier === 'medium') best = 'medium';
    }
    return best;
  },
};
