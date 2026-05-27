import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkIfGitRepo, detectGitPlatform, getCurrentBranch, getRemoteUrl } from './git.js';

const NONEXISTENT = '/eh-test-nonexistent-path-that-cannot-exist-abcdef123';

describe('checkIfGitRepo', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'eh-git-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns true inside a git repo', async () => {
    execSync('git init', { cwd: dir, stdio: 'pipe' });
    expect(await checkIfGitRepo(dir)).toBe(true);
  });

  it('returns false when cwd does not exist (git throws ENOENT)', async () => {
    expect(await checkIfGitRepo(NONEXISTENT)).toBe(false);
  });
});

describe('detectGitPlatform', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'eh-git-'));
    execSync('git init', { cwd: dir, stdio: 'pipe' });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ['git@github.com:user/repo.git', 'github'],
    ['https://github.com/user/repo', 'github'],
    ['https://gitlab.com/user/repo', 'gitlab'],
    ['https://user@dev.azure.com/org/proj/_git/repo', 'azure-devops'],
    ['https://org.visualstudio.com/proj/_git/repo', 'azure-devops'],
    ['https://bitbucket.org/user/repo', 'bitbucket'],
  ])('detects platform from remote URL %s → %s', async (url, expected) => {
    execSync(`git remote add origin ${url}`, { cwd: dir, stdio: 'pipe' });
    expect(await detectGitPlatform(dir)).toBe(expected);
  });

  it('returns null when no remote is set', async () => {
    expect(await detectGitPlatform(dir)).toBeNull();
  });

  it('returns null for unrecognised remote URL', async () => {
    execSync('git remote add origin https://unknown-host.example.com/repo', {
      cwd: dir,
      stdio: 'pipe',
    });
    expect(await detectGitPlatform(dir)).toBeNull();
  });
});

describe('getCurrentBranch', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'eh-git-'));
    execSync('git init', { cwd: dir, stdio: 'pipe' });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns a non-empty string in a git repo', async () => {
    const branch = await getCurrentBranch(dir);
    expect(typeof branch).toBe('string');
    expect(branch.length).toBeGreaterThan(0);
  });

  it('returns "main" fallback when cwd does not exist', async () => {
    expect(await getCurrentBranch(NONEXISTENT)).toBe('main');
  });
});

describe('getRemoteUrl', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'eh-git-'));
    execSync('git init', { cwd: dir, stdio: 'pipe' });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the remote URL when set', async () => {
    execSync('git remote add origin https://github.com/user/repo.git', {
      cwd: dir,
      stdio: 'pipe',
    });
    expect(await getRemoteUrl(dir)).toBe('https://github.com/user/repo.git');
  });

  it('returns null when no remote is set', async () => {
    expect(await getRemoteUrl(dir)).toBeNull();
  });

  it('returns null when cwd does not exist', async () => {
    expect(await getRemoteUrl(NONEXISTENT)).toBeNull();
  });
});
