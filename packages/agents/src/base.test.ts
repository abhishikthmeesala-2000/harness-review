import type { Provider } from '@engagement-harness/providers';
import { describe, expect, it, vi } from 'vitest';

import { BaseAgent } from './base.js';
import { makeBundle } from './test-helpers.js';

class StubAgent extends BaseAgent {
  readonly id = 'stub';
  readonly dimension = 'correctness';
  readonly description = 'stub';
  promptTemplate(): string {
    return 'Dimension: correctness';
  }
}

function fakeProvider(content: string, name = 'mock'): Provider {
  return { name, complete: async () => ({ content }) };
}

describe('BaseAgent.run', () => {
  it('returns [] when the prompt template returns an empty string', async () => {
    class EmptyAgent extends BaseAgent {
      readonly id = 'empty';
      readonly dimension = 'correctness';
      readonly description = 'empty';
      promptTemplate(): string {
        return '';
      }
    }
    const result = await new EmptyAgent().run(makeBundle(), fakeProvider('[ {"x":1} ]'));
    expect(result).toEqual([]);
  });

  it('returns [] and warns when the provider throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider: Provider = {
      name: 'mock',
      complete: async () => {
        throw new Error('boom');
      },
    };
    const result = await new StubAgent().run(makeBundle(), provider);
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it('extracts a JSON array embedded in surrounding prose', async () => {
    const valid = JSON.stringify([
      {
        id: 'EH-1',
        title: 't',
        category: 'correctness',
        dimension: 'correctness',
        severity: 'low',
        file: 'a.ts',
        lineStart: 1,
        lineEnd: 1,
        evidence: [{ type: 'diff', content: 'x' }],
        whyItMatters: 'w',
        suggestedFix: 's',
        clientRuleReferences: [],
        falsePositiveRisk: 'low',
        sourceAgent: 'reviewer',
        modelProvider: 'mock',
        remediationReadiness: 'ready',
      },
    ]);
    const wrapped = `Sure, here are my findings:\n${valid}\nLet me know if anything else.`;
    const result = await new StubAgent().run(makeBundle(), fakeProvider(wrapped));
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('EH-1');
    // sourceAgent must be overridden by the agent regardless of what the model returned.
    expect(result[0]?.sourceAgent).toBe('stub');
  });

  it('drops malformed candidates with a single warning, keeps valid ones', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const validItem = {
      id: 'EH-1',
      title: 't',
      category: 'correctness',
      dimension: 'correctness',
      severity: 'low',
      file: 'a.ts',
      lineStart: 1,
      lineEnd: 1,
      evidence: [{ type: 'diff', content: 'x' }],
      whyItMatters: 'w',
      suggestedFix: 's',
      clientRuleReferences: [],
      falsePositiveRisk: 'low',
      sourceAgent: 'whatever',
      modelProvider: 'whatever',
      remediationReadiness: 'ready',
    };
    const malformed = { totally: 'wrong' };
    const content = JSON.stringify([malformed, validItem, malformed]);
    const result = await new StubAgent().run(makeBundle(), fakeProvider(content));
    expect(result).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it('returns [] and warns when no JSON array can be found', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await new StubAgent().run(makeBundle(), fakeProvider('not json at all'));
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it('extracts JSON array when trailing text contains brackets like [OWASP-A1]', async () => {
    const validItem = {
      id: 'EH-1',
      title: 't',
      category: 'correctness',
      dimension: 'correctness',
      severity: 'low',
      file: 'a.ts',
      lineStart: 1,
      lineEnd: 1,
      evidence: [{ type: 'diff', content: 'x' }],
      whyItMatters: 'w',
      suggestedFix: 's',
      clientRuleReferences: [],
      falsePositiveRisk: 'low',
      sourceAgent: 'stub',
      modelProvider: 'mock',
      remediationReadiness: 'ready',
    };
    const response = `${JSON.stringify([validItem])}\nSee also: [OWASP-A1] and [OWASP-A3].`;
    const result = await new StubAgent().run(makeBundle(), fakeProvider(response));
    expect(result).toHaveLength(1);
  });

  it('returns [] (not a warning) when model returns plain-text no-findings prose', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await new StubAgent().run(
      makeBundle(),
      fakeProvider('No security issues found.'),
    );
    expect(result).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('overwrites sourceAgent and modelProvider on every accepted candidate', async () => {
    const validItem = {
      id: 'EH-1',
      title: 't',
      category: 'correctness',
      dimension: 'correctness',
      severity: 'low',
      file: 'a.ts',
      lineStart: 1,
      lineEnd: 1,
      evidence: [{ type: 'diff', content: 'x' }],
      whyItMatters: 'w',
      suggestedFix: 's',
      clientRuleReferences: [],
      falsePositiveRisk: 'low',
      sourceAgent: 'lying-agent',
      modelProvider: 'lying-provider',
      remediationReadiness: 'ready',
    };
    const result = await new StubAgent().run(
      makeBundle(),
      fakeProvider(JSON.stringify([validItem]), 'mock-fake'),
    );
    expect(result[0]?.sourceAgent).toBe('stub');
    expect(result[0]?.modelProvider).toBe('mock-fake');
  });
});
