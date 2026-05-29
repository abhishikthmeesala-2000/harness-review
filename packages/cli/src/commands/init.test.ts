import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigLoader, DEFAULT_AGENT_IDS } from '@engagement-harness/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError } from '../utils/errors.js';
import {
  buildConfigFromAnswers,
  defaultAnswersFromProfile,
  generateConfigMd,
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
    // Enabled agents get the provider; others get 'mock'
    for (const id of config.agents.enabled) {
      expect(config.models[id]).toBe('anthropic');
    }
    // Agents not in enabledAgents should be 'mock'
    for (const id of DEFAULT_AGENT_IDS) {
      if (!config.agents.enabled.includes(id)) {
        expect(config.models[id]).toBe('mock');
      }
    }
    // Provider config reflects chosen model
    expect(config.providers.anthropic?.model).toBe('claude-sonnet-4-20250514');
    expect(config.providers.anthropic?.maxTokens).toBe(4096);
  });

  it('builds config with openai provider', () => {
    const profile = {
      language: 'typescript' as const,
      framework: null,
      packageManager: 'pnpm' as const,
      testFramework: null,
      ciProvider: 'github' as const,
      isMonorepo: false,
      importantPaths: ['src'],
      suggestedIgnoredPaths: [],
    };
    const answers = {
      ...defaultAnswersFromProfile('/tmp/my-repo', profile),
      provider: 'openai' as const,
      model: 'gpt-4-turbo',
      enabledAgents: ['security', 'testing'],
    };
    const config = buildConfigFromAnswers(answers);
    expect(config.providers.openai?.model).toBe('gpt-4-turbo');
    expect(config.providers.anthropic).toBeUndefined();
    expect(config.models['security']).toBe('openai');
    expect(config.models['reviewer']).toBe('mock');
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

describe('runInit --yes smart defaults', () => {
  it('sets security and testing to anthropic by default', async () => {
    await runInit({ cwd: dir, yes: true, log: noopLog });
    const config = ConfigLoader.load(dir);
    expect(config.models['security']).toBe('anthropic');
    expect(config.models['testing']).toBe('anthropic');
  });

  it('sets postComments to true by default', async () => {
    await runInit({ cwd: dir, yes: true, log: noopLog });
    const config = ConfigLoader.load(dir);
    expect(config.ci.postComments).toBe(true);
  });

  it('writes CONFIG.md alongside config.json', async () => {
    await runInit({ cwd: dir, yes: true, log: noopLog });
    const configMdPath = path.join(dir, '.engagement-harness', 'CONFIG.md');
    expect(existsSync(configMdPath)).toBe(true);
    const content = readFileSync(configMdPath, 'utf8');
    expect(content).toContain('Engagement Harness Configuration Reference');
    expect(content).toContain('security');
    expect(content).toContain('ci.postComments');
  });
});

describe('generateConfigMd', () => {
  it('contains the client name', () => {
    const profile = {
      language: 'typescript' as const,
      framework: null,
      packageManager: 'pnpm' as const,
      testFramework: null,
      ciProvider: 'github' as const,
      isMonorepo: false,
      importantPaths: ['src'],
      suggestedIgnoredPaths: [],
    };
    const answers = defaultAnswersFromProfile('/tmp/acme-corp', profile);
    const config = buildConfigFromAnswers(answers);
    const md = generateConfigMd(config);
    expect(md).toContain('acme-corp');
    expect(md).toContain('security');
    expect(md).toContain('ci.postComments');
    expect(md).toContain('anthropic');
  });

  it('marks enabled agents and mock agents correctly', () => {
    const profile = {
      language: 'typescript' as const,
      framework: null,
      packageManager: 'pnpm' as const,
      testFramework: null,
      ciProvider: 'none' as const,
      isMonorepo: false,
      importantPaths: [],
      suggestedIgnoredPaths: [],
    };
    const answers = {
      ...defaultAnswersFromProfile('/tmp/test', profile),
      enabledAgents: ['security'],
      provider: 'anthropic' as const,
      model: 'claude-sonnet-4-20250514',
    };
    const config = buildConfigFromAnswers(answers);
    const md = generateConfigMd(config);
    // security is enabled
    expect(md).toMatch(/security.*✓/);
    // reviewer is disabled (mock)
    expect(md).toMatch(/reviewer.*—/);
  });
});
