import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ConfigLoader } from '@engagement-harness/core';
import chalk from 'chalk';
import { CliError } from '../utils/errors.js';
import { checkIfGitRepo, getCurrentBranch, getRemoteUrl } from '../utils/git.js';

export interface UninitOptions {
  yes?: boolean;
  cwd?: string;
}

const GITIGNORE_ENTRIES = [
  '.engagement-harness/reports/',
  '.engagement-harness/findings/',
  '.engagement-harness/feedback/feedback-*.json',
  '!.engagement-harness/feedback/metrics.json',
];

const WORKFLOW_FILES = [
  '.github/workflows/engagement-harness.yml',
  '.github/workflows/feedback-on-merge.yml',
  '.github/workflows/collect-feedback.yml',
];

export function removeGitignoreEntries(cwd: string): boolean {
  const file = path.join(cwd, '.gitignore');
  if (!existsSync(file)) return false;
  const lines = readFileSync(file, 'utf8').split('\n');
  const filtered = lines.filter((l) => !GITIGNORE_ENTRIES.includes(l.trim()));
  while (filtered.length > 0 && filtered.at(-1)?.trim() === '') {
    filtered.pop();
  }
  const next = filtered.length > 0 ? filtered.join('\n') + '\n' : '';
  if (next === lines.join('\n')) return false;
  writeFileSync(file, next, 'utf8');
  return true;
}

export async function runUninit(input: {
  cwd: string;
  yes: boolean;
  log?: (msg: string) => void;
}): Promise<void> {
  const { cwd, yes, log = (msg: string) => console.log(msg) } = input;

  if (!ConfigLoader.exists(cwd)) {
    throw new CliError(
      `Engagement Harness is not initialized here (no config at ${ConfigLoader.resolvePath(cwd)}).`,
      1,
    );
  }

  if (!yes) {
    const { confirm } = await import('@inquirer/prompts');
    const confirmed = await confirm({
      message:
        'This will remove all Engagement Harness config, scaffold, and workflow files. Continue?',
      default: false,
    });
    if (!confirmed) {
      log('Aborted.');
      return;
    }
  }

  const ehDir = path.join(cwd, '.engagement-harness');
  if (existsSync(ehDir)) {
    rmSync(ehDir, { recursive: true, force: true });
    log(chalk.green('✓') + ' Removed .engagement-harness/');
  }

  for (const wf of WORKFLOW_FILES) {
    const wfPath = path.join(cwd, wf);
    if (existsSync(wfPath)) {
      rmSync(wfPath);
      log(chalk.green('✓') + ` Removed ${wf}`);
    }
  }

  const gitignoreChanged = removeGitignoreEntries(cwd);
  if (gitignoreChanged) {
    log(chalk.green('✓') + ' Removed Engagement Harness entries from .gitignore');
  }

  try {
    const isGit = await checkIfGitRepo(cwd);
    if (!isGit) return;

    const commitConfirmed = yes
      ? true
      : await (async () => {
          const { confirm } = await import('@inquirer/prompts');
          return confirm({ message: 'Commit the removal?', default: true });
        })();

    if (!commitConfirmed) return;

    const gitTargets = ['.engagement-harness', ...WORKFLOW_FILES, '.gitignore'].join(' ');
    execSync(`git add ${gitTargets}`, { cwd, stdio: 'pipe' });

    try {
      execSync('git commit -m "ci: remove Engagement Harness config and workflows"', {
        cwd,
        stdio: 'pipe',
      });
      log(chalk.green('✓') + ' Changes committed');
    } catch {
      log(chalk.dim('  (nothing to commit — files were not tracked)'));
      return;
    }

    const remoteUrl = await getRemoteUrl(cwd);
    if (!remoteUrl) return;

    const pushConfirmed = yes
      ? true
      : await (async () => {
          const { confirm } = await import('@inquirer/prompts');
          return confirm({ message: 'Push to remote repository?', default: true });
        })();

    if (pushConfirmed) {
      const branch = await getCurrentBranch(cwd);
      execSync(`git push origin -- ${branch}`, { cwd, stdio: 'pipe' });
      log(chalk.green('✓') + ` Pushed to origin/${branch}`);
    }
  } catch (err) {
    log(
      chalk.yellow('  Warning: git operation encountered an error —') +
        ` ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  log('');
  log(chalk.bold('Engagement Harness removed. Run `engagement-harness init` to start fresh.'));
}

export async function uninitCommand(options: UninitOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const yes = options.yes === true;
  await runUninit({ cwd, yes });
}
