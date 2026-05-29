import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigLoader } from '@engagement-harness/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliError } from '../utils/errors.js';
import { runInit } from './init.js';
import { removeGitignoreEntries, runUninit } from './uninit.js';

let dir: string;
const noopLog = (): void => {};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'eh-uninit-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('removeGitignoreEntries', () => {
  it('removes all three engagement-harness gitignore entries', () => {
    writeFileSync(
      path.join(dir, '.gitignore'),
      [
        'node_modules',
        '.engagement-harness/reports/',
        '.engagement-harness/feedback/feedback-*.json',
        '!.engagement-harness/feedback/metrics.json',
        'dist/',
      ].join('\n') + '\n',
      'utf8',
    );
    removeGitignoreEntries(dir);
    const body = readFileSync(path.join(dir, '.gitignore'), 'utf8');
    expect(body).toContain('node_modules');
    expect(body).toContain('dist/');
    expect(body).not.toContain('.engagement-harness/reports/');
    expect(body).not.toContain('feedback-*.json');
    expect(body).not.toContain('metrics.json');
  });

  it('returns false when .gitignore does not exist', () => {
    expect(removeGitignoreEntries(dir)).toBe(false);
  });

  it('is a no-op when entries are absent', () => {
    writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n', 'utf8');
    const changed = removeGitignoreEntries(dir);
    expect(changed).toBe(false);
    expect(readFileSync(path.join(dir, '.gitignore'), 'utf8')).toBe('node_modules\n');
  });
});

describe('runUninit', () => {
  it('throws CliError when not initialized', async () => {
    await expect(runUninit({ cwd: dir, yes: true, log: noopLog })).rejects.toBeInstanceOf(CliError);
  });

  it('removes .engagement-harness directory', async () => {
    await runInit({ cwd: dir, yes: true, log: noopLog });
    expect(existsSync(path.join(dir, '.engagement-harness'))).toBe(true);

    await runUninit({ cwd: dir, yes: true, log: noopLog });
    expect(existsSync(path.join(dir, '.engagement-harness'))).toBe(false);
  });

  it('removes workflow files when present', async () => {
    await runInit({ cwd: dir, yes: true, log: noopLog });
    const wfDir = path.join(dir, '.github', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    for (const wf of ['engagement-harness.yml', 'feedback-on-merge.yml', 'collect-feedback.yml']) {
      writeFileSync(path.join(wfDir, wf), '# placeholder', 'utf8');
    }

    await runUninit({ cwd: dir, yes: true, log: noopLog });

    for (const wf of ['engagement-harness.yml', 'feedback-on-merge.yml', 'collect-feedback.yml']) {
      expect(existsSync(path.join(wfDir, wf))).toBe(false);
    }
  });

  it('removes gitignore entries', async () => {
    writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n', 'utf8');
    await runInit({ cwd: dir, yes: true, log: noopLog });
    const before = readFileSync(path.join(dir, '.gitignore'), 'utf8');
    expect(before).toContain('.engagement-harness/reports/');

    await runUninit({ cwd: dir, yes: true, log: noopLog });
    const after = readFileSync(path.join(dir, '.gitignore'), 'utf8');
    expect(after).not.toContain('.engagement-harness');
    expect(after).toContain('node_modules');
  });

  it('allows re-init after uninit', async () => {
    await runInit({ cwd: dir, yes: true, log: noopLog });
    await runUninit({ cwd: dir, yes: true, log: noopLog });
    await expect(runInit({ cwd: dir, yes: true, log: noopLog })).resolves.not.toThrow();
    expect(ConfigLoader.exists(dir)).toBe(true);
  });
});
