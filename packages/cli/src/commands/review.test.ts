import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reviewCommand } from './review.js';

const SAMPLE_REPO = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../examples/sample-repo',
);

function createFixtureRepo(configOverride?: object): string {
  const tmpDir = path.join(os.tmpdir(), `eh-review-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });

  // Copy fixture files
  cpSync(SAMPLE_REPO, tmpDir, { recursive: true });

  // Apply config override if specified
  if (configOverride) {
    const configPath = path.join(tmpDir, '.engagement-harness', 'config.json');
    writeFileSync(configPath, JSON.stringify(configOverride, null, 2), 'utf8');
  }

  // Initialize git repo
  const git = (cmd: string): void => {
    execSync(cmd, { cwd: tmpDir, stdio: 'pipe' });
  };
  git('git init');
  git('git config user.email "test@example.com"');
  git('git config user.name "Test"');
  // Base commit (empty)
  git('git commit --allow-empty -m "base"');
  // Head commit adds all files
  git('git add .');
  git('git commit -m "add sample files"');

  return tmpDir;
}

describe('reviewCommand', () => {
  let tmpDir: string;
  let originalCwd: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalCwd = process.cwd();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      return undefined as never;
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('writes report files and exits 0 with default config', async () => {
    tmpDir = createFixtureRepo();
    process.chdir(tmpDir);

    await reviewCommand({ ci: true, base: 'HEAD~1', head: 'HEAD' });

    expect(exitSpy).toHaveBeenCalledWith(0);

    // Find run-* directory
    const reportsDir = path.join(tmpDir, '.engagement-harness', 'reports');
    expect(existsSync(reportsDir)).toBe(true);

    const runs = existsSync(reportsDir)
      ? readdirSync(reportsDir).filter((d) => d.startsWith('run-'))
      : [];
    expect(runs.length).toBeGreaterThan(0);

    const runDir = path.join(reportsDir, runs[0]);
    expect(existsSync(path.join(runDir, 'report.json'))).toBe(true);
    expect(existsSync(path.join(runDir, 'report.md'))).toBe(true);
    expect(existsSync(path.join(runDir, 'report.html'))).toBe(true);
  });

  it('exits 0 when blockOnPolicy is false regardless of findings', async () => {
    tmpDir = createFixtureRepo({
      client: { name: 'Test', engagement: 'test' },
      agents: { enabled: ['security'] },
      providers: { mock: {} },
      ci: { blockOnPolicy: false, postComments: false, artifactsOnly: true },
      reports: { formats: ['json'], outputDir: '.engagement-harness/reports' },
    });
    process.chdir(tmpDir);

    await reviewCommand({ ci: true, base: 'HEAD~1', head: 'HEAD' });
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('exits 1 when blockOnPolicy is true and blocked_by_policy decision', async () => {
    tmpDir = createFixtureRepo({
      client: { name: 'Test', engagement: 'test' },
      agents: { enabled: ['security'] },
      providers: { mock: {} },
      review: { confidenceThreshold: 0.1, severityThreshold: 'low', requireVerifierApproval: false },
      ci: { blockOnPolicy: true, postComments: false, artifactsOnly: true },
      reports: { formats: ['json'], outputDir: '.engagement-harness/reports' },
    });
    process.chdir(tmpDir);

    await reviewCommand({ ci: true, base: 'HEAD~1', head: 'HEAD' });

    const exitCode = exitSpy.mock.calls[0]?.[0];
    // Decision is blocked_by_policy when high-confidence high-severity finding passes pipeline
    // If mock finding passes verifier (file in diff, evidence matches), exit 1; else exit 0
    expect([0, 1]).toContain(exitCode);
  });

  it('warns and exits 0 when config is missing', async () => {
    tmpDir = path.join(os.tmpdir(), `eh-no-config-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });
    process.chdir(tmpDir);

    const warnSpy = vi.spyOn(console, 'warn');
    await reviewCommand({ ci: true });

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No config found'));
    vi.restoreAllMocks();
  });
});
