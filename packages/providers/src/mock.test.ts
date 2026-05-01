import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MockProvider } from './mock.js';

describe('MockProvider (deterministic)', () => {
  it('returns the security fixture when prompt mentions the security dimension', async () => {
    const provider = new MockProvider();
    const { content } = await provider.complete('You are an agent.\nDimension: security\n...');
    const parsed = JSON.parse(content) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.category).toBe('security');
    expect(parsed[0]?.sourceAgent).toBe('security');
  });

  it('returns the correctness fixture for the reviewer dimension', async () => {
    const provider = new MockProvider();
    const { content } = await provider.complete('Dimension: correctness');
    const parsed = JSON.parse(content) as Array<Record<string, unknown>>;
    expect(parsed[0]?.dimension).toBe('correctness');
  });

  it('returns the testing fixture for the testing dimension', async () => {
    const provider = new MockProvider();
    const { content } = await provider.complete('Dimension: testing');
    expect(JSON.parse(content)[0]?.dimension).toBe('testing');
  });

  it('returns the domain-policy fixture only when the dimension is present', async () => {
    const provider = new MockProvider();
    const { content } = await provider.complete('Dimension: domain-policy');
    expect(JSON.parse(content)[0]?.dimension).toBe('domain-policy');
  });

  it('returns an empty array when no fixture matches', async () => {
    const provider = new MockProvider();
    const { content } = await provider.complete('something irrelevant');
    expect(content).toBe('[]');
  });

  it('honors a fixture override', async () => {
    const provider = new MockProvider({ fixtures: { 'special-key': '[]' } });
    const { content } = await provider.complete('please match special-KEY here');
    expect(content).toBe('[]');
  });

  it('reports tokensUsed approximated as chars/4', async () => {
    const provider = new MockProvider({ fixtures: { match: 'short' } });
    const { tokensUsed } = await provider.complete('match');
    expect(tokensUsed).toBe(Math.ceil('short'.length / 4));
  });
});

describe('MockProvider (scripted)', () => {
  let dir: string;
  let scriptPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'eh-mock-'));
    scriptPath = path.join(dir, 'script.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('looks up by hash of the first 200 prompt chars', async () => {
    const promptHead = 'audit this diff';
    const { createHash } = await import('node:crypto');
    const key = createHash('sha256').update(promptHead).digest('hex').slice(0, 16);
    writeFileSync(scriptPath, JSON.stringify({ [key]: '[{"hello":"world"}]' }));

    const provider = new MockProvider({ mode: 'scripted', scriptPath });
    const { content } = await provider.complete(promptHead);
    expect(content).toBe('[{"hello":"world"}]');
  });

  it('returns [] when no matching key exists', async () => {
    writeFileSync(scriptPath, JSON.stringify({}));
    const provider = new MockProvider({ mode: 'scripted', scriptPath });
    const { content } = await provider.complete('anything');
    expect(content).toBe('[]');
  });

  it('returns [] when the script file is missing', async () => {
    const provider = new MockProvider({ mode: 'scripted', scriptPath: '/no/such/file.json' });
    const { content } = await provider.complete('anything');
    expect(content).toBe('[]');
  });

  it('exposes a stable scriptKey helper for fixture authoring', () => {
    const a = MockProvider.scriptKey('reviewer', 'prompt body');
    const b = MockProvider.scriptKey('reviewer', 'prompt body');
    const c = MockProvider.scriptKey('security', 'prompt body');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
