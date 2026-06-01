import type { CandidateFinding, ContextBundle, FileDiff } from '@engagement-harness/core';
import type { Provider } from '@engagement-harness/providers';
import { describe, expect, it, vi } from 'vitest';

import { TruthVerifierAgent } from './truth-verifier-agent.js';

function makeProvider(response: string): Provider {
  return {
    name: 'mock',
    complete: vi.fn().mockResolvedValue({ content: response }),
  };
}

function makeDiff(path = 'src/api/users.ts'): FileDiff[] {
  return [
    {
      path,
      status: 'modified',
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 2,
          lines: [
            { type: 'added', content: '  const q = `SELECT * FROM users WHERE id=${req.body.id}`;', lineNumber: 10 },
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

function makeCandidate(overrides: Partial<CandidateFinding> = {}): CandidateFinding {
  return {
    id: 'EH-0001',
    title: 'SQL injection via unsanitized req.body.id',
    category: 'security',
    dimension: 'security',
    severity: 'critical',
    file: 'src/api/users.ts',
    lineStart: 10,
    lineEnd: 10,
    evidence: [{ type: 'diff', content: '  const q = `SELECT * FROM users WHERE id=${req.body.id}`;' }],
    whyItMatters: 'Attacker can dump the database.',
    suggestedFix: "Use a parameterized query: db.query('SELECT * FROM users WHERE id = ?', [req.body.id])",
    clientRuleReferences: [],
    falsePositiveRisk: 'low',
    sourceAgent: 'security',
    modelProvider: 'mock',
    remediationReadiness: 'ready',
    verification: { status: 'pending', reason: '' },
    ...overrides,
  } as CandidateFinding;
}

describe('TruthVerifierAgent.run', () => {
  it('returns empty array when no findings are supplied', async () => {
    const provider = makeProvider('{}');
    const result = await TruthVerifierAgent.run([], makeBundle(), provider);
    expect(result).toEqual([]);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('parses a valid verdicts response', async () => {
    const response = JSON.stringify({
      verdicts: [
        {
          findingId: 'EH-0001',
          decision: 'approved',
          finalSeverity: 'critical',
          confidence: 0.95,
          reason: 'Direct SQL concatenation of user input confirmed in diff.',
          failureType: 'none',
        },
      ],
    });
    const provider = makeProvider(response);
    const verdicts = await TruthVerifierAgent.run([makeCandidate()], makeBundle(), provider);

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]!.findingId).toBe('EH-0001');
    expect(verdicts[0]!.decision).toBe('approved');
    expect(verdicts[0]!.confidence).toBe(0.95);
  });

  it('returns empty array when provider throws', async () => {
    const provider: Provider = {
      name: 'mock',
      complete: vi.fn().mockRejectedValue(new Error('network error')),
    };
    const result = await TruthVerifierAgent.run([makeCandidate()], makeBundle(), provider);
    expect(result).toEqual([]);
  });

  it('returns empty array when response is not parseable JSON', async () => {
    const provider = makeProvider('This is prose, not JSON.');
    const result = await TruthVerifierAgent.run([makeCandidate()], makeBundle(), provider);
    expect(result).toEqual([]);
  });

  it('returns empty array when response schema is invalid', async () => {
    const provider = makeProvider(JSON.stringify({ verdicts: [{ invalid: true }] }));
    const result = await TruthVerifierAgent.run([makeCandidate()], makeBundle(), provider);
    expect(result).toEqual([]);
  });

  it('parses JSON embedded in prose', async () => {
    const response = `Here is my analysis:\n${JSON.stringify({
      verdicts: [
        {
          findingId: 'EH-0001',
          decision: 'rejected',
          finalSeverity: 'medium',
          confidence: 0.6,
          reason: 'ORM handles parameterization already.',
          failureType: 'contradicted_by_evidence',
        },
      ],
    })}\nEnd of analysis.`;
    const provider = makeProvider(response);
    const verdicts = await TruthVerifierAgent.run([makeCandidate()], makeBundle(), provider);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]!.decision).toBe('rejected');
  });

  it('includes all finding fields in the prompt', async () => {
    const provider = makeProvider(JSON.stringify({ verdicts: [] }));
    const candidate = makeCandidate();
    await TruthVerifierAgent.run([candidate], makeBundle(), provider);

    const promptArg = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(promptArg).toContain('EH-0001');
    expect(promptArg).toContain('SQL injection');
    expect(promptArg).toContain('security');
  });

  it('passes system prompt as option', async () => {
    const provider = makeProvider(JSON.stringify({ verdicts: [] }));
    await TruthVerifierAgent.run([makeCandidate()], makeBundle(), provider);

    const opts = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts.system).toContain('strict false-positive reduction verifier');
  });
});
