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

describe('MockProvider (diff-context patching)', () => {
  // Prompt with a suspicious security line (hardcoded password)
  const SECURITY_DIFF_PROMPT = [
    'You are the Security agent.',
    'Dimension: security',
    'Changed files:',
    '--- payment.js (modified)',
    '@@ -10,11 +10,11 @@',
    ' const a = 1;',
    '-const old = doThing();',
    '+const dbConfig = { password: "SuperSecret123!" };',
  ].join('\n');

  // Prompt with a neutral change (no security-suspicious content)
  const NEUTRAL_DIFF_PROMPT = [
    'You are the Security agent.',
    'Dimension: security',
    'Changed files:',
    '--- payment.js (modified)',
    '@@ -10,11 +10,11 @@',
    ' const a = 1;',
    '-const old = doThing();',
    '+const newVal = doOtherThing();',
  ].join('\n');

  it('patches file to the actual changed file from diff', async () => {
    const provider = new MockProvider();
    const { content } = await provider.complete(SECURITY_DIFF_PROMPT);
    const findings = JSON.parse(content) as Array<Record<string, unknown>>;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe('payment.js');
  });

  it('patches lineStart and lineEnd to the actual hunk range', async () => {
    const provider = new MockProvider();
    const { content } = await provider.complete(SECURITY_DIFF_PROMPT);
    const findings = JSON.parse(content) as Array<Record<string, unknown>>;
    expect(findings[0]?.lineStart).toBe(10);
    expect(findings[0]?.lineEnd).toBe(20); // 10 + 11 - 1
  });

  it('does NOT use hardcoded path (src/routes/admin.ts) when real diff is present', async () => {
    const provider = new MockProvider();
    const { content } = await provider.complete(SECURITY_DIFF_PROMPT);
    const findings = JSON.parse(content) as Array<Record<string, unknown>>;
    expect(findings[0]?.file).not.toBe('src/routes/admin.ts');
  });

  it('updates diff evidence to the suspicious line when security pattern found', async () => {
    const provider = new MockProvider();
    const { content } = await provider.complete(SECURITY_DIFF_PROMPT);
    const findings = JSON.parse(content) as Array<Record<string, unknown>>;
    const evidence = findings[0]?.evidence as Array<Record<string, unknown>>;
    const diffEvidence = evidence.find((e) => e['type'] === 'diff');
    expect(diffEvidence?.['content']).toBe('const dbConfig = { password: "SuperSecret123!" };');
  });

  it('keeps original evidence when no security pattern found in diff (verifier handles rejection)', async () => {
    const provider = new MockProvider();
    const { content } = await provider.complete(NEUTRAL_DIFF_PROMPT);
    const findings = JSON.parse(content) as Array<Record<string, unknown>>;
    const evidence = findings[0]?.evidence as Array<Record<string, unknown>>;
    const diffEvidence = evidence.find((e) => e['type'] === 'diff');
    // Original hardcoded evidence preserved — verifier will reject if not in diff
    expect(diffEvidence?.['content']).toBe('app.post("/admin/delete", async (req, res) => {');
    // But file is still patched
    expect(findings[0]?.file).toBe('payment.js');
  });

  it('falls back to fixture paths when prompt has no diff', async () => {
    const provider = new MockProvider();
    const { content } = await provider.complete('Dimension: security\n(no diff here)');
    const findings = JSON.parse(content) as Array<Record<string, unknown>>;
    expect(findings[0]?.file).toBe('src/routes/admin.ts');
  });

  it('works with diff --git format', async () => {
    const gitPrompt = [
      'Dimension: security',
      'diff --git a/api/auth.py b/api/auth.py',
      '@@ -5,3 +5,4 @@',
      "+app.route('/admin', async (req) => {",
    ].join('\n');
    const provider = new MockProvider();
    const { content } = await provider.complete(gitPrompt);
    const findings = JSON.parse(content) as Array<Record<string, unknown>>;
    expect(findings[0]?.file).toBe('api/auth.py');
    expect(findings[0]?.lineStart).toBe(5);
  });

  it('detects SQL injection via template literals as suspicious', async () => {
    const sqlPrompt = [
      'Dimension: security',
      '--- server.js (added)',
      '@@ -0,0 +1,5 @@',
      '+const q = `SELECT * FROM users WHERE id = ${userId}`;',
    ].join('\n');
    const provider = new MockProvider();
    const { content } = await provider.complete(sqlPrompt);
    const findings = JSON.parse(content) as Array<Record<string, unknown>>;
    const evidence = findings[0]?.evidence as Array<Record<string, unknown>>;
    const diffEvidence = evidence.find((e) => e['type'] === 'diff');
    expect(diffEvidence?.['content']).toContain('SELECT * FROM users');
  });

  it('treats a [REDACTED_SECRET] line as suspicious (real pipeline redacts before mock sees prompt)', async () => {
    const redactedPrompt = [
      'You are the Security agent.',
      'Dimension: security',
      'Changed files:',
      '--- config.js (modified)',
      '@@ -1,3 +1,3 @@',
      ' const host = "localhost";',
      '+const dbConfig = { password: [REDACTED_SECRET], database: "myapp" };',
    ].join('\n');
    const provider = new MockProvider();
    const { content } = await provider.complete(redactedPrompt);
    const findings = JSON.parse(content) as Array<Record<string, unknown>>;
    const evidence = findings[0]?.evidence as Array<Record<string, unknown>>;
    const diffEvidence = evidence.find((e) => e['type'] === 'diff');
    expect(diffEvidence?.['content']).toContain('[REDACTED_SECRET]');
    expect(findings[0]?.file).toBe('config.js');
  });

  it('suppresses the security fixture for framework-managed auth / escaping patterns', async () => {
    const safePrompt = [
      'You are the Security agent.',
      'Dimension: security',
      'Changed files:',
      '--- src/components/profile.tsx (modified)',
      '@@ -1,3 +1,4 @@',
      '+// JSX auto-escapes user input',
      '+return <div>{name}</div>;',
      '+router.use(requireAdmin());',
    ].join('\n');
    const provider = new MockProvider();
    const { content } = await provider.complete(safePrompt);
    expect(content).toBe('[]');
  });

  it('suppresses the correctness fixture for intentionally inclusive boundaries', async () => {
    const safePrompt = [
      'You are the Reviewer agent.',
      'Dimension: correctness',
      'Changed files:',
      '--- src/utils/range.ts (modified)',
      '@@ -1,3 +1,7 @@',
      '+// inclusive by design: end is part of the contract',
      '+export function inclusiveRange(start: number, end: number): number[] {',
      '+  const result: number[] = [];',
      '+  for (let i = start; i <= end; i++) {',
      '+    result.push(i);',
      '+  }',
      '+}',
    ].join('\n');
    const provider = new MockProvider();
    const { content } = await provider.complete(safePrompt);
    expect(content).toBe('[]');
  });

  it('suppresses the testing fixture when the diff includes direct test coverage', async () => {
    const safePrompt = [
      'You are the Testing agent.',
      'Dimension: testing',
      'Changed files:',
      '--- src/utils/range.ts (modified)',
      '@@ -1,1 +1,5 @@',
      '+export function inclusiveRange(start: number, end: number): number[] {',
      '+  const result: number[] = [];',
      '+  for (let i = start; i <= end; i++) {',
      '+    result.push(i);',
      '+  }',
      '--- src/utils/range.test.ts (added)',
      '@@ -0,0 +1,6 @@',
      '+describe("inclusiveRange", () => {',
      '+  it("includes both endpoints", () => {',
      '+    expect(inclusiveRange(1, 3)).toEqual([1, 2, 3]);',
      '+  });',
      '+});',
    ].join('\n');
    const provider = new MockProvider();
    const { content } = await provider.complete(safePrompt);
    expect(content).toBe('[]');
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
