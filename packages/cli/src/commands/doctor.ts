import { execSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
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
  fix?: boolean;
}

interface CheckResult {
  status: 'pass' | 'fail' | 'warn' | 'info';
  label: string;
  detail?: string;
}

export interface DoctorReport {
  checks: CheckResult[];
  ok: boolean;
}

function formatCheck(c: CheckResult): string {
  const icon =
    c.status === 'pass'
      ? chalk.green('✓')
      : c.status === 'fail'
        ? chalk.red('✗')
        : c.status === 'warn'
          ? chalk.yellow('⚠')
          : chalk.dim('ℹ');
  const detail = c.detail ? chalk.dim(`\n    ${c.detail}`) : '';
  return `${icon} ${c.label}${detail}`;
}

function checkGitAvailable(): CheckResult {
  try {
    const out = execSync('git --version', { stdio: ['ignore', 'pipe', 'pipe'] })
      .toString()
      .trim();
    return { status: 'pass', label: 'git is available', detail: out };
  } catch {
    return {
      status: 'fail',
      label: 'git is not available',
      detail: 'Install git and ensure it is on PATH',
    };
  }
}

function checkGitRepo(cwd: string): CheckResult {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 'pass', label: 'Git repository' };
  } catch {
    return {
      status: 'warn',
      label: 'Not inside a git repository',
      detail: 'Run `git init` to initialize, or run from inside a git repo',
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
    return { status: 'pass', label: 'Config file valid', config };
  } catch (err) {
    if (err instanceof ConfigInvalidError) {
      return {
        status: 'fail',
        label: 'Config present but invalid',
        detail: err.issues.map((i) => `${i.path || '(root)'}: ${i.message}`).join('; '),
      };
    }
    if (err instanceof ConfigNotFoundError) {
      return { status: 'fail', label: 'Config file not found', detail: err.message };
    }
    return { status: 'fail', label: 'Config not readable', detail: (err as Error).message };
  }
}

function checkWorkflowsPresent(cwd: string): CheckResult {
  const wfDir = path.join(cwd, '.github', 'workflows');
  const required = ['engagement-harness.yml', 'feedback-on-merge.yml', 'collect-feedback.yml'];
  const present = required.filter((f) => existsSync(path.join(wfDir, f)));

  if (present.length === required.length) {
    return { status: 'pass', label: '3 workflow files present' };
  }
  if (present.length === 0) {
    return {
      status: 'warn',
      label: 'No CI workflow files found',
      detail: 'Run `engagement-harness init` or `engagement-harness ci templates --platform github --write`',
    };
  }
  const missing = required.filter((f) => !present.includes(f));
  return {
    status: 'warn',
    label: `${present.length} of ${required.length} workflow files present`,
    detail: `Missing: ${missing.join(', ')}`,
  };
}

function checkAiAgentConfigured(config: Config): CheckResult {
  const realProviders = new Set(['anthropic', 'openai']);
  const securityProvider = config.models['security'];
  const testingProvider = config.models['testing'];

  if (realProviders.has(securityProvider ?? '') || realProviders.has(testingProvider ?? '')) {
    const who = realProviders.has(securityProvider ?? '') ? 'security' : 'testing';
    const prov = config.models[who];
    return { status: 'pass', label: `${who} agent → ${prov}` };
  }

  const allMock = config.agents.enabled.every(
    (id) => !realProviders.has(config.models[id] ?? ''),
  );
  if (allMock) {
    return {
      status: 'warn',
      label: 'No AI agents configured — all reviews use mock',
      detail: 'Run `engagement-harness doctor --fix` to enable real AI for security and testing',
    };
  }
  return {
    status: 'warn',
    label: 'Neither security nor testing agent uses real AI',
    detail: 'Run `engagement-harness doctor --fix` to update',
  };
}

function checkPostComments(config: Config): CheckResult {
  if (config.ci.postComments) {
    return { status: 'pass', label: 'Inline comments enabled' };
  }
  return {
    status: 'warn',
    label: 'ci.postComments is false',
    detail: 'Findings will not appear as PR comments. Run `engagement-harness doctor --fix` to enable.',
  };
}

function checkApiKey(config: Config, cwd: string): CheckResult {
  const needsAnthropicKey =
    config.providers.anthropic !== undefined ||
    Object.values(config.models).includes('anthropic');
  const needsOpenaiKey =
    config.providers.openai !== undefined || Object.values(config.models).includes('openai');

  if (!needsAnthropicKey && !needsOpenaiKey) {
    return { status: 'info', label: 'No real AI provider configured (all mock)' };
  }

  const anthropicKeySet = Boolean(process.env['ANTHROPIC_API_KEY']);
  const openaiKeySet = Boolean(process.env['OPENAI_API_KEY']);

  if (needsAnthropicKey && !anthropicKeySet) {
    let secretsUrl = 'Settings → Secrets → Actions';
    try {
      const remote = execSync('git remote get-url origin', { cwd, stdio: 'pipe' }).toString().trim();
      const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
      if (match) secretsUrl = `https://github.com/${match[1]}/settings/secrets/actions`;
    } catch {
      // ignore
    }
    return {
      status: 'warn',
      label: 'ANTHROPIC_API_KEY not set',
      detail: `CI reviews will fail at runtime → ${secretsUrl}`,
    };
  }

  if (needsOpenaiKey && !openaiKeySet) {
    return {
      status: 'warn',
      label: 'OPENAI_API_KEY not set',
      detail: 'Set in your environment or GitHub Secrets',
    };
  }

  if (needsAnthropicKey && anthropicKeySet) {
    return { status: 'pass', label: 'ANTHROPIC_API_KEY detected' };
  }
  return { status: 'pass', label: 'OPENAI_API_KEY detected' };
}

