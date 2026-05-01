import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema, type Config } from '../schemas/config.js';
import type { FileDiff } from '../git/diff-parser.js';
import type { RepoProfile } from '../profile/profiler.js';
import { ContextEngine } from './engine.js';

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

function buildConfig(overrides: Partial<Config['context']> = {}): Config {
  return ConfigSchema.parse({
    client: { name: 'TestCo', engagement: 'PilotEngagement' },
    context: {
      ignoredPaths: overrides.ignoredPaths ?? [],
      maxFiles: overrides.maxFiles ?? 30,
      maxTokens: overrides.maxTokens ?? 80000,
    },
  });
}

function setupRepo(): string {
  return mkdtempSync(path.join(tmpdir(), 'eh-ctx-'));
}

function write(repo: string, rel: string, content: string): void {
  const full = path.join(repo, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function modifiedDiff(filePath: string): FileDiff {
  return {
    path: filePath,
    status: 'modified',
    hunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [{ type: 'added', content: 'noop', lineNumber: 1 }],
      },
    ],
  };
}

describe('ContextEngine.build', () => {
  let repo: string;
  beforeEach(() => {
    repo = setupRepo();
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('includes the changed file with priority 100 and the right reason', () => {
    write(repo, 'src/foo.ts', "export const foo = 'bar';\n");
    const bundle = ContextEngine.build([modifiedDiff('src/foo.ts')], repo, PROFILE, buildConfig());
    const entry = bundle.entries.find((e) => e.path === 'src/foo.ts' && e.kind === 'changed-file');
    expect(entry).toBeDefined();
    expect(entry?.priority).toBe(100);
    expect(entry?.reason).toBe('Changed file');
    expect(entry?.content).toContain('export const foo');
  });

  it('finds sibling test files with priority 80', () => {
    write(repo, 'src/foo.ts', 'export const foo = 1;\n');
    write(repo, 'src/foo.test.ts', "import './foo.js';\n");
    const bundle = ContextEngine.build([modifiedDiff('src/foo.ts')], repo, PROFILE, buildConfig());
    const test = bundle.entries.find((e) => e.kind === 'test');
    expect(test?.path).toBe('src/foo.test.ts');
    expect(test?.priority).toBe(80);
    expect(test?.reason).toContain('src/foo.ts');
  });

  it('finds tests/ mirrored test files', () => {
    write(repo, 'src/feature/bar.ts', 'export const x = 1;\n');
    write(repo, 'tests/feature/bar.test.ts', 'import "../../src/feature/bar.js";\n');
    const bundle = ContextEngine.build(
      [modifiedDiff('src/feature/bar.ts')],
      repo,
      PROFILE,
      buildConfig(),
    );
    const test = bundle.entries.find((e) => e.kind === 'test');
    expect(test?.path).toBe(path.join('tests', 'feature', 'bar.test.ts'));
  });

  it('attaches matching rules with priority 90', () => {
    write(repo, 'src/payments/charge.ts', 'export function charge() {}\n');
    write(
      repo,
      '.engagement-harness/rules/payments.md',
      ['---', 'glob: "src/payments/**"', '---', '', 'Idempotency required.'].join('\n'),
    );
    const bundle = ContextEngine.build(
      [modifiedDiff('src/payments/charge.ts')],
      repo,
      PROFILE,
      buildConfig(),
    );
    const rule = bundle.entries.find((e) => e.kind === 'rule');
    expect(rule).toBeDefined();
    expect(rule?.priority).toBe(90);
    expect(rule?.content).toContain('Idempotency required');
    expect(rule?.reason).toContain('src/payments/charge.ts');
  });

  it('supports rules with multiple globs (array form)', () => {
    write(repo, 'src/billing/cycle.ts', 'export const cycle = 1;\n');
    write(
      repo,
      '.engagement-harness/rules/finance.md',
      ['---', 'globs:', '  - "src/payments/**"', '  - "src/billing/**"', '---', 'Body.'].join('\n'),
    );
    const bundle = ContextEngine.build(
      [modifiedDiff('src/billing/cycle.ts')],
      repo,
      PROFILE,
      buildConfig(),
    );
    expect(bundle.entries.find((e) => e.kind === 'rule')).toBeDefined();
  });

  it('includes 1-hop imports of changed files with priority 60', () => {
    write(repo, 'src/foo.ts', "import { bar } from './bar.js';\nexport const foo = bar;\n");
    write(repo, 'src/bar.ts', 'export const bar = 1;\n');
    const bundle = ContextEngine.build([modifiedDiff('src/foo.ts')], repo, PROFILE, buildConfig());
    const imp = bundle.entries.find((e) => e.path === 'src/bar.ts');
    expect(imp).toBeDefined();
    expect(imp?.kind).toBe('imports');
    expect(imp?.priority).toBe(60);
    expect(imp?.reason).toContain('Imported by changed file src/foo.ts');
  });

  it('includes 1-hop importers (files importing the changed file) with priority 70', () => {
    write(repo, 'src/foo.ts', 'export const foo = 1;\n');
    write(repo, 'src/uses-foo.ts', "import { foo } from './foo.js';\nexport const x = foo;\n");
    const bundle = ContextEngine.build([modifiedDiff('src/foo.ts')], repo, PROFILE, buildConfig());
    const importer = bundle.entries.find((e) => e.path === 'src/uses-foo.ts');
    expect(importer).toBeDefined();
    expect(importer?.kind).toBe('imported-by');
    expect(importer?.priority).toBe(70);
    expect(importer?.reason).toContain('Imports changed file src/foo.ts');
  });

  it('honors ignoredPaths globs', () => {
    write(repo, 'src/foo.ts', 'export const foo = 1;\n');
    write(repo, 'src/legacy/old.ts', 'export const old = 1;\n');
    write(repo, 'src/uses-foo.ts', "import { foo } from './foo.js';\nexport const x = foo;\n");
    const cfg = buildConfig({ ignoredPaths: ['**/legacy/**', 'src/uses-foo.ts'] });
    const bundle = ContextEngine.build(
      [modifiedDiff('src/foo.ts'), modifiedDiff('src/legacy/old.ts')],
      repo,
      PROFILE,
      cfg,
    );
    expect(bundle.entries.find((e) => e.path === 'src/legacy/old.ts')).toBeUndefined();
    expect(bundle.entries.find((e) => e.path === 'src/uses-foo.ts')).toBeUndefined();
    // Ignored diff entries are also removed.
    expect(bundle.diff.find((d) => d.path === 'src/legacy/old.ts')).toBeUndefined();
  });

  it('drops lowest-priority entries when over maxFiles', () => {
    // Changed file (100) + test (80) + import (60) -> with maxFiles=2 we drop import.
    write(repo, 'src/foo.ts', "import { bar } from './bar.js';\nexport const foo = bar;\n");
    write(repo, 'src/foo.test.ts', "import './foo.js';\n");
    write(repo, 'src/bar.ts', 'export const bar = 1;\n');
    const cfg = buildConfig({ maxFiles: 2 });
    const bundle = ContextEngine.build([modifiedDiff('src/foo.ts')], repo, PROFILE, cfg);
    expect(bundle.entries).toHaveLength(2);
    const kinds = bundle.entries.map((e) => e.kind).sort();
    expect(kinds).toEqual(['changed-file', 'test']);
  });

  it('drops lowest-priority entries when over maxTokens', () => {
    write(repo, 'src/foo.ts', "import { bar } from './bar.js';\n" + 'a'.repeat(200) + '\n');
    write(repo, 'src/bar.ts', 'b'.repeat(2000) + '\n');
    // chars/4 tokens: foo ~50, bar ~500. Setting maxTokens=200 keeps foo, drops bar.
    const cfg = buildConfig({ maxTokens: 200 });
    const bundle = ContextEngine.build([modifiedDiff('src/foo.ts')], repo, PROFILE, cfg);
    expect(bundle.entries.find((e) => e.path === 'src/foo.ts')).toBeDefined();
    expect(bundle.entries.find((e) => e.path === 'src/bar.ts')).toBeUndefined();
  });

  it('exposes prMetadata when provided', () => {
    write(repo, 'src/foo.ts', 'export const foo = 1;\n');
    const bundle = ContextEngine.build([modifiedDiff('src/foo.ts')], repo, PROFILE, buildConfig(), {
      prMetadata: { title: 'feat: foo', body: 'closes #1' },
    });
    expect(bundle.prMetadata?.title).toBe('feat: foo');
    expect(bundle.prMetadata?.body).toBe('closes #1');
  });

  it('passes the repo profile through unchanged', () => {
    write(repo, 'src/foo.ts', 'export const foo = 1;\n');
    const bundle = ContextEngine.build([modifiedDiff('src/foo.ts')], repo, PROFILE, buildConfig());
    expect(bundle.repoProfile).toEqual(PROFILE);
  });

  it('skips deleted and binary files for content inclusion', () => {
    const diff: FileDiff[] = [
      { path: 'src/gone.ts', status: 'deleted', hunks: [] },
      { path: 'img.png', status: 'binary', hunks: [] },
    ];
    const bundle = ContextEngine.build(diff, repo, PROFILE, buildConfig());
    expect(bundle.entries).toHaveLength(0);
  });

  it('detects Python imports', () => {
    write(repo, 'src/main.py', 'from src.helpers import util\n');
    write(repo, 'src/helpers.py', 'def util():\n    pass\n');
    const bundle = ContextEngine.build([modifiedDiff('src/main.py')], repo, PROFILE, buildConfig());
    expect(bundle.entries.find((e) => e.path === 'src/helpers.py')).toBeDefined();
  });
});
