import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigLoader } from '@engagement-harness/core';
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
    // Config check passes
    expect(
      report.checks.find(
        (c) => c.label.toLowerCase().includes('config') && c.status === 'pass',
      ),
    ).toBeDefined();
    // At least one agent check exists (security/testing with real AI)
    expect(
      report.checks.find((c) => c.label.toLowerCase().includes('agent')),
    ).toBeDefined();
  });

  it('reports failure when config is missing', () => {
    const report = runDoctor({ cwd: dir, log: noopLog });
    expect(report.ok).toBe(false);
    expect(report.checks.some((c) => c.status === 'fail' && c.label.includes('config'))).toBe(true);
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

describe('runDoctor new checks', () => {
  it('warns when all agents are using mock', async () => {
    await runInit({ cwd: dir, yes: true, log: noopLog });
    // Overwrite config with all-mock models
    const config = ConfigLoader.load(dir);
    for (const id of Object.keys(config.models)) {
      config.models[id] = 'mock';
    }
    config.providers = { mock: {} };
    ConfigLoader.save(dir, config);

    const report = runDoctor({ cwd: dir, log: noopLog });
    expect(report.ok).toBe(true); // warnings don't fail
    expect(
      report.checks.some((c) => c.status === 'warn' && c.label.toLowerCase().includes('agent')),
    ).toBe(true);
  });

  it('warns when workflows are missing', async () => {
    await runInit({ cwd: dir, yes: true, log: noopLog });
    const report = runDoctor({ cwd: dir, log: noopLog });
    // No git workflows in this temp dir — should warn
    expect(
      report.checks.some((c) => c.label.toLowerCase().includes('workflow')),
    ).toBe(true);
  });

  it('report.ok is true when only warnings exist', async () => {
    await runInit({ cwd: dir, yes: true, log: noopLog });
    const report = runDoctor({ cwd: dir, log: noopLog });
    // Warnings about missing API key / workflows exist but ok should still be true
    expect(report.ok).toBe(true);
  });
});

describe('runDoctor --fix', () => {
  it('fixes mock agents and saves config', async () => {
    await runInit({ cwd: dir, yes: true, log: noopLog });
    // Force all models to mock
    const config = ConfigLoader.load(dir);
    for (const id of Object.keys(config.models)) {
      config.models[id] = 'mock';
    }
    config.providers = { mock: {} };
    config.ci.postComments = false;
    ConfigLoader.save(dir, config);

    runDoctor({ cwd: dir, log: noopLog, fix: true });

    const fixed = ConfigLoader.load(dir);
    expect(fixed.models['security']).toBe('anthropic');
    expect(fixed.models['testing']).toBe('anthropic');
    expect(fixed.ci.postComments).toBe(true);
  });
});
