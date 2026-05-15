import type { Config, Finding } from '@engagement-harness/core';

const SEVERITY_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export const QualityGate = {
  filter(
    findings: Finding[],
    config: Config,
  ): { passed: Finding[]; failed: Finding[] } {
    const { confidenceThreshold, severityThreshold } = config.review;
    const minRank = SEVERITY_RANK[severityThreshold] ?? 0;

    const passed: Finding[] = [];
    const failed: Finding[] = [];

    const requireVerifier = config.review.requireVerifierApproval ?? true;

    for (const f of findings) {
      if (requireVerifier && f.verification.status === 'rejected') {
        failed.push(f);
        continue;
      }
      if (f.confidence < confidenceThreshold) {
        failed.push(f);
        continue;
      }
      const rank = SEVERITY_RANK[f.severity] ?? 0;
      if (rank < minRank) {
        failed.push(f);
        continue;
      }
      passed.push(f);
    }

    return { passed, failed };
  },
};
