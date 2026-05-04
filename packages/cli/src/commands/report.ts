import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { ConfigLoader } from '@engagement-harness/core';
import chalk from 'chalk';

function getOutputDir(repoRoot: string): string {
  if (!ConfigLoader.exists(repoRoot)) return path.join(repoRoot, '.engagement-harness/reports');
  const config = ConfigLoader.load(repoRoot);
  return path.join(repoRoot, config.reports.outputDir);
}

function listRunDirs(outputDir: string): string[] {
  if (!existsSync(outputDir)) return [];
  return readdirSync(outputDir)
    .filter((d) => d.startsWith('run-'))
    .sort()
    .reverse();
}

function readMarkdown(runDir: string): string | null {
  const p = path.join(runDir, 'report.md');
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8');
}

function getDecisionFromJson(runDir: string): string {
  const p = path.join(runDir, 'report.json');
  if (!existsSync(p)) return '—';
  try {
    const data = JSON.parse(readFileSync(p, 'utf8')) as { result?: { decision?: string } };
    return data.result?.decision ?? '—';
  } catch {
    return '—';
  }
}

function getTimestampFromJson(runDir: string): string {
  const p = path.join(runDir, 'report.json');
  if (!existsSync(p)) return '—';
  try {
    const data = JSON.parse(readFileSync(p, 'utf8')) as {
      runMetadata?: { timestamp?: string };
    };
    return data.runMetadata?.timestamp ?? '—';
  } catch {
    return '—';
  }
}

export function reportLatestCommand(): void {
  const repoRoot = process.cwd();
  const outputDir = getOutputDir(repoRoot);
  const runs = listRunDirs(outputDir);
  if (runs.length === 0) {
    console.error(chalk.yellow('No reports found. Run `engagement-harness review --ci` first.'));
    return;
  }
  const latestDir = path.join(outputDir, runs[0]!);
  const md = readMarkdown(latestDir);
  if (!md) {
    console.error(chalk.red(`report.md not found in ${latestDir}`));
    return;
  }
  process.stdout.write(md);
}

export function reportRunCommand(runId: string): void {
  const repoRoot = process.cwd();
  const outputDir = getOutputDir(repoRoot);
  const runDir = path.join(outputDir, `run-${runId}`);
  if (!existsSync(runDir)) {
    console.error(chalk.red(`Run "${runId}" not found in ${outputDir}`));
    return;
  }
  const md = readMarkdown(runDir);
  if (!md) {
    console.error(chalk.red(`report.md not found in ${runDir}`));
    return;
  }
  process.stdout.write(md);
}

export function reportListCommand(): void {
  const repoRoot = process.cwd();
  const outputDir = getOutputDir(repoRoot);
  const runs = listRunDirs(outputDir);
  if (runs.length === 0) {
    console.log('No reports found.');
    return;
  }
  console.log(chalk.bold(`Reports in ${outputDir}:`));
  console.log('');
  for (const runDir of runs) {
    const id = runDir.replace(/^run-/, '');
    const fullDir = path.join(outputDir, runDir);
    const ts = getTimestampFromJson(fullDir);
    const decision = getDecisionFromJson(fullDir);
    const decisionColor =
      decision === 'approved'
        ? chalk.green
        : decision === 'blocked_by_policy'
          ? chalk.red
          : chalk.yellow;
    console.log(`  ${chalk.cyan(id)}  ${ts}  ${decisionColor(decision)}`);
  }
}
