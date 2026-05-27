import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigLoader } from '@engagement-harness/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError } from '../utils/errors.js';
import {
  buildConfigFromAnswers,
  defaultAnswersFromProfile,
  initCommand,
  runInit,
  setupCiWorkflow,
} from './init.js';

let dir: string;
const noopLog = (): void => {};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'eh-init-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('buildConfigFromAnswers', () => {
  it('builds a valid config from defaults', () => {
    const profile = {
      language: 'typescript' as const,
      framework: null,
      packageManager: 'pnpm' as const,
      testFramework: null,
      ciProvider: 'github' as const,
      isMonorepo: false,
      importantPaths: ['src'],
      suggestedIgnoredPaths: ['**/node_modules/**'],
    };
    const answers = defaultAnswersFromProfile('/tmp/my-repo', profile);
    const config = buildConfigFromAnswers(answers);
    expect(config.client.name).toBe('my-repo');
    expect(config.alm.platform).toBe('github');
    expect(config.context.ignoredPaths).toEqual(['**/node_modules/**']);
    expect(config.agents.enabled.length).toBeGreaterThan(0);
    for (const id of config.agents.enabled) {
      expect(config.models[id]).toBe('anthropic');
    }
    expect(config.providers.anthropic).toEqual({ model: 'claude-haiku-4-5-20251001' });
  });
});

describe('runInit (--yes path)', () => {
  it('writes a valid config and scaffold', async () => {
    await runInit({ cwd: dir, yes: true, log: noopLog });

    const configPath = path.join(dir, '.engagement-harness', 'config.json');
    expect(existsSync(configPath)).toBe(true);
    const config = ConfigLoader.load(dir);
    expect(config.client.name).toBe(path.basename(dir));
    expect(config.client.engagement).toBe('pilot');
    expect(config.review.confidenceThreshold).toBe(0.8);
    expect(config.feedback.enabled).toBe(true);

    for (const sub of ['rules/README.md', 'evals/README.md', 'examples/README.md']) {
      expect(existsSync(path.join(dir, '.engagement-harness', sub))).toBe(true);
    }
    for (const keep of ['reports/.gitkeep', 'feedback/.gitkeep']) {
      expect(existsSync(path.join(dir, '.engagement-harness', keep))).toBe(true);
    }
  });

  it('appends gitignore entries without duplicating', async () => {
    writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n', 'utf8');
    await runInit({ cwd: dir, yes: true, log: noopLog });
    const body1 = readFileSync(path.join(dir, '.gitignore'), 'utf8');
    expect(body1).toContain('.engagement-harness/reports/');
    expect(body1).toContain('.engagement-harness/feedback/');

    rmSync(path.join(dir, '.engagement-harness'), { recursive: true });
    await runInit({ cwd: dir, yes: true, log: noopLog });
    const body2 = readFileSync(path.join(dir, '.gitignore'), 'utf8');
    const occurrences = (body2.match(/\.engagement-harness\/reports\//g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('refuses to overwrite an existing install', async () => {
    await runInit({ cwd: dir, yes: true, log: noopLog });
    await expect(runInit({ cwd: dir, yes: true, log: noopLog })).rejects.toBeInstanceOf(CliError);
  });

  it('throws CliError when interactive without prompter', async () => {
    await expect(runInit({ cwd: dir, yes: false, log: noopLog })).rejects.toBeInstanceOf(CliError);
  });
});

describe('runInit GitHub workflow setup', () => {
  function initGitRepo(repoDir: string, remoteUrl: string): void {
    execSync('git init -q', { cwd: repoDir });
    execSync('git config user.email "test@example.com"', { cwd: repoDir });
    execSync('git config user.name "Test"', { cwd: repoDir });
    execSync('git config commit.gpgsign false', { cwd: repoDir });
    execSync(`git remote add origin ${remoteUrl}`, { cwd: repoDir });
  }

  it('writes all three workflows when feedback.enabled is true (default)', async () => {
    initGitRepo(dir, 'https://github.com/test/test.git');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await runInit({ cwd: dir, yes: true, log: noopLog });
    } finally {
      consoleSpy.mockRestore();
    }
    const wf = path.join(dir, '.github', 'workflows');
    expect(existsSync(path.join(wf, 'engagement-harness.yml'))).toBe(true);
    expect(existsSync(path.join(wf, 'feedback-on-merge.yml'))).toBe(true);
    expect(existsSync(path.join(wf, 'collect-feedback.yml'))).toBe(true);
  });

  it('skips feedback workflows when feedback.enabled is false', async () => {
    initGitRepo(dir, 'https://github.com/test/test.git');
    const profile = {
      language: 'typescript' as const,
      framework: null,
      packageManager: 'pnpm' as const,
      testFramework: null,
      ciProvider: 'github' as const,
      isMonorepo: false,
      importantPaths: ['src'],
      suggestedIgnoredPaths: ['**/node_modules/**'],
    };
    const answers = defaultAnswersFromProfile(dir, profile);
    const config = buildConfigFromAnswers(answers);
    config.feedback.enabled = false;

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await setupCiWorkflow(dir, { yes: true, config });
    } finally {
      consoleSpy.mockRestore();
    }
    const wf = path.join(dir, '.github', 'workflows');
    expect(existsSync(path.join(wf, 'engagement-harness.yml'))).toBe(true);
    expect(existsSync(path.join(wf, 'feedback-on-merge.yml'))).toBe(false);
    expect(existsSync(path.join(wf, 'collect-feedback.yml'))).toBe(false);
  });
});

describe('initCommand', () => {
  it('runs through with --yes', async () => {
    await initCommand({ cwd: dir, yes: true });
    expect(ConfigLoader.exists(dir)).toBe(true);
  });
});