function checkFeedbackEnabled(config: Config): CheckResult {
  if (config.feedback.enabled) {
    return { status: 'pass', label: 'Feedback collection enabled' };
  }
  return {
    status: 'warn',
    label: 'Feedback collection disabled',
    detail: 'Set feedback.enabled to true in config.json to track accuracy over time',
  };
}

function checkRulesDir(cwd: string): CheckResult {
  const rulesDir = path.join(cwd, '.engagement-harness', 'rules');
  if (existsSync(rulesDir)) {
    return { status: 'pass', label: 'Rules directory present' };
  }
  return {
    status: 'warn',
    label: '.engagement-harness/rules/ not found',
    detail: 'Run `engagement-harness init` to scaffold',
  };
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

function summarizeMockAgents(config: Config): CheckResult | null {
  const realProviders = new Set(['anthropic', 'openai']);
  const mockAgents = config.agents.enabled.filter(
    (id) => !realProviders.has(config.models[id] ?? ''),
  );
  if (mockAgents.length === 0) return null;
  return {
    status: 'info',
    label: `${mockAgents.length} agent${mockAgents.length > 1 ? 's' : ''} using mock (no findings)`,
    detail: mockAgents.join(', '),
  };
}

function applyFixes(cwd: string, config: Config, log: (s: string) => void): void {
  let changed = false;

  const ensureAgent = (id: string): void => {
    if (!config.agents.enabled.includes(id)) {
      config.agents.enabled.push(id);
      changed = true;
    }
  };

  if (!config.models['security'] || config.models['security'] === 'mock') {
    config.models['security'] = 'anthropic';
    ensureAgent('security');
    changed = true;
    log(chalk.green('✓') + ' Fixed: models.security set to "anthropic"');
  }

  if (!config.models['testing'] || config.models['testing'] === 'mock') {
    config.models['testing'] = 'anthropic';
    ensureAgent('testing');
    changed = true;
    log(chalk.green('✓') + ' Fixed: models.testing set to "anthropic"');
  }

  if (!config.ci.postComments) {
    config.ci.postComments = true;
    changed = true;
    log(chalk.green('✓') + ' Fixed: ci.postComments set to true');
  }

  if (!config.providers.anthropic) {
    config.providers.anthropic = { model: 'claude-sonnet-4-20250514' };
    changed = true;
    log(chalk.green('✓') + ' Fixed: providers.anthropic added with claude-sonnet-4-20250514');
  }

  if (changed) {
    ConfigLoader.save(cwd, config);
    log(chalk.green('✓') + ' Config saved');
  } else {
    log(chalk.dim('  Nothing to fix — config is already optimal'));
  }

  log('');
  log(
    chalk.yellow('⚠') +
      ' API key must be set manually in environment or GitHub Secrets — cannot auto-fix',
  );
}

export function runDoctor(input: {
  cwd: string;
  log?: (msg: string) => void;
  fix?: boolean;
}): DoctorReport {
  const log = input.log ?? ((msg: string) => console.log(msg));
  const cwd = input.cwd;

  log(chalk.bold('◆ Engagement Harness — Health Check'));
  log('Checking configuration...');
  log('');

  const checks: CheckResult[] = [];

  checks.push(checkGitAvailable());
  checks.push(checkGitRepo(cwd));

  const configCheck = checkConfigPresent(cwd);
  checks.push({ status: configCheck.status, label: configCheck.label, detail: configCheck.detail });

  if (configCheck.config) {
    const config = configCheck.config;
    checks.push(checkWorkflowsPresent(cwd));
    checks.push(checkAiAgentConfigured(config));
    checks.push(checkPostComments(config));
    checks.push(checkApiKey(config, cwd));
    checks.push(checkFeedbackEnabled(config));
    checks.push(checkRulesDir(cwd));
    checks.push(checkReportsWritable(cwd, config));

    const mockSummary = summarizeMockAgents(config);
    if (mockSummary) checks.push(mockSummary);

    if (input.fix) {
      log('');
      log(chalk.bold('Applying fixes...'));
      log('');
      applyFixes(cwd, config, log);
    }
  }

  for (const c of checks) {
    log(formatCheck(c));
  }

  const warnings = checks.filter((c) => c.status === 'warn');
  const failures = checks.filter((c) => c.status === 'fail');
  const ok = failures.length === 0;

  log('');
  log(chalk.dim('─'.repeat(45)));

  if (failures.length > 0 || warnings.length > 0) {
    if (failures.length > 0) {
      log(chalk.red(`✗ ${failures.length} check${failures.length > 1 ? 's' : ''} failed`));
      for (const c of failures) {
        log(chalk.red(`  ✗ ${c.label}`) + (c.detail ? chalk.dim(` — ${c.detail}`) : ''));
      }
    }
    if (warnings.length > 0) {
      log(chalk.yellow(`⚠ ${warnings.length} warning${warnings.length > 1 ? 's' : ''} found`));
      for (const c of warnings) {
        log(chalk.yellow(`  ⚠ ${c.label}`) + (c.detail ? '' : ''));
        if (c.detail) log(chalk.dim(`    ${c.detail}`));
      }
    }
    if (!input.fix && warnings.length > 0) {
      log('');
      log(chalk.dim('  Run: engagement-harness doctor --fix'));
    }
  } else {
    log(chalk.green('All checks passed.'));
  }

  return { checks, ok };
}

export function doctorCommand(options: DoctorOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const report = runDoctor({ cwd, fix: options.fix });
  if (!report.ok) {
    throw new CliError('doctor: one or more checks failed', 1);
  }
}
