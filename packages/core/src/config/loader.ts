import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { ConfigSchema, type Config } from '../schemas/config.js';

export const CONFIG_DIR = '.engagement-harness';
export const CONFIG_FILENAME = 'config.json';

export class ConfigNotFoundError extends Error {
  override readonly name = 'ConfigNotFoundError';
  constructor(public readonly configPath: string) {
    super(`Engagement Harness config not found at ${configPath}`);
  }
}

export interface ZodIssueSummary {
  path: string;
  message: string;
}

export class ConfigInvalidError extends Error {
  override readonly name = 'ConfigInvalidError';
  readonly issues: ZodIssueSummary[];
  constructor(public readonly configPath: string, issues: ZodIssueSummary[]) {
    super(
      `Engagement Harness config at ${configPath} is invalid:\n${issues
        .map((i) => `  - ${i.path || '(root)'}: ${i.message}`)
        .join('\n')}`,
    );
    this.issues = issues;
  }
}

function resolvePath(repoRoot: string): string {
  return path.join(repoRoot, CONFIG_DIR, CONFIG_FILENAME);
}

function summarizeZodIssues(err: ZodError): ZodIssueSummary[] {
  return err.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

export const ConfigLoader = {
  resolvePath,

  exists(repoRoot: string): boolean {
    return existsSync(resolvePath(repoRoot));
  },

  load(repoRoot: string): Config {
    const configPath = resolvePath(repoRoot);
    if (!existsSync(configPath)) {
      throw new ConfigNotFoundError(configPath);
    }
    let raw: string;
    try {
      raw = readFileSync(configPath, 'utf8');
    } catch (err) {
      throw new ConfigInvalidError(configPath, [
        { path: '', message: `failed to read file: ${(err as Error).message}` },
      ]);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ConfigInvalidError(configPath, [
        { path: '', message: `invalid JSON: ${(err as Error).message}` },
      ]);
    }
    const result = ConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new ConfigInvalidError(configPath, summarizeZodIssues(result.error));
    }
    return result.data;
  },

  save(repoRoot: string, config: Config): void {
    const validated = ConfigSchema.parse(config);
    const configPath = resolvePath(repoRoot);
    const dir = path.dirname(configPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  },
};
