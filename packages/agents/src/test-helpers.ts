import {
  CandidateFindingSchema,
  ConfigSchema,
  type CandidateFinding,
  type Config,
  type ContextBundle,
  type ContextEntry,
  type FileDiff,
  type RepoProfile,
} from '@engagement-harness/core';

const PROFILE: RepoProfile = {
  language: 'typescript',
  framework: null,
  packageManager: 'pnpm',
  testFramework: 'vitest',
  ciProvider: null,
  isMonorepo: false,
  importantPaths: [],
  suggestedIgnoredPaths: [],
};

export function makeDiff(): FileDiff[] {
  return [
    {
      path: 'src/admin/route.ts',
      status: 'modified',
      hunks: [
        {
          oldStart: 10,
          oldLines: 1,
          newStart: 10,
          newLines: 5,
          lines: [
            {
              type: 'added',
              content: 'app.post("/admin/delete", async (req, res) => {',
              lineNumber: 12,
            },
            { type: 'added', content: '  await deleteUser(req.body.id);', lineNumber: 13 },
            { type: 'added', content: '});', lineNumber: 14 },
          ],
        },
      ],
    },
  ];
}

export function makeBundle(overrides: Partial<ContextBundle> = {}): ContextBundle {
  const diff = overrides.diff ?? makeDiff();
  return {
    entries: overrides.entries ?? [],
    diff,
    repoProfile: overrides.repoProfile ?? PROFILE,
    prMetadata: overrides.prMetadata,
  };
}

export function makeRuleEntry(): ContextEntry {
  return {
    path: '.engagement-harness/rules/payments.md',
    content: 'All payment handlers must enforce idempotency by reading Idempotency-Key.',
    reason: 'Rule applies to src/payments/charge.ts',
    priority: 90,
    kind: 'rule',
  };
}

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return ConfigSchema.parse({
    client: { name: 'TestCo', engagement: 'Pilot' },
    agents: { enabled: ['reviewer', 'security', 'domain-policy', 'testing'] },
    models: {},
    ...overrides,
  });
}

export function assertAllValidCandidates(
  candidates: unknown[],
): asserts candidates is CandidateFinding[] {
  for (const c of candidates) {
    const result = CandidateFindingSchema.safeParse(c);
    if (!result.success) {
      throw new Error(`candidate failed schema: ${JSON.stringify(result.error.issues)}`);
    }
  }
}
