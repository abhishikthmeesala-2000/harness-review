import type { CandidateFinding, ContextBundle } from '@engagement-harness/core';
import type { Provider } from '@engagement-harness/providers';

import type { TruthVerdict } from './truth-verifier-agent.js';
import { TruthVerifierAgent } from './truth-verifier-agent.js';

export interface TruthVerifierResult {
  candidates: CandidateFinding[];
  truthVerifierApprovalRate: number;
}

function applyVerdict(finding: CandidateFinding, verdict: TruthVerdict): CandidateFinding {
  // Hard gates only apply to findings the verifier wants to approve or downgrade.
  // rejected/needs_context decisions are already suppressions — gates don't override them.
  const wouldApprove = verdict.decision === 'approved' || verdict.decision === 'downgrade';

  if (wouldApprove) {
    const hardGatesFail = verdict.confidence < 0.75;

    if (hardGatesFail) {
      return {
        ...finding,
        verification: {
          status: 'rejected',
          reason: `truth-verifier hard gate: confidence=${verdict.confidence.toFixed(2)}, failureType=${verdict.failureType}`,
        },
      };
    }

    const crossFileFail =
      finding.pass === 'integration' &&
      (verdict.failureType === 'not_cross_file' ||
        verdict.failureType === 'contradicted_by_evidence' ||
        (finding.filesInvolved ?? []).length < 2);

    if (crossFileFail) {
      return {
        ...finding,
        verification: {
          status: 'rejected',
          reason: `truth-verifier cross-file gate: ${verdict.failureType !== 'none' ? verdict.failureType : 'filesInvolved < 2'}`,
        },
      };
    }
  }

  // Override: rejection reason doesn't address the specific claim type
  if (verdict.decision === 'rejected' && !(verdict.claimAddressed ?? true)) {
    return {
      ...finding,
      verification: {
        status: 'approved',
        reason: 'truth-verifier: rejection reason did not address the specific claim',
      },
    };
  }

  // Override: high severity with low-confidence rejection — publish to avoid missing real issues
  if (finding.severity === 'high' && verdict.decision === 'rejected' && verdict.confidence < 0.7) {
    return {
      ...finding,
      verification: {
        status: 'approved',
        reason: `truth-verifier: high severity with low-confidence rejection (${verdict.confidence.toFixed(2)})`,
      },
    };
  }

  switch (verdict.decision) {
    case 'approved':
      return {
        ...finding,
        verification: {
          status: 'approved',
          reason: `truth-verifier approved: ${verdict.reason}`,
        },
      };

    case 'downgrade':
      return {
        ...finding,
        severity: verdict.finalSeverity,
        verification: {
          status: 'approved',
          reason: `truth-verifier downgraded to ${verdict.finalSeverity}: ${verdict.reason}`,
        },
      };

    case 'needs_context':
      return {
        ...finding,
        verification: {
          status: 'rejected',
          reason: `needs_context: ${verdict.reason}`,
        },
      };

    case 'rejected':
      return {
        ...finding,
        verification: {
          status: 'rejected',
          reason: `truth-verifier rejected (${verdict.failureType}): ${verdict.reason}`,
        },
      };

    default: {
      const _exhaustive: never = verdict.decision;
      return finding;
    }
  }
}

export const TruthVerifierStage = {
  async run(
    candidates: CandidateFinding[],
    context: ContextBundle,
    provider: Provider,
  ): Promise<TruthVerifierResult> {
    // Only run on findings that passed the heuristic verifier; rejected ones stay rejected.
    const nonRejected = candidates.filter((c) => c.verification.status !== 'rejected');
    const alreadyRejected = candidates.filter((c) => c.verification.status === 'rejected');

    // Critical findings are always published — skip LLM evaluation entirely.
    const criticalFindings = nonRejected
      .filter((c) => c.severity === 'critical')
      .map((c) => ({
        ...c,
        verification: {
          status: 'approved' as const,
          reason: 'critical severity: always published',
        },
      }));
    const toVerify = nonRejected.filter((c) => c.severity !== 'critical');

    const verdicts = await TruthVerifierAgent.run(toVerify, context, provider);
    const verdictMap = new Map<string, TruthVerdict>(verdicts.map((v) => [v.findingId, v]));

    const processed: CandidateFinding[] = toVerify.map((finding) => {
      const verdict = verdictMap.get(finding.id);
      if (!verdict) {
        // No verdict returned for this finding — pass through unchanged.
        return finding;
      }
      return applyVerdict(finding, verdict);
    });

    const allCandidates = [...alreadyRejected, ...criticalFindings, ...processed];

    const approvedCount =
      criticalFindings.length +
      processed.filter((c) => c.verification.status === 'approved').length;
    const truthVerifierApprovalRate =
      nonRejected.length > 0 ? approvedCount / nonRejected.length : 0;

    return { candidates: allCandidates, truthVerifierApprovalRate };
  },
};
