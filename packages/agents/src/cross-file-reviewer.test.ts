import type { CandidateFinding, FileDiff } from '@engagement-harness/core';
import type { Provider } from '@engagement-harness/providers';
import { describe, expect, it, vi } from 'vitest';

import { CrossFileReviewer } from './cross-file-reviewer.js';
import { makeBundle } from './test-helpers.js';

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
        lines: [{ type: 'added', content: `call(${p})`, lineNumber: 1 }],
      },
    ],
  };
}

function integrationCandidateJson(): string {
  return JSON.stringify([
    {
      id: 'X-1',
      title: 'Caller passes string id but callee expects number',
      category: 'correctness',
      dimension: 'integration',
      severity: 'high',
      file: 'caller.ts',
      lineStart: 1,
      lineEnd: 1,
      evidence: [{ type: 'diff', content: 'call(caller.ts)' }],
      whyItMatters: 'Contract mismatch causes a runtime type error.',
      suggestedFix: 'Coerce or align the types across both files.',
      clientRuleReferences: [],
      falsePositiveRisk: 'low',
      sourceAgent: 'placeholder',
      modelProvider: 'placeholder',
      remediationReadiness: 'ready',
    },
  ]);
}

function stubProvider(response: string): {
  provider: Provider;
  complete: ReturnType<typeof vi.fn>;
} {
  const complete = vi.fn(async (_prompt: string) => ({ content: response }));
  return { provider: { name: 'stub', complete } as unknown as Provider, complete };
}

describe('CrossFileReviewer.execute', () => {
  it('returns [] and does not call the provider when only one file changed', async () => {
    const { provider, complete } = stubProvider('[]');
    const bundle = makeBundle({ diff: [fileDiff('only.ts')] });

    const findings = await new CrossFileReviewer(provider).execute(bundle, []);

    expect(findings).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });

  it('tags returned findings with pass:integration and sourceAgent cross-file', async () => {
    const { provider } = stubProvider(integrationCandidateJson());
    const bundle = makeBundle({ diff: [fileDiff('caller.ts'), fileDiff('callee.ts')] });

    const findings = await new CrossFileReviewer(provider).execute(bundle, []);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.pass).toBe('integration');
    expect(findings[0]!.sourceAgent).toBe('cross-file');
    expect(findings[0]!.modelProvider).toBe('stub');
  });

  it('builds a prompt containing all file paths and the cross-file patterns', async () => {
    const { provider, complete } = stubProvider('[]');
    const bundle = makeBundle({ diff: [fileDiff('caller.ts'), fileDiff('callee.ts')] });

    await new CrossFileReviewer(provider).execute(bundle, []);

    const prompt = complete.mock.calls[0]![0] as string;
    expect(prompt).toContain('caller.ts');
    expect(prompt).toContain('callee.ts');
    expect(prompt).toContain('API CONTRACT MISMATCHES');
    expect(prompt).toContain('MISSING ERROR PROPAGATION');
    expect(prompt).toContain('SHARED STATE MUTATIONS');
    expect(prompt).toContain('Dimension: integration');
  });

  it('injects pass-1 findings into the prompt as already-reported context', async () => {
    const { provider, complete } = stubProvider('[]');
    const bundle = makeBundle({ diff: [fileDiff('caller.ts'), fileDiff('callee.ts')] });
    const pass1: CandidateFinding[] = [
      {
        id: 'P1-1',
        title: 'Known local issue',
        category: 'security',
        dimension: 'security',
        severity: 'high',
        file: 'caller.ts',
        lineStart: 5,
        lineEnd: 5,
        evidence: [{ type: 'diff', content: 'x' }],
        whyItMatters: 'matters',
        suggestedFix: 'fix',
        clientRuleReferences: [],
        falsePositiveRisk: 'low',
        sourceAgent: 'security',
        modelProvider: 'mock',
        remediationReadiness: 'ready',
        verification: { status: 'pending', reason: '' },
      } as CandidateFinding,
    ];

    await new CrossFileReviewer(provider).execute(bundle, pass1);

    const prompt = complete.mock.calls[0]![0] as string;
    expect(prompt).toContain('ALREADY-REPORTED FINDINGS');
    expect(prompt).toContain('Known local issue');
  });

  it('returns [] when the provider throws', async () => {
    const complete = vi.fn(async () => {
      throw new Error('boom');
    });
    const provider = { name: 'stub', complete } as unknown as Provider;
    const bundle = makeBundle({ diff: [fileDiff('caller.ts'), fileDiff('callee.ts')] });

    const findings = await new CrossFileReviewer(provider).execute(bundle, []);
    expect(findings).toEqual([]);
  });
});
