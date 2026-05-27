import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GitDiffParser, parseUnifiedDiff } from './diff-parser.js';

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'EH Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'EH Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
}

function initRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'eh-diff-'));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  return repo;
}

function writeFile(repo: string, rel: string, content: string): void {
  const full = path.join(repo, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

describe('parseUnifiedDiff', () => {
  it('returns [] for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });

  it('parses an added file with new file mode', () => {
    const text = [
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      'index 0000000..ce01362',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1,2 @@',
      '+hello',
      '+world',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file?.status).toBe('added');
    expect(file?.path).toBe('new.txt');
    expect(file?.hunks[0]?.lines).toEqual([
      { type: 'added', content: 'hello', lineNumber: 1 },
      { type: 'added', content: 'world', lineNumber: 2 },
    ]);
  });

  it('parses a deleted file', () => {
    const text = [
      'diff --git a/old.txt b/old.txt',
      'deleted file mode 100644',
      'index ce01362..0000000',
      '--- a/old.txt',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-hello',
      '-world',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file?.status).toBe('deleted');
    expect(file?.path).toBe('old.txt');
    expect(file?.hunks[0]?.lines.map((l) => l.type)).toEqual(['removed', 'removed']);
    expect(file?.hunks[0]?.lines[0]).toEqual({ type: 'removed', content: 'hello', lineNumber: 1 });
  });

  it('parses a modified file with mixed lines and correct line numbers', () => {
    const text = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 0000001..0000002 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,4 +1,5 @@',
      ' const x = 1;',
      '-const y = 2;',
      '+const y = 3;',
      '+const z = 4;',
      ' export { x };',
      ' // tail',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file?.status).toBe('modified');
    const lines = file?.hunks[0]?.lines ?? [];
    expect(lines).toEqual([
      { type: 'context', content: 'const x = 1;', lineNumber: 1 },
      { type: 'removed', content: 'const y = 2;', lineNumber: 2 },
      { type: 'added', content: 'const y = 3;', lineNumber: 2 },
      { type: 'added', content: 'const z = 4;', lineNumber: 3 },
      { type: 'context', content: 'export { x };', lineNumber: 4 },
      { type: 'context', content: '// tail', lineNumber: 5 },
    ]);
  });

  it('parses a renamed file with content change', () => {
    const text = [
      'diff --git a/old/a.ts b/new/a.ts',
      'similarity index 80%',
      'rename from old/a.ts',
      'rename to new/a.ts',
      'index 0000001..0000002 100644',
      '--- a/old/a.ts',
      '+++ b/new/a.ts',
      '@@ -1,2 +1,2 @@',
      ' const x = 1;',
      '-const y = 2;',
      '+const y = 3;',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file?.status).toBe('renamed');
    expect(file?.path).toBe('new/a.ts');
    expect(file?.oldPath).toBe('old/a.ts');
    expect(file?.hunks).toHaveLength(1);
  });

  it('parses a binary file with empty hunks', () => {
    const text = [
      'diff --git a/img.png b/img.png',
      'index 0000001..0000002 100644',
      'Binary files a/img.png and b/img.png differ',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file?.status).toBe('binary');
    expect(file?.hunks).toEqual([]);
  });

  it('parses multiple files in one diff', () => {
    const text = [
      'diff --git a/a.txt b/a.txt',
      'index 0000001..0000002 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/b.txt b/b.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/b.txt',
      '@@ -0,0 +1 @@',
      '+brand new',
      '',
    ].join('\n');
    const files = parseUnifiedDiff(text);
    expect(files).toHaveLength(2);
    expect(files[0]?.path).toBe('a.txt');
    expect(files[1]?.path).toBe('b.txt');
    expect(files[1]?.status).toBe('added');
  });

  it('handles "no newline at end of file" markers', () => {
    const text = [
      'diff --git a/a.txt b/a.txt',
      'index 0000001..0000002 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file?.hunks[0]?.lines.map((l) => l.type)).toEqual(['removed', 'added']);
  });
});

describe('GitDiffParser (integration)', () => {
  let repo: string;

  beforeEach(() => {
    repo = initRepo();
    writeFile(
      repo,
      'src/a.ts',
      'const x = 1;\nconst y = 2;\nconst tail1 = 1;\nconst tail2 = 2;\nconst tail3 = 3;\nconst tail4 = 4;\nexport { x };\n',
    );
    writeFile(repo, 'README.md', '# repo\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'init']);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('detects added, modified, deleted, and renamed in one PR', async () => {
    // Modify
    writeFile(repo, 'src/a.ts', 'const x = 1;\nconst y = 3;\nconst z = 4;\nexport { x };\n');
    // Add
    writeFile(repo, 'src/b.ts', 'export const b = 1;\n');
    // Delete
    rmSync(path.join(repo, 'README.md'));
    // Rename (move + small change). Keep similarity > 75% so git detects rename.
    git(repo, ['mv', 'src/a.ts', 'src/renamed.ts']);
    writeFile(
      repo,
      'src/renamed.ts',
      'const x = 1;\nconst y = 999;\nconst tail1 = 1;\nconst tail2 = 2;\nconst tail3 = 3;\nconst tail4 = 4;\nexport { x };\n',
    );

    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'change']);

    const diff = await GitDiffParser.parseDiff(repo, 'HEAD~1', 'HEAD');
    const byPath = new Map(diff.map((d) => [d.path, d]));

    expect(byPath.get('src/b.ts')?.status).toBe('added');
    expect(byPath.get('README.md')?.status).toBe('deleted');
    const renamed = diff.find((d) => d.status === 'renamed');
    expect(renamed?.path).toBe('src/renamed.ts');
    expect(renamed?.oldPath).toBe('src/a.ts');
  });

  it('marks binary files as binary with empty hunks', async () => {
    // 1KB of bytes that include nulls — git treats as binary.
    const buf = Buffer.alloc(1024);
    for (let i = 0; i < buf.length; i++) buf[i] = i % 256;
    writeFileSync(path.join(repo, 'blob.bin'), buf);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'add binary']);

    const diff = await GitDiffParser.parseDiff(repo, 'HEAD~1', 'HEAD');
    const blob = diff.find((d) => d.path === 'blob.bin');
    expect(blob?.status).toBe('binary');
    expect(blob?.hunks).toEqual([]);
  });

  it('returns [] when refs are equal', async () => {
    const diff = await GitDiffParser.parseDiff(repo, 'HEAD', 'HEAD');
    expect(diff).toEqual([]);
  });
});
