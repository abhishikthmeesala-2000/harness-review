import type { CandidateFinding, Config, ContextBundle, FileDiff } from '@engagement-harness/core';
import { ConfigSchema } from '@engagement-harness/core';
import { describe, expect, it } from 'vitest';

import { FindingPipeline } from './pipeline.js';

const DIFF_LINE_A = '  const userId = req.body.userId;';
const DIFF_LINE_B = '  app.post("/charge", chargeHandler);';
const DIFF_LINE_C = '  if (x > array.length) return null;';

function makeDiff(): FileDiff[] {
  return [
    {
      path: 'src/api/charge.ts',
      status: 'modified',
      hunks: [
        {
          oldStart: 10,
          oldLines: 1,
          newStart: 10,
          newLines: 3,
          lines: [
            { type: 'added', content: DIFF_LINE_A, lineNumber: 10 },
            { type: 'added', content: DIFF_LINE_B, lineNumber: 11 },
            { type: 'added', content: DIFF_LINE_C, lineNumber: 12 },
          ],
        },
      ],
    },
  ];
}

function makeBundle(): ContextBundle {
  return {
    entries: [],
    diff: makeDiff(),
    repoProfile: {
      language: 'typescript',
      framework: null,
      packageManager: 'pnpm',
      testFramework: 'vitest',
      ciProvider: null,
      isMonorepo: false,
      importantPaths: [],
      suggestedIgnoredPaths: [],
    },
  };
}

function makeConfig(overrides: { blockOnPolicy?: boolean; confidenceThreshold?: number } = {}): Config {
  return ConfigSchema.parse({
    client: { name: 'TestCo', engagement: 'Pilot' },
    review: {
      confidenceThreshold: overrides.confidenceThreshold ?? 0.5,
      severityThreshold: 'low',
      requireVerifierApproval: false,
    },
    ci: { blockOnPolicy: overrides.blockOnPolicy ?? false },
  });
}

function makeCandidate(id: string, overrides: Partial<CandidateFinding> = {}): CandidateFinding {
  return {
    id,
    title: `Finding ${id}`,
    category: 'security',
    dimension: 'security',
    severity: 'medium',
    file: 'src/api/charge.ts',
    lineStart: 10,
    lineEnd: 12,
    evidence: [{ type: 'diff', content: DIFF_LINE_A }],
    whyItMatters: 'Security risk.',
    suggestedFix: 'Add requireAuth() middleware to the handler.',
    clientRuleReferences: [],
    falsePositiveRisk: 'low',
    sourceAgent: 'security',
    modelProvider: 'mock',
    remediationReadiness: 'ready',
    verification: { status: 'pending', reason: '' },
    ...overrides,
  } as CandidateFinding;
}

