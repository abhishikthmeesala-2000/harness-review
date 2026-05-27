import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepoProfiler } from './profiler.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'eh-prof-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

describe('RepoProfiler', () => {
  it('detects a TypeScript pnpm Node fixture', () => {
    write(
      'package.json',
      JSON.stringify({
        name: 'demo',
        dependencies: { express: '^4.0.0' },
        devDependencies: { vitest: '^2.0.0' },
      }),
    );
    write('pnpm-lock.yaml', 'lockfileVersion: 9');
    write('src/index.ts', 'export const a = 1;');
    write('src/util.ts', 'export const b = 2;');
    write('tests/index.test.ts', 'test()');
    write('.github/workflows/ci.yml', 'name: CI');

    const p = RepoProfiler.detect(dir);

    expect(p.language).toBe('typescript');
    expect(p.framework).toBe('express');
    expect(p.testFramework).toBe('vitest');
    expect(p.packageManager).toBe('pnpm');
    expect(p.ciProvider).toBe('github');
    expect(p.isMonorepo).toBe(false);
    expect(p.importantPaths).toEqual(expect.arrayContaining(['src', 'tests']));
    expect(p.suggestedIgnoredPaths).toEqual(
      expect.arrayContaining(['**/node_modules/**', '**/dist/**']),
    );
  });

  it('detects a Python + pytest fixture', () => {
    write('requirements.txt', 'flask==2.0.0\npytest==7.0.0\n');
    write('app/__init__.py', '');
    write('app/main.py', 'print("hi")\n');
    write('tests/test_main.py', 'def test(): pass');

    const p = RepoProfiler.detect(dir);

    expect(p.language).toBe('python');
    expect(p.framework).toBe('flask');
    expect(p.testFramework).toBe('pytest');
    expect(p.packageManager).toBe('pip');
    expect(p.ciProvider).toBeNull();
    expect(p.isMonorepo).toBe(false);
    expect(p.suggestedIgnoredPaths).toEqual(expect.arrayContaining(['**/__pycache__/**']));
  });

  it('detects a Go modules fixture', () => {
    write(
      'go.mod',
      'module example.com/demo\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.9.0\n',
    );
    write('main.go', 'package main\nfunc main() {}\n');
    write('handler.go', 'package main\n');
    write('.gitlab-ci.yml', 'stages: []');

    const p = RepoProfiler.detect(dir);

    expect(p.language).toBe('go');
    expect(p.framework).toBe('gin');
    expect(p.packageManager).toBe('go');
    expect(p.ciProvider).toBe('gitlab');
    expect(p.isMonorepo).toBe(false);
  });

  it('detects a pnpm monorepo fixture', () => {
    write('pnpm-workspace.yaml', 'packages:\n  - "packages/*"');
    write('pnpm-lock.yaml', 'lockfileVersion: 9');
    write('package.json', JSON.stringify({ name: 'mono' }));
    write('packages/a/package.json', JSON.stringify({ name: 'a' }));
    write('packages/a/src/index.ts', 'export {};');
    write('packages/b/package.json', JSON.stringify({ name: 'b' }));
    write('packages/b/src/index.ts', 'export {};');

    const p = RepoProfiler.detect(dir);

    expect(p.language).toBe('typescript');
    expect(p.packageManager).toBe('pnpm');
    expect(p.isMonorepo).toBe(true);
  });

  it('returns nullable fields without throwing on a near-empty repo', () => {
    write('README.md', '# hi');
    const p = RepoProfiler.detect(dir);
    expect(p.language).toBeNull();
    expect(p.framework).toBeNull();
    expect(p.packageManager).toBeNull();
    expect(p.testFramework).toBeNull();
    expect(p.ciProvider).toBeNull();
    expect(p.isMonorepo).toBe(false);
    expect(p.importantPaths).toEqual([]);
  });

  it('skips node_modules and .git when scanning', () => {
    write('package.json', JSON.stringify({ name: 'x' }));
    write('node_modules/junk/index.js', 'module.exports = {};');
    write('.git/config', '[core]');
    write('src/index.ts', 'export {};');
    const p = RepoProfiler.detect(dir);
    expect(p.language).toBe('typescript');
  });
});
