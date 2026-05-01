import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliError } from '../utils/errors.js';
import { runInit } from './init.js';
import { doctorCommand, runDoctor } from './doctor.js';

let dir: string;
const noopLog = (): void => {};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'eh-doc-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('runDoctor', () => {
  it('reports ok on a freshly initialized repo', async () => {
    await runInit({ cwd: dir, yes: true, log: noopLog });
    const report = runDoctor({ cwd: dir, log: noopLog });
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.label.includes('config'))?.status).toBe('pass');
    expect(report.checks.find((c) => c.label.includes('agent'))?.status).toBe('pass');
  });

  it('reports failure when config is missing', () => {
    const report = runDoctor({ cwd: dir, log: noopLog });
    expect(report.ok).toBe(false);
    expect(report.checks.some((c) => c.status === 'fail' && c.label.includes('config'))).toBe(
      true,
    );
  });

  it('reports failure when config is invalid', () => {
    const configPath = path.join(dir, '.engagement-harness', 'config.json');
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, '{ "client": { "name": "" } }', 'utf8');
    const report = runDoctor({ cwd: dir, log: noopLog });
    expect(report.ok).toBe(false);
    expect(report.checks.some((c) => c.label.includes('invalid'))).toBe(true);
  });
});

describe('doctorCommand', () => {
  it('exits 0 (does not throw) on a healthy repo', async () => {
    await runInit({ cwd: dir, yes: true, log: noopLog });
    expect(() => doctorCommand({ cwd: dir })).not.toThrow();
  });

  it('throws CliError(1) on a broken repo', () => {
    expect(() => doctorCommand({ cwd: dir })).toThrow(CliError);
  });
});
