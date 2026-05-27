import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliError } from '../utils/errors.js';
import { runInit } from './init.js';
import { configValidateCommand } from './config-validate.js';

let dir: string;
const noopLog = (): void => {};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'eh-cv-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('configValidateCommand', () => {
  it('passes on a freshly initialized repo', async () => {
    await runInit({ cwd: dir, yes: true, log: noopLog });
    expect(() => configValidateCommand({ cwd: dir })).not.toThrow();
  });

  it('throws when config is missing', () => {
    expect(() => configValidateCommand({ cwd: dir })).toThrow(CliError);
  });

  it('throws when config is malformed JSON', () => {
    const p = path.join(dir, '.engagement-harness', 'config.json');
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, '{ not json', 'utf8');
    expect(() => configValidateCommand({ cwd: dir })).toThrow(CliError);
  });

  it('throws when schema is invalid', () => {
    const p = path.join(dir, '.engagement-harness', 'config.json');
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(
      p,
      JSON.stringify({
        client: { name: '', engagement: 'P' },
      }),
      'utf8',
    );
    expect(() => configValidateCommand({ cwd: dir })).toThrow(CliError);
  });
});
