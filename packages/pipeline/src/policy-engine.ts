import type { Config, Finding, PolicyDecision } from '@engagement-harness/core';

export const PolicyEngine = {
  decide(findings: Finding[], config: Config): PolicyDecision {
    const { confidenceThreshold } = config.review;
    const { blockOnPolicy } = config.ci;

    const hasHighOrCritical = findings.some(
      (f) => f.severity === 'high' || f.severity === 'critical',
    );

    if (
      blockOnPolicy &&
      findings.some(
        (f) =>
          (f.severity === 'high' || f.severity === 'critical') &&
          f.confidence >= confidenceThreshold,
      )
    ) {
      return 'blocked_by_policy';
    }

    if (hasHighOrCritical) return 'needs_manual_review';

    if (findings.some((f) => f.severity === 'medium')) return 'approved_with_warnings';

    return 'approved';
  },
};
