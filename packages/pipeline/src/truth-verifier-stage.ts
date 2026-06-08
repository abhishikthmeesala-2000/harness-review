import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { CandidateFinding, ContextBundle } from '@engagement-harness/core';
import type { Provider } from '@engagement-harness/providers';

import type { TruthVerdict } from './truth-verifier-agent.js';
import { TruthVerifierAgent } from './truth-verifier-agent.js';
import { FpPatternStore } from './fp-pattern-store.js';

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface VerifierRunMetrics {
  runId: string;
  timestamp: string;
  totalEvaluated: number;
  layer0Rejected: number;
  llmPublished: number;
  llmRejected: number;
  needsContextPublished: number;
  needsContextRejected: number;
  lowConfidenceRejections: number;
  fpPatternMatches: number;
  avgConfidencePublished: number;
  avgConfidenceRejected: number;
  batchGroups: number;
}

export interface TruthVerifierResult {
  candidates: CandidateFinding[];
  truthVerifierApprovalRate: number;
  verifierMetrics?: VerifierRunMetrics;
}

export interface TruthVerifierStageOptions {
  runId?: string;
  repoRoot?: string;
}

// ─── Verdict stats (tracked per run) ─────────────────────────────────────────

interface ApplyVerdictStats {
  lowConfidenceRejections: number;
  needsContextPublished: number;
  needsContextRejected: number;
}

// ─── Layer 0: evidence existence check ───────────────────────────────────────

function verifyEvidenceExists(
  finding: CandidateFinding,
  fileContent: string,
): { valid: boolean; matchRate: number; reason?: string } {
  const evidenceText = finding.evidence
    .filter((e) => e.type === 'diff' || e.type === 'context')
    .map((e) => e.content)
    .join('\n');

  if (!evidenceText.trim()) {
    return { valid: false, matchRate: 0, reason: 'no evidence provided' };
  }

  const evidenceLines = evidenceText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 8)
    .filter((l) => !l.startsWith('//'))
    .filter((l) => !['(', ')', '{', '}', ';'].includes(l));

  if (evidenceLines.length === 0) {
    return { valid: true, matchRate: 1.0 };
  }

  const matched = evidenceLines.filter((line) => fileContent.includes(line));
  const matchRate = matched.length / evidenceLines.length;

  if (matchRate < 0.6) {
    return {
      valid: false,
      matchRate,
      reason: `only ${Math.round(matchRate * 100)}% of evidence lines exist in file`,
    };
  }

  return { valid: true, matchRate };
}

// ─── Batch splitting (Change 4) ───────────────────────────────────────────────

const BATCH_SIZE = 5;

function buildBatches(findings: CandidateFinding[]): CandidateFinding[][] {
  const highSeverity = findings.filter((f) => f.severity === 'high');
  const others = findings.filter((f) => f.severity !== 'high');

  const batches: CandidateFinding[][] = [];

  // High severity findings get their own individual batch
  for (const f of highSeverity) {
    batches.push([f]);
  }

  // Others in groups of BATCH_SIZE
  for (let i = 0; i < others.length; i += BATCH_SIZE) {
    batches.push(others.slice(i, i + BATCH_SIZE));
  }

  return batches;
}

async function runBatches(
  batches: CandidateFinding[][],
  context: ContextBundle,
  provider: Provider,
  concurrency = 2,
): Promise<TruthVerdict[]> {
  const allVerdicts: TruthVerdict[] = [];

  for (let i = 0; i < batches.length; i += concurrency) {
    const chunk = batches.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map((batch) => TruthVerifierAgent.run(batch, context, provider)),
    );
    for (const verdicts of results) {
      allVerdicts.push(...verdicts);
    }
  }

  return allVerdicts;
}

// ─── Verdict application (Changes 1, 2) ──────────────────────────────────────

function applyNeedsContext(
  finding: CandidateFinding,
  verdict: TruthVerdict,
  stats: ApplyVerdictStats,
): CandidateFinding {
  // Change 2: needs_context + high severity → publish for human review
  if (finding.severity === 'high') {
    stats.needsContextPublished++;
    return {
      ...finding,
      verification: {
        status: 'approved',
        reason: `published: needs manual review — ${verdict.reason}`,
      },
    };
  }

  stats.needsContextRejected++;
  return {
    ...finding,
    verification: {
      status: 'rejected',
      reason: `needs_context: ${verdict.reason}`,
    },
  };
}

