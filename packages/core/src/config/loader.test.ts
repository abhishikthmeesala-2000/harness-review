import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultConfig } from '../schemas/config.js';
import {
  ConfigInvalidError,
  ConfigLoader,
  ConfigNotFoundError,
} from './loader.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'eh-loader-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('ConfigLoader', () => {
  it('reports exists() correctly', () => {
    expect(ConfigLoader.exists(dir)).toBe(false);
    ConfigLoader.save(dir, defaultConfig({ name: 'A', engagement: 'P' }));
    expect(ConfigLoader.exists(dir)).toBe(true);
  });

  it('round-trips a config', () => {
    const original = defaultConfig({ name: 'Acme', engagement: 'Pilot' });
    ConfigLoader.save(dir, original);
    const loaded = ConfigLoader.load(dir);
    expect(loaded).toEqual(original);
  });

  it('writes pretty JSON with trailing newline', () => {
    ConfigLoader.save(dir, defaultConfig({ name: 'A', engagement: 'P' }));
    const raw = readFileSync(ConfigLoader.resolvePath(dir), 'utf8');
    expect(raw).toMatch(/\n$/);
    expect(raw).toContain('\n  "client"');
  });

  it('throws ConfigNotFoundError when missing', () => {
    expect(() => ConfigLoader.load(dir)).toThrow(ConfigNotFoundError);
    try {
      ConfigLoader.load(dir);
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigNotFoundError);
      expect((err as ConfigNotFoundError).configPath).toBe(
        path.join(dir, '.engagement-harness', 'config.json'),
      );
    }
  });

  it('throws ConfigInvalidError on malformed JSON with file path', () => {
    const configPath = path.join(dir, '.engagement-harness', 'config.json');
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, '{ not valid json', 'utf8');
    try {
      ConfigLoader.load(dir);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigInvalidError);
      expect((err as ConfigInvalidError).configPath).toBe(configPath);
      expect((err as ConfigInvalidError).issues[0]?.message).toContain('invalid JSON');
    }
  });

  it('throws ConfigInvalidError on schema violation with issue paths', () => {
    const configPath = path.join(dir, '.engagement-harness', 'config.json');
    mkdirSync(path.dirname(configPath), { recursive: true });
    const bad = {
      client: { name: '', engagement: 'P' },
      review: { confidenceThreshold: 2 },
    };
    writeFileSync(configPath, JSON.stringify(bad), 'utf8');
    try {
      ConfigLoader.load(dir);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigInvalidError);
      const e = err as ConfigInvalidError;
      const paths = e.issues.map((i) => i.path);
      expect(paths).toContain('client.name');
      expect(paths).toContain('review.confidenceThreshold');
    }
  });
});
