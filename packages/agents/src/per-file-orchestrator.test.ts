import type { CandidateFinding, Config, ContextBundle, FileDiff } from '@engagement-harness/core';
import { describe, expect, it, vi } from 'vitest';

import type { AgentOrchestrator } from './orchestrator.js';
import { PerFileOrchestrator } from './per-file-orchestrator.js';
import { makeBundle, makeConfig, makeRuleEntry } from './test-helpers.js';

function fileDiff(p: string): FileDiff {
  return {
    path: p,
    status: 'modified',
    hunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [{ type: 'added', content: `// ${p}`, lineNumber: 1 }],
      },
    ],
  };
}

function candidate(file: string): CandidateFinding {
  return {
    id: `C-${file}`,
    title: `issue in ${file}`,
    category: 'correctness',
    dimension: 'correctness',
    severity: 'medium',
    file,
    lineStart: 1,
    lineEnd: 1,
    evidence: [{ type: 'diff', content: `// ${file}` }],
    whyItMatters: 'matters',
    suggestedFix: 'fix it',
    clientRuleReferences: [],
    falsePositiveRisk: 'low',
    sourceAgent: 'reviewer',
    modelProvider: 'mock',
    remediationReadiness: 'ready',
    verification: { status: 'pending', reason: '' },
  } as CandidateFinding;
}

/** Stub orchestrator that records each context it was given and echoes a finding per file. */
function stubOrchestrator(): {
  orchestrator: AgentOrchestrator;
  seenContexts: ContextBundle[];
} {
  const seenContexts: ContextBundle[] = [];
  const run = vi.fn(async (ctx: ContextBundle, _config: Config) => {
    seenContexts.push(ctx);
    return ctx.diff.map((f) => candidate(f.path));
  });
  return { orchestrator: { run } as unknown as AgentOrchestrator, seenContexts };
}

describe('PerFileOrchestrator.execute', () => {
  it('runs the wrapped orchestrator once per changed file, each with a single-file diff', async () => {
    const { orchestrator, seenContexts } = stubOrchestrator();
    const bundle = makeBundle({ diff: [fileDiff('a.ts'), fileDiff('b.ts'), fileDiff('c.ts')] });

    await new PerFileOrchestrator(orchestrator).execute(bundle, makeConfig());

    expect(seenContexts).toHaveLength(3);
    for (const ctx of seenContexts) {
      expect(ctx.diff).toHaveLength(1);
    }
    expect(seenContexts.map((c) => c.diff[0]!.path).sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('combines findings from every file and tags them pass:local', async () => {
    const { orchestrator } = stubOrchestrator();
    const bundle = makeBundle({ diff: [fileDiff('a.ts'), fileDiff('b.ts')] });

    const findings = await new PerFileOrchestrator(orchestrator).execute(bundle, makeConfig());

    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.pass === 'local')).toBe(true);
    expect(findings.map((f) => f.file).sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('passes shared rule entries into every single-file context', async () => {
    const { orchestrator, seenContexts } = stubOrchestrator();
    const rule = makeRuleEntry();
    const bundle = makeBundle({
      diff: [fileDiff('a.ts'), fileDiff('b.ts')],
      entries: [
        rule,
        { path: 'a.ts', content: 'a', reason: 'changed', priority: 100, kind: 'changed-file' },
      ],
    });

    await new PerFileOrchestrator(orchestrator).execute(bundle, makeConfig());

    for (const ctx of seenContexts) {
      expect(ctx.entries.some((e) => e.kind === 'rule')).toBe(true);
    }
    // The changed-file entry for a.ts only reaches a.ts's context.
    const aCtx = seenContexts.find((c) => c.diff[0]!.path === 'a.ts')!;
    const bCtx = seenContexts.find((c) => c.diff[0]!.path === 'b.ts')!;
    expect(aCtx.entries.some((e) => e.kind === 'changed-file' && e.path === 'a.ts')).toBe(true);
    expect(bCtx.entries.some((e) => e.kind === 'changed-file')).toBe(false);
  });

  it('handles a single-file PR', async () => {
    const { orchestrator, seenContexts } = stubOrchestrator();
    const bundle = makeBundle({ diff: [fileDiff('only.ts')] });

    const findings = await new PerFileOrchestrator(orchestrator).execute(bundle, makeConfig());

    expect(seenContexts).toHaveLength(1);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.pass).toBe('local');
  });
});