function applyVerdict(
  finding: CandidateFinding,
  verdict: TruthVerdict,
  stats: ApplyVerdictStats,
): CandidateFinding {
  // Hard gates only apply to findings the verifier wants to approve or downgrade.
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

  // Change 1: symmetric confidence floor — uncertain rejections treated as needs_context
  if (verdict.decision === 'rejected' && verdict.confidence < 0.65) {
    stats.lowConfidenceRejections++;
    return applyNeedsContext(finding, verdict, stats);
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
      return applyNeedsContext(finding, verdict, stats);

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

// ─── Metrics persistence (Additional Improvement 3) ──────────────────────────

function appendVerifierMetrics(metrics: VerifierRunMetrics, repoRoot: string): void {
  const metricsPath = join(repoRoot, '.engagement-harness/feedback/verifier-metrics.json');

  let existing: VerifierRunMetrics[] = [];
  if (existsSync(metricsPath)) {
    try {
      const raw = readFileSync(metricsPath, 'utf8');
      existing = JSON.parse(raw) as VerifierRunMetrics[];
    } catch {
      existing = [];
    }
  }

  existing.push(metrics);

  const dir = dirname(metricsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(metricsPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
}

// ─── Main stage ───────────────────────────────────────────────────────────────

export const TruthVerifierStage = {
  async run(
    candidates: CandidateFinding[],
    context: ContextBundle,
    provider: Provider,
    options?: TruthVerifierStageOptions,
  ): Promise<TruthVerifierResult> {
    const repoRoot = options?.repoRoot ?? process.cwd();
    const runId = options?.runId ?? `tv-${Date.now().toString(36)}`;

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
    const toVerifyBase = nonRejected.filter((c) => c.severity !== 'critical');

    // ── Additional Improvement 1: Layer 0 evidence existence check ──────────
    const layer0Passed: CandidateFinding[] = [];
    const layer0RejectedFindings: CandidateFinding[] = [];

    for (const finding of toVerifyBase) {
      const fileEntry = context.entries.find(
        (e) => e.kind === 'changed-file' && e.path === finding.file,
      );

      if (!fileEntry) {
        // No file content available — pass through to LLM
        layer0Passed.push(finding);
        continue;
      }

      const check = verifyEvidenceExists(finding, fileEntry.content);

      if (!check.valid) {
        console.log(
          `[layer-0] Evidence not found in file — rejecting without LLM call (${check.reason})`,
        );
        layer0RejectedFindings.push({
          ...finding,
          verification: {
            status: 'rejected',
            reason: `layer-0 evidence check: ${check.reason ?? 'evidence not found in file'}`,
          },
        });
      } else {
        layer0Passed.push(finding);
      }
    }

    // ── Additional Improvement 2: FP pattern confidence adjustment ──────────
    const fpMatches = new Map<string, import('./fp-pattern-store.js').FalsePositivePattern>();
    try {
      const fpStore = new FpPatternStore(repoRoot);
      for (const finding of layer0Passed) {
        const match = fpStore.checkPattern({
          sourceAgent: finding.sourceAgent,
          category: finding.category,
          title: finding.title,
          file: finding.file,
        });
        if (match.matched && match.pattern) {
          fpMatches.set(finding.id, match.pattern);
          console.log(
            `[fp-pattern] Known FP pattern matched (seen ${match.pattern.seenCount} times) — reducing confidence for ${finding.id}`,
          );
        }
      }
    } catch {
      // FP pattern store is non-critical — never fail the pipeline
    }

    // ── Change 4: Run LLM in batches ─────────────────────────────────────────
    const batches = buildBatches(layer0Passed);
    const rawVerdicts = await runBatches(batches, context, provider);

    // Apply FP confidence reduction (never for critical, which bypassed this block)
    const verdicts = rawVerdicts.map((v) => {
      const pattern = fpMatches.get(v.findingId);
      if (!pattern) return v;
      return {
        ...v,
        confidence: Math.max(0, v.confidence * 0.7), // 30% reduction
      };
    });

    const verdictMap = new Map<string, TruthVerdict>(verdicts.map((v) => [v.findingId, v]));

    // ── Changes 1, 2: Apply verdicts with stats tracking ─────────────────────
    const stats: ApplyVerdictStats = {
      lowConfidenceRejections: 0,
      needsContextPublished: 0,
      needsContextRejected: 0,
    };

    const confidencePublished: number[] = [];
    const confidenceRejected: number[] = [];

    const processed: CandidateFinding[] = layer0Passed.map((finding) => {
      const verdict = verdictMap.get(finding.id);
      if (!verdict) {
        // No verdict returned for this finding — pass through unchanged.
        return finding;
      }
      const result = applyVerdict(finding, verdict, stats);

      if (result.verification.status === 'approved') {
        confidencePublished.push(verdict.confidence);
      } else {
        confidenceRejected.push(verdict.confidence);
      }

      return result;
    });

    const allCandidates = [
      ...alreadyRejected,
      ...criticalFindings,
      ...layer0RejectedFindings,
      ...processed,
    ];

    const approvedCount =
      criticalFindings.length +
      processed.filter((c) => c.verification.status === 'approved').length;
    const truthVerifierApprovalRate =
      nonRejected.length > 0 ? approvedCount / nonRejected.length : 0;

    const llmPublished = processed.filter((c) => c.verification.status === 'approved').length;
    const llmRejected = processed.filter((c) => c.verification.status === 'rejected').length;

    const avg = (nums: number[]) =>
      nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;

    // ── Additional Improvement 3: Write verifier metrics ─────────────────────
    const verifierMetrics: VerifierRunMetrics = {
      runId,
      timestamp: new Date().toISOString(),
      totalEvaluated: toVerifyBase.length,
      layer0Rejected: layer0RejectedFindings.length,
      llmPublished,
      llmRejected,
      needsContextPublished: stats.needsContextPublished,
      needsContextRejected: stats.needsContextRejected,
      lowConfidenceRejections: stats.lowConfidenceRejections,
      fpPatternMatches: fpMatches.size,
      avgConfidencePublished: avg(confidencePublished),
      avgConfidenceRejected: avg(confidenceRejected),
      batchGroups: batches.length,
    };

    try {
      appendVerifierMetrics(verifierMetrics, repoRoot);
    } catch {
      // Metrics writing is non-critical — never fail the pipeline
    }

    return { candidates: allCandidates, truthVerifierApprovalRate, verifierMetrics };
  },
};
