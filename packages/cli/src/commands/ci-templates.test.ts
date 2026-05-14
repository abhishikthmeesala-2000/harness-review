import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ciTemplatesCommand } from './ci-templates.js';

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

    it('also writes feedback-collection.yml alongside engagement-harness.yml', () => {
      ciTemplatesCommand({ platform: 'github' });
      const content = readFileSync(
        path.join(dir, '.github', 'workflows', 'feedback-collection.yml'),
        'utf8',
      );
      expect(content).toContain('name: Collect Feedback from Reactions');
      expect(content).toContain('feedback collect');
      expect(content).toContain('cron:');
      // checkout must carry token so git push is authorised
      expect(content).toContain('token:');
      // git add must not fail on first run when feedback dir absent
      expect(content).toContain('2>/dev/null || true');
      // push must be explicit about remote + ref
      expect(content).toContain('git push origin HEAD');
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
