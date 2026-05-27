import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ciTemplatesCommand, generateGithubWorkflow, isSourceRepo } from './ci-templates.js';

describe('ciTemplatesCommand', () => {
  let dir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'eh-ci-'));
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.chdir(dir);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('github platform', () => {
    it('writes to .github/workflows/engagement-harness.yml by default (no --write flag needed)', () => {
      ciTemplatesCommand({ platform: 'github' });
      const content = readFileSync(
        path.join(dir, '.github', 'workflows', 'engagement-harness.yml'),
        'utf8',
      );
      expect(content).toContain('name: Engagement Harness Review');
      expect(content).toContain('actions/checkout@v4');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('.github/workflows/engagement-harness.yml'),
      );
    });

    it('writes when --write is explicitly true', () => {
      ciTemplatesCommand({ platform: 'github', write: true });
      const content = readFileSync(
        path.join(dir, '.github', 'workflows', 'engagement-harness.yml'),
        'utf8',
      );
      expect(content).toContain('name: Engagement Harness Review');
    });

    it('also writes feedback-on-merge.yml and collect-feedback.yml alongside engagement-harness.yml', () => {
      ciTemplatesCommand({ platform: 'github' });

      const onMerge = readFileSync(
        path.join(dir, '.github', 'workflows', 'feedback-on-merge.yml'),
        'utf8',
      );
      expect(onMerge).toContain('name: Collect Feedback on Merge');
      expect(onMerge).toContain('pull_request.merged == true');
      expect(onMerge).toContain('--pr');
      expect(onMerge).toContain('token:');
      expect(onMerge).toContain('2>/dev/null || true');
      expect(onMerge).toContain('git push origin HEAD:main');

      const weekly = readFileSync(
        path.join(dir, '.github', 'workflows', 'collect-feedback.yml'),
        'utf8',
      );
      expect(weekly).toContain('name: Weekly Feedback Sweep');
      expect(weekly).toContain('--days 7');
      expect(weekly).toContain('cron:');
      expect(weekly).toContain('token:');
      expect(weekly).toContain('2>/dev/null || true');
      expect(weekly).toContain('git push origin HEAD:main');
    });

    it('prints to stdout when write is explicitly false (programmatic override)', () => {
      ciTemplatesCommand({ platform: 'github', write: false });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('name: Engagement Harness Review'),
      );
    });
  });

  describe('other platforms', () => {
    it('prints gitlab template to stdout by default', () => {
      ciTemplatesCommand({ platform: 'gitlab' });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('engagement-harness-review:'),
      );
    });

    it('writes gitlab template to disk when --write is passed', () => {
      ciTemplatesCommand({ platform: 'gitlab', write: true });
      const content = readFileSync(path.join(dir, '.gitlab-ci.yml'), 'utf8');
      expect(content).toContain('engagement-harness-review:');
    });

    it('prints azure-devops template to stdout by default', () => {
      ciTemplatesCommand({ platform: 'azure-devops' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('azure-pipelines.yml'));
    });

    it('writes azure-devops template to disk when --write is passed', () => {
      ciTemplatesCommand({ platform: 'azure-devops', write: true });
      const content = readFileSync(path.join(dir, 'azure-pipelines.yml'), 'utf8');
      expect(content).toContain('engagement-harness review --ci');
    });

    it('prints bitbucket template to stdout by default', () => {
      ciTemplatesCommand({ platform: 'bitbucket' });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('bitbucket-pipelines.yml'),
      );
    });
  });

  describe('no platform', () => {
    it('prints all 4 templates when no platform specified', () => {
      ciTemplatesCommand({});
      const allCalls = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allCalls).toContain('GITHUB');
      expect(allCalls).toContain('GITLAB');
      expect(allCalls).toContain('AZURE-DEVOPS');
      expect(allCalls).toContain('BITBUCKET');
    });
  });

  describe('unknown platform', () => {
    it('exits with error for unknown platform', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(() => ciTemplatesCommand({ platform: 'unknown-ci' })).toThrow('process.exit called');
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown platform'));
      exitSpy.mockRestore();
      errSpy.mockRestore();
    });
  });
});

describe('isSourceRepo', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'eh-src-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns true when packages/cli/package.json exists', () => {
    const cliDir = path.join(dir, 'packages', 'cli');
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(path.join(cliDir, 'package.json'), '{}', 'utf8');
    expect(isSourceRepo(dir)).toBe(true);
  });

  it('returns false in a regular client repo', () => {
    expect(isSourceRepo(dir)).toBe(false);
  });
});

describe('generateGithubWorkflow', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'eh-wf-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns client template when not in source repo', () => {
    const result = generateGithubWorkflow(dir);
    expect(result).toContain('harness-review');
    expect(result).toContain('Install CLI');
  });

  it('returns source template when in source repo', () => {
    const cliDir = path.join(dir, 'packages', 'cli');
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(path.join(cliDir, 'package.json'), '{}', 'utf8');
    const result = generateGithubWorkflow(dir);
    expect(result).toContain('packages/cli');
    expect(result).not.toContain('harness-review.git');
  });

  it('client template contains required env vars', () => {
    const result = generateGithubWorkflow(dir);
    expect(result).toContain('ANTHROPIC_API_KEY');
    expect(result).toContain('GITHUB_TOKEN');
    expect(result).toContain('actions/checkout@v4');
  });
});
