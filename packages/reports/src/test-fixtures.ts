import type { Config } from '@engagement-harness/core';
import type { PipelineResult } from '@engagement-harness/pipeline';

import type { RunMetadata } from './types.js';

export function makeRunMetadata(overrides: Partial<RunMetadata> = {}): RunMetadata {
  return {
    runId: '20260504T120000Z',
    timestamp: '2026-05-04T12:00:00.000Z',
    baseRef: 'abc123',
    headRef: 'def456',
    repoProfile: {
      language: 'typescript',
      framework: null,
      packageManager: 'pnpm',
      testFramework: 'vitest',
      ciProvider: 'github',
      isMonorepo: true,
      importantPaths: [],
      suggestedIgnoredPaths: [],
    },
    agentsRun: ['security', 'reviewer'],
    providersUsed: ['mock'],
    ...overrides,
  };
}

export function makePipelineResult(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
    published: [
      {
        id: 'EH-0001',
        title: 'Missing authentication check',
        category: 'security',
        dimension: 'security',
        severity: 'high',
        file: 'src/auth.ts',
        lineStart: 10,
        lineEnd: 15,
        evidence: [{ type: 'diff', content: '+  return true; // no auth check' }],
        whyItMatters: 'Unauthenticated access to sensitive endpoint.',
        suggestedFix: 'Add authentication middleware before the route handler.',
        clientRuleReferences: [],
        falsePositiveRisk: 'low',
        sourceAgent: 'security',
        modelProvider: 'mock',
        remediationReadiness: 'ready',
        confidence: 0.9,
        verification: { status: 'approved', reason: 'Evidence found in diff' },
      },
    ],
    rejected: [],
    decision: 'approved_with_warnings',
    dimensionConfidence: { security: 0.9 },
    overallConfidence: 0.9,
    metrics: {
      totalCandidates: 1,
      publishedCount: 1,
      rejectedByStage: {},
      verifierApprovalRate: 1,
      evidenceDistribution: { none: 0, weak: 0, medium: 0, strong: 1 },
    },
    ...overrides,
  };
}

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    client: { name: 'Test Client', engagement: 'test-engagement' },
    review: { confidenceThreshold: 0.8, severityThreshold: 'low', requireVerifierApproval: true },
    agents: { enabled: ['security', 'reviewer'] },
    models: {},
    providers: { mock: {} },
    context: { ignoredPaths: [], maxFiles: 30, maxTokens: 80000 },
    ci: { blockOnPolicy: false, postComments: false, artifactsOnly: true },
    alm: { platform: 'none' },
    feedback: { enabled: true },
    reports: { formats: ['json', 'markdown', 'html'], outputDir: '.engagement-harness/reports' },
    ...overrides,
  } as Config;
}
