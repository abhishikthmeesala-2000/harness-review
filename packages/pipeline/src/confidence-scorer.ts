import type { CandidateFinding } from '@engagement-harness/core';

import type { EvidenceLevel } from './types.js';

const EVIDENCE_DELTA: Record<EvidenceLevel, number> = {
  strong: 0.2,
  medium: 0.1,
  weak: -0.2,
  none: -0.4,
};

const SEVERITY_WEIGHT: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const ConfidenceScorer = {
  score(finding: CandidateFinding, level: EvidenceLevel): number {
    let score = 0.5;

    score += EVIDENCE_DELTA[level];

    if (finding.verification.status === 'approved') score += 0.1;
    if (finding.verification.status === 'rejected') score -= 0.3;

    if (finding.clientRuleReferences.length > 0) score += 0.1;

    if (finding.falsePositiveRisk === 'high') score -= 0.1;

    return Math.min(1, Math.max(0, score));
  },

  rollup(
    findings: (CandidateFinding & { confidence?: number })[],
  ): { dimension: Record<string, number>; overall: number } {
    if (findings.length === 0) {
      return { dimension: {}, overall: 1.0 };
    }

    const byDimension: Record<string, number[]> = {};
    for (const f of findings) {
      const c = f.confidence ?? 0;
      if (!byDimension[f.dimension]) byDimension[f.dimension] = [];
      byDimension[f.dimension]!.push(c);
    }

    const dimension: Record<string, number> = {};
    for (const [dim, values] of Object.entries(byDimension)) {
      dimension[dim] = values.reduce((a, b) => a + b, 0) / values.length;
    }

    let weightedSum = 0;
    let totalWeight = 0;
    for (const f of findings) {
      const weight = SEVERITY_WEIGHT[f.severity] ?? 1;
      weightedSum += (f.confidence ?? 0) * weight;
      totalWeight += weight;
    }

    const overall = totalWeight > 0 ? weightedSum / totalWeight : 1.0;
    return { dimension, overall };
  },
};
