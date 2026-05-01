import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigLoader } from '@engagement-harness/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliError } from '../utils/errors.js';
import {
  buildConfigFromAnswers,
  defaultAnswersFromProfile,
  initCommand,
  runInit,
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
      expect(config.models[id]).toBe('mock');
    }
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

describe('initCommand', () => {
  it('runs through with --yes', async () => {
    await initCommand({ cwd: dir, yes: true });
    expect(ConfigLoader.exists(dir)).toBe(true);
  });
});
