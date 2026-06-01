import type { CandidateFinding, Finding, PolicyDecision } from '@engagement-harness/core';

export type EvidenceLevel = 'none' | 'weak' | 'medium' | 'strong';

export interface RejectedEntry {
  finding: CandidateFinding;
  reason: string;
  stage: string;
}

export interface PipelineMetrics {
  totalCandidates: number;
  publishedCount: number;
  rejectedByStage: Record<string, number>;
  verifierApprovalRate: number;
  truthVerifierApprovalRate?: number;
  evidenceDistribution: Record<EvidenceLevel, number>;
}

export interface PipelineResult {
  published: Finding[];
  rejected: RejectedEntry[];
  decision: PolicyDecision;
  dimensionConfidence: Record<string, number>;
  overallConfidence: number;
  metrics: PipelineMetrics;
}
