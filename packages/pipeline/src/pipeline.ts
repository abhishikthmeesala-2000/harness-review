import type { CandidateFinding, Config, ContextBundle, Finding } from '@engagement-harness/core';
import { CandidateFindingSchema, FindingSchema } from '@engagement-harness/core';

import { ConfidenceScorer } from './confidence-scorer.js';
import { Deduplicator } from './deduplicator.js';
import { EvidenceScorer } from './evidence-scorer.js';
import { PolicyEngine } from './policy-engine.js';
import { QualityGate } from './quality-gate.js';
import type { EvidenceLevel, PipelineResult, RejectedEntry } from './types.js';
import { Verifier } from './verifier.js';

export const FindingPipeline = {
  async process(
    candidates: CandidateFinding[],
    context: ContextBundle,
    config: Config,
  ): Promise<PipelineResult> {
    const rejected: RejectedEntry[] = [];
    const evidenceLevels = new Map<string, EvidenceLevel>();

    // Stage 1: schema validate
    const valid: CandidateFinding[] = [];
    for (const raw of candidates) {
      const result = CandidateFindingSchema.safeParse(raw);
      if (result.success) {
        valid.push(result.data);
      } else {
        rejected.push({
          finding: raw,
          reason: result.error.issues.map((i) => i.message).join('; '),
          stage: 'schema',
        });
      }
    }

    // Stage 2: evidence score (collect levels for metrics and confidence scoring)
    for (const f of valid) {
      evidenceLevels.set(f.id, EvidenceScorer.score(f, context.diff));
    }

    // Stage 3: verify
    const verified: CandidateFinding[] = [];
    let approvedCount = 0;
    for (const f of valid) {
      const result = Verifier.verify(f, context);
      verified.push(result);
      if (result.verification.status === 'approved') approvedCount++;
    }

    // Stage 4: confidence calibrate → upgrade to Finding
    const withConfidence: Finding[] = [];
    for (const f of verified) {
      const level = evidenceLevels.get(f.id) ?? 'weak';
      const confidence = ConfidenceScorer.score(f, level);
      const upgraded = FindingSchema.safeParse({ ...f, confidence });
      if (upgraded.success) {
        withConfidence.push(upgraded.data);
      } else {
        // Should not happen given valid input, but guard defensively
        rejected.push({
          finding: f,
          reason: upgraded.error.issues.map((i) => i.message).join('; '),
          stage: 'schema',
        });
      }
    }

    // Stage 5: deduplicate
    const { kept, dropped: dedupDropped } = Deduplicator.dedupe(withConfidence);
    for (const d of dedupDropped) {
      rejected.push(d);
    }

    // Stage 6: quality gate
    const { passed, failed: gateFailed } = QualityGate.filter(kept, config);
    for (const f of gateFailed) {
      // Determine reason: verifier rejected, below confidence, or below severity
      let reason: string;
      if (f.verification.status === 'rejected') {
        reason = `verifier rejected: ${f.verification.reason}`;
      } else if (f.confidence < config.review.confidenceThreshold) {
        reason = `confidence ${f.confidence.toFixed(2)} below threshold ${config.review.confidenceThreshold}`;
      } else {
        reason = `severity "${f.severity}" below threshold "${config.review.severityThreshold}"`;
      }
      rejected.push({ finding: f, reason, stage: 'quality-gate' });
    }

    // Also move verifier-rejected findings to rejected list with stage 'verifier'
    // (they passed confidence calibration but will fail quality gate — reclassify)
    const finalRejected: RejectedEntry[] = [];
    for (const r of rejected) {
      if (r.stage === 'quality-gate' && r.finding.verification?.status === 'rejected') {
        finalRejected.push({ ...r, stage: 'verifier' });
      } else {
        finalRejected.push(r);
      }
    }

    // Stage 7: policy decision
    const decision = PolicyEngine.decide(passed, config);

    // Rollup confidence
    const { dimension: dimensionConfidence, overall: overallConfidence } =
      ConfidenceScorer.rollup(passed);

    // Metrics
    const evidenceDistribution: Record<EvidenceLevel, number> = {
      none: 0,
      weak: 0,
      medium: 0,
      strong: 0,
    };
    for (const [, level] of evidenceLevels) {
      evidenceDistribution[level]++;
    }

    const rejectedByStage: Record<string, number> = {};
    for (const r of finalRejected) {
      rejectedByStage[r.stage] = (rejectedByStage[r.stage] ?? 0) + 1;
    }

    const verifierApprovalRate = valid.length > 0 ? approvedCount / valid.length : 1.0;

    return {
      published: passed,
      rejected: finalRejected,
      decision,
      dimensionConfidence,
      overallConfidence,
      metrics: {
        totalCandidates: candidates.length,
        publishedCount: passed.length,
        rejectedByStage,
        verifierApprovalRate,
        evidenceDistribution,
      },
    };
  },
};
