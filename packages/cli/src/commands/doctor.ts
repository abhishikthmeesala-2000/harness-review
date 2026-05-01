import { execSync } from 'node:child_process';
import { accessSync, constants, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  ConfigInvalidError,
  ConfigLoader,
  ConfigNotFoundError,
  type Config,
} from '@engagement-harness/core';
import chalk from 'chalk';
import { CliError } from '../utils/errors.js';

export interface DoctorOptions {
  cwd?: string;
}

interface CheckResult {
  status: 'pass' | 'fail' | 'warn';
  label: string;
  detail?: string;
}

function formatCheck(c: CheckResult): string {
  const icon =
    c.status === 'pass' ? chalk.green('✓') : c.status === 'fail' ? chalk.red('✗') : chalk.yellow('!');
  const detail = c.detail ? chalk.dim(`  ${c.detail}`) : '';
  return `${icon} ${c.label}${detail ? '\n' + detail : ''}`;
}

function checkGitAvailable(): CheckResult {
  try {
    const out = execSync('git --version', { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
    return { status: 'pass', label: 'git is available', detail: out };
  } catch {
    return {
      status: 'fail',
      label: 'git is not available',
      detail: 'Install git and ensure it is on PATH',
    };
  }
}

function checkConfigPresent(cwd: string): CheckResult & { config?: Config } {
  if (!ConfigLoader.exists(cwd)) {
    return {
      status: 'fail',
      label: 'config present',
      detail: `Run \`engagement-harness init\` (no config at ${ConfigLoader.resolvePath(cwd)})`,
    };
  }
  try {
    const config = ConfigLoader.load(cwd);
    return { status: 'pass', label: 'config present and valid', config };
  } catch (err) {
    if (err instanceof ConfigInvalidError) {
      return {
        status: 'fail',
        label: 'config present but invalid',
        detail: err.issues.map((i) => `${i.path || '(root)'}: ${i.message}`).join('; '),
      };
    }
    if (err instanceof ConfigNotFoundError) {
      return { status: 'fail', label: 'config present', detail: err.message };
    }
    return { status: 'fail', label: 'config readable', detail: (err as Error).message };
  }
}

function checkReportsWritable(cwd: string, config: Config): CheckResult {
  const dir = path.isAbsolute(config.reports.outputDir)
    ? config.reports.outputDir
    : path.join(cwd, config.reports.outputDir);
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return { status: 'pass', label: 'reports directory writable', detail: dir };
  } catch (err) {
    return {
      status: 'fail',
      label: 'reports directory not writable',
      detail: `${dir} (${(err as Error).message})`,
    };
  }
}

function summarizeAgents(config: Config): CheckResult {
  if (config.agents.enabled.length === 0) {
    return {
      status: 'warn',
      label: 'no agents enabled',
      detail: 'Add agent IDs to agents.enabled in config.json',
    };
  }
  const lines = config.agents.enabled.map((id) => `${id} → ${config.models[id] ?? 'mock'}`);
  return {
    status: 'pass',
    label: `${config.agents.enabled.length} agent(s) configured`,
    detail: lines.join('\n  '),
  };
}

export interface DoctorReport {
  checks: CheckResult[];
  ok: boolean;
}

export function runDoctor(input: { cwd: string; log?: (msg: string) => void }): DoctorReport {
  const log = input.log ?? ((msg: string) => console.log(msg));

  const checks: CheckResult[] = [];
  const gitCheck = checkGitAvailable();
  checks.push(gitCheck);

  const configCheck = checkConfigPresent(input.cwd);
  checks.push({ status: configCheck.status, label: configCheck.label, detail: configCheck.detail });

  if (configCheck.config) {
    checks.push(checkReportsWritable(input.cwd, configCheck.config));
    checks.push(summarizeAgents(configCheck.config));
  }

  for (const c of checks) {
    log(formatCheck(c));
  }

  const ok = !checks.some((c) => c.status === 'fail');
  if (ok) {
    log(chalk.green('\nAll checks passed.'));
  } else {
    log(chalk.red('\nOne or more checks failed.'));
  }

  return { checks, ok };
}

export function doctorCommand(options: DoctorOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const report = runDoctor({ cwd });
  if (!report.ok) {
    throw new CliError('doctor: one or more checks failed', 1);
  }
}