describe('FindingPipeline.process', () => {
  it('publishes well-formed candidates with strong evidence and specific fix', async () => {
    const candidates = [makeCandidate('F-001'), makeCandidate('F-002')];
    const result = await FindingPipeline.process(candidates, makeBundle(), makeConfig());
    expect(result.published.length).toBeGreaterThanOrEqual(1);
    for (const f of result.published) {
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
      expect(f.verification.status).toMatch(/^(approved|pending)$/);
    }
  });

  it('rejects malformed candidate at schema stage', async () => {
    const malformed = { id: '', title: '', category: 'security' } as unknown as CandidateFinding;
    const result = await FindingPipeline.process([malformed, makeCandidate('F-001')], makeBundle(), makeConfig());
    const schemaRejected = result.rejected.filter((r) => r.stage === 'schema');
    expect(schemaRejected.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects finding with generic suggestedFix at verifier stage', async () => {
    const candidate = makeCandidate('F-003', { suggestedFix: 'Consider refactoring this function.' });
    const result = await FindingPipeline.process([candidate], makeBundle(), makeConfig());
    const verifierRejected = result.rejected.filter((r) => r.stage === 'verifier');
    expect(verifierRejected.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects duplicate (lower confidence) at deduplication stage', async () => {
    const candidates = [
      makeCandidate('F-004', { file: 'src/api/charge.ts', lineStart: 10, dimension: 'security' }),
      makeCandidate('F-005', { file: 'src/api/charge.ts', lineStart: 10, dimension: 'security' }),
    ];
    const result = await FindingPipeline.process(candidates, makeBundle(), makeConfig());
    const dedupRejected = result.rejected.filter((r) => r.stage === 'deduplication');
    expect(dedupRejected.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects findings below quality gate thresholds', async () => {
    const candidate = makeCandidate('F-006', {
      evidence: [{ type: 'context', content: 'Vague observation with no specifics.' }],
      suggestedFix: 'Wrap with middleware.',
    });
    const config = makeConfig({ confidenceThreshold: 0.95 }); // very high threshold
    const result = await FindingPipeline.process([candidate], makeBundle(), config);
    const gateRejected = result.rejected.filter((r) => r.stage === 'quality-gate');
    expect(gateRejected.length).toBeGreaterThanOrEqual(1);
  });

  it('decision is "blocked_by_policy" when blockOnPolicy=true and high-severity high-confidence finding passes', async () => {
    const candidate = makeCandidate('F-007', {
      severity: 'high',
      evidence: [{ type: 'diff', content: DIFF_LINE_A }],
      suggestedFix: 'Add requireAuth() middleware to block unauthenticated requests.',
      clientRuleReferences: ['SEC-001'],
    });
    const config = makeConfig({ blockOnPolicy: true, confidenceThreshold: 0.3 });
    const result = await FindingPipeline.process([candidate], makeBundle(), config);
    expect(result.decision).toBe('blocked_by_policy');
  });

  it('decision is "approved" when no candidates pass the pipeline', async () => {
    const candidate = makeCandidate('F-008', {
      evidence: [{ type: 'context', content: 'Generic vague observation.' }],
      suggestedFix: 'Consider refactoring this.',
    });
    const config = makeConfig({ confidenceThreshold: 0.99 });
    const result = await FindingPipeline.process([candidate], makeBundle(), config);
    // Nothing passes: approved
    expect(['approved', 'approved_with_warnings']).toContain(result.decision);
  });

  it('populates metrics.totalCandidates correctly', async () => {
    const candidates = Array.from({ length: 5 }, (_, i) => makeCandidate(`M-00${i}`));
    const result = await FindingPipeline.process(candidates, makeBundle(), makeConfig());
    expect(result.metrics.totalCandidates).toBe(5);
  });

  it('populates metrics.publishedCount == published.length', async () => {
    const candidates = [makeCandidate('M-010'), makeCandidate('M-011')];
    const result = await FindingPipeline.process(candidates, makeBundle(), makeConfig());
    expect(result.metrics.publishedCount).toBe(result.published.length);
  });

  it('populates metrics.rejectedByStage with at least one stage when there are rejections', async () => {
    const malformed = { id: '' } as unknown as CandidateFinding;
    const result = await FindingPipeline.process([malformed], makeBundle(), makeConfig());
    const totalRejected = Object.values(result.metrics.rejectedByStage).reduce((a, b) => a + b, 0);
    expect(totalRejected).toBe(result.rejected.length);
  });

  it('populates metrics.evidenceDistribution with tiers as keys', async () => {
    const candidates = [makeCandidate('E-001')];
    const result = await FindingPipeline.process(candidates, makeBundle(), makeConfig());
    const tiers = Object.keys(result.metrics.evidenceDistribution);
    expect(tiers.sort()).toEqual(['medium', 'none', 'strong', 'weak'].sort());
  });

  it('populates dimensionConfidence and overallConfidence', async () => {
    const candidates = [makeCandidate('DC-001')];
    const result = await FindingPipeline.process(candidates, makeBundle(), makeConfig());
    expect(typeof result.overallConfidence).toBe('number');
    expect(result.overallConfidence).toBeGreaterThanOrEqual(0);
    expect(result.overallConfidence).toBeLessThanOrEqual(1);
    expect(typeof result.dimensionConfidence).toBe('object');
  });

  it('verifierApprovalRate is between 0 and 1', async () => {
    const candidates = [makeCandidate('VA-001'), makeCandidate('VA-002')];
    const result = await FindingPipeline.process(candidates, makeBundle(), makeConfig());
    expect(result.metrics.verifierApprovalRate).toBeGreaterThanOrEqual(0);
    expect(result.metrics.verifierApprovalRate).toBeLessThanOrEqual(1);
  });

  it('end-to-end: 10+ fixture candidates produce correct published/rejected split', async () => {
    // Each candidate gets a unique lineStart so deduplication does not collapse them.
    const good = (id: string, lineStart: number, sev: CandidateFinding['severity'] = 'high') =>
      makeCandidate(id, {
        lineStart,
        lineEnd: lineStart + 1,
        severity: sev,
        evidence: [{ type: 'diff', content: DIFF_LINE_A }],
        suggestedFix: 'Add requireAuth() middleware to block unauthenticated requests.',
        clientRuleReferences: ['SEC-001'],
      });
    const bad = (id: string, lineStart: number) =>
      makeCandidate(id, { lineStart, lineEnd: lineStart + 1, suggestedFix: 'Consider refactoring.' }); // verifier rejects

    const candidates: CandidateFinding[] = [
      good('E2E-01', 10, 'high'),
      good('E2E-02', 11, 'critical'),
      good('E2E-03', 12, 'medium'),
      bad('E2E-04', 20),
      bad('E2E-05', 21),
      bad('E2E-06', 22),
      good('E2E-07', 13, 'low'),
      good('E2E-08', 14, 'high'),
      bad('E2E-09', 23),
      bad('E2E-10', 24),
      good('E2E-11', 15, 'medium'),
    ];

    // requireVerifierApproval: true so bad candidates (generic fix) are blocked by verifier
    const config = ConfigSchema.parse({
      client: { name: 'TestCo', engagement: 'Pilot' },
      review: { confidenceThreshold: 0.3, severityThreshold: 'low', requireVerifierApproval: true },
      ci: { blockOnPolicy: false },
    });
    const result = await FindingPipeline.process(candidates, makeBundle(), config);

    // 5 bad ones should be verifier-rejected
    const verifierRejected = result.rejected.filter((r) => r.stage === 'verifier');
    expect(verifierRejected.length).toBe(5);

    // At least some good ones published
    expect(result.published.length).toBeGreaterThan(0);

    // Metrics are consistent
    expect(result.metrics.totalCandidates).toBe(11);
    expect(result.metrics.publishedCount).toBe(result.published.length);
  });
});
