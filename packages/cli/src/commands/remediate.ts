import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  ModelRouter,
  RemediationAgent,
  loadRemediations,
  saveRemediation,
} from '@engagement-harness/agents';
import type { RemediationOutput } from '@engagement-harness/agents';
import { ConfigLoader } from '@engagement-harness/core';
import type { Finding } from '@engagement-harness/core';
import chalk from 'chalk';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function getOutputDir(repoRoot: string): string {
  if (!ConfigLoader.exists(repoRoot)) return path.join(repoRoot, '.engagement-harness/reports');
  const config = ConfigLoader.load(repoRoot);
  return path.join(repoRoot, config.reports.outputDir);
}

function loadLatestFindings(repoRoot: string): Finding[] {
  const outputDir = getOutputDir(repoRoot);
  if (!existsSync(outputDir)) return [];
  const runs = readdirSync(outputDir)
    .filter((d) => d.startsWith('run-'))
    .sort()
    .reverse();
  if (runs.length === 0) return [];
  const reportPath = path.join(outputDir, runs[0]!, 'report.json');
  if (!existsSync(reportPath)) return [];
  try {
    const data = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      result?: { published?: Finding[] };
    };
    return data.result?.published ?? [];
  } catch {
    return [];
  }
}

interface TrackedFindingEntry {
  finding: Finding;
}

function loadKnownFindings(repoRoot: string): Finding[] {
  const knownPath = path.join(
    repoRoot,
    '.engagement-harness',
    'findings',
    'known-findings.json',
  );
  if (!existsSync(knownPath)) return [];
  try {
    const raw = JSON.parse(readFileSync(knownPath, 'utf8')) as TrackedFindingEntry[];
    return Array.isArray(raw) ? raw.map((e) => e.finding) : [];
  } catch {
    return [];
  }
}

function getAllFindings(repoRoot: string): Finding[] {
  const known = loadKnownFindings(repoRoot);
  if (known.length > 0) return known;
  return loadLatestFindings(repoRoot);
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const RISK_LEVELS = ['low', 'medium', 'high'] as const;

const SEVERITY_LABEL: Record<string, (s: string) => string> = {
  critical: (s) => chalk.red(s),
  high: (s) => chalk.yellow(s),
  medium: (s) => chalk.cyan(s),
  low: (s) => chalk.blue(s),
};

function printFinding(f: Finding, rem?: RemediationOutput): void {
  const sevFn = SEVERITY_LABEL[f.severity] ?? ((s: string) => s);
  const sev = sevFn(f.severity.toUpperCase().padEnd(8));
  const remTag = rem
    ? chalk.green(` [fix: ${rem.riskLevel} risk · ${rem.effort}]`)
    : chalk.gray(' [no fix yet]');
  console.log(`  ${sev} ${chalk.cyan(f.id)}  ${f.title}${remTag}`);
  console.log(`           ${chalk.gray(f.file + ':' + f.lineStart + '–' + f.lineEnd)}`);
}

// ---------------------------------------------------------------------------
// Subcommand: list
// ---------------------------------------------------------------------------

export async function remediateListCommand(): Promise<void> {
  const repoRoot = process.cwd();
  const findings = getAllFindings(repoRoot);
  const remediations = loadRemediations(repoRoot);

  if (findings.length === 0) {
    console.log(chalk.yellow('\nNo findings found. Run `engagement-harness review` first.\n'));
    return;
  }

  const sorted = [...findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99),
  );

  const withFix = sorted.filter((f) => remediations[f.id]);
  const withoutFix = sorted.filter((f) => !remediations[f.id]);

  console.log(chalk.bold(`\nFindings (${findings.length} total · ${withFix.length} with fixes):\n`));
  for (const f of sorted) {
    printFinding(f, remediations[f.id]);
    console.log('');
  }

  if (withFix.length > 0) {
    console.log(`To apply a fix:       ${chalk.cyan('engagement-harness remediate apply <id>')}`);
  }
  if (withoutFix.length > 0) {
    console.log(
      `To generate all fixes: ${chalk.cyan('engagement-harness remediate apply <id>')} (generates on demand)`,
    );
  }
  console.log(
    `To auto-fix low-risk:  ${chalk.cyan('engagement-harness remediate auto-fix --risk low')}\n`,
  );
}

// ---------------------------------------------------------------------------
// Subcommand: apply
// ---------------------------------------------------------------------------

export interface ApplyOptions {
  yes?: boolean;
}

export async function remediateApplyCommand(
  findingId: string,
  opts: ApplyOptions,
): Promise<void> {
  const repoRoot = process.cwd();

  let config;
  try {
    config = ConfigLoader.load(repoRoot);
  } catch {
    console.error(chalk.red('No config found. Run `engagement-harness init` first.'));
    process.exit(1);
  }

  const findings = getAllFindings(repoRoot);
  const finding = findings.find((f) => f.id === findingId);

  if (!finding) {
    console.error(
      chalk.red(`Finding "${findingId}" not found. Run \`engagement-harness review\` first.`),
    );
    process.exit(1);
  }

  const remediations = loadRemediations(repoRoot);
  let output = remediations[findingId];

  // Generate on-demand if not yet stored
  if (!output) {
    console.log(chalk.bold(`\nGenerating fix for: ${finding.title}\n`));
    const agent = new RemediationAgent();
    const provider = ModelRouter.route('remediation', config);
    output = await agent.remediate(
      finding,
      {
        entries: [],
        diff: [],
        repoProfile: {
          language: 'typescript',
          framework: null,
          packageManager: 'npm',
          testFramework: null,
          ciProvider: null,
          isMonorepo: false,
          importantPaths: [],
          suggestedIgnoredPaths: [],
        },
      },
      provider,
    );
    saveRemediation(repoRoot, output);
  }

  // Verify file exists
  const absoluteFile = path.join(repoRoot, output.file);
  if (!existsSync(absoluteFile)) {
    console.error(chalk.red(`File not found on disk: ${output.file}`));
    process.exit(1);
  }

  const currentContent = readFileSync(absoluteFile, 'utf8');
  const beforeFound = currentContent.includes(output.before);

  if (!beforeFound) {
    console.warn(
      chalk.yellow(
        `\nWarning: the BEFORE code was not found verbatim in ${output.file}.\n` +
          `The file may have changed since the fix was generated. Review carefully.\n`,
      ),
    );
  }

  // Show diff
  console.log(
    chalk.bold(
      `\nFix for ${chalk.cyan(findingId)}  [${output.riskLevel} risk · ${output.effort}]\n`,
    ),
  );
  console.log(`File: ${chalk.gray(output.file + ':' + output.lineStart + '–' + output.lineEnd)}\n`);
  console.log('BEFORE:');
  for (const line of output.before.split('\n')) {
    console.log(chalk.red(`  - ${line}`));
  }
  console.log('\nAFTER:');
  for (const line of output.after.split('\n')) {
    console.log(chalk.green(`  + ${line}`));
  }
  console.log(`\nExplanation:\n  ${output.explanation}`);
  console.log(`\nTest to add:\n${chalk.gray(output.test)}`);

  // Confirm
  if (!opts.yes) {
    const { confirm } = await import('@inquirer/prompts');
    const ok = await confirm({ message: 'Apply this fix?' });
    if (!ok) {
      console.log(chalk.yellow('\nAborted.\n'));
      return;
    }
  }

  // Apply
  const newContent = currentContent.replace(output.before, output.after);
  if (newContent === currentContent) {
    console.warn(
      chalk.yellow('\nFix did not modify the file — BEFORE text was not matched. Apply manually.\n'),
    );
    return;
  }

  writeFileSync(absoluteFile, newContent, 'utf8');
  console.log(chalk.green(`\n✓ Applied fix to ${output.file}`));

  try {
    execSync(`git add "${output.file}"`, { cwd: repoRoot, stdio: 'inherit' });
    console.log(chalk.green(`✓ Staged ${output.file}`));
  } catch {
    console.warn(chalk.yellow('Could not git add — stage manually.'));
  }

  console.log(chalk.bold('\nNext: add the following test, then commit:\n'));
  console.log(chalk.gray(output.test));
  console.log('');
}

// ---------------------------------------------------------------------------
// Subcommand: auto-fix
// ---------------------------------------------------------------------------

export interface AutoFixOptions {
  risk: string;
  yes?: boolean;
}

export async function remediateAutoFixCommand(opts: AutoFixOptions): Promise<void> {
  const repoRoot = process.cwd();
  const riskCeiling = opts.risk ?? 'low';

  if (!(RISK_LEVELS as readonly string[]).includes(riskCeiling)) {
    console.error(chalk.red(`--risk must be one of: ${RISK_LEVELS.join(', ')}`));
    process.exit(1);
  }

  const remediations = loadRemediations(repoRoot);
  const eligible = Object.values(remediations).filter((r) => {
    return RISK_LEVELS.indexOf(r.riskLevel) <= RISK_LEVELS.indexOf(riskCeiling as 'low' | 'medium' | 'high');
  });

  if (eligible.length === 0) {
    console.log(
      chalk.yellow(`\nNo fixes at or below risk level "${riskCeiling}". Run \`remediate apply <id>\` to generate fixes first.\n`),
    );
    return;
  }

  console.log(
    chalk.bold(`\n${eligible.length} fix(es) eligible (risk ≤ ${riskCeiling}):\n`),
  );
  for (const r of eligible) {
    console.log(
      `  ${chalk.cyan(r.findingId)}  ${r.file}:${r.lineStart}–${r.lineEnd}  [${r.riskLevel} · ${r.effort}]`,
    );
  }
  console.log('');

  if (!opts.yes) {
    const { confirm } = await import('@inquirer/prompts');
    const ok = await confirm({
      message: `Apply all ${eligible.length} fix(es) and create a commit?`,
    });
    if (!ok) {
      console.log(chalk.yellow('Aborted.\n'));
      return;
    }
  }

  const applied: string[] = [];

  for (const output of eligible) {
    const absoluteFile = path.join(repoRoot, output.file);
    if (!existsSync(absoluteFile)) {
      console.warn(chalk.yellow(`  Skipping ${output.findingId}: ${output.file} not found on disk.`));
      continue;
    }

    const current = readFileSync(absoluteFile, 'utf8');
    const patched = current.replace(output.before, output.after);
    if (patched === current) {
      console.warn(
        chalk.yellow(`  Skipping ${output.findingId}: BEFORE text not matched in ${output.file}.`),
      );
      continue;
    }

    writeFileSync(absoluteFile, patched, 'utf8');
    try {
      execSync(`git add "${output.file}"`, { cwd: repoRoot });
    } catch {
      // ignore staging errors; commit will fail and we surface that instead
    }
    applied.push(output.findingId);
    console.log(chalk.green(`  ✓ Applied ${output.findingId}`));
  }

  if (applied.length === 0) {
    console.log(chalk.yellow('\nNo fixes were applied.\n'));
    return;
  }

  const commitMsg = [
    `fix: apply ${applied.length} engagement-harness remediation(s)`,
    '',
    'Fixed:',
    ...applied.map((id) => `- ${id}`),
    '',
    `Applied by: engagement-harness remediate auto-fix --risk ${riskCeiling}`,
  ].join('\n');

  try {
    execSync(`git commit -m ${JSON.stringify(commitMsg)}`, { cwd: repoRoot, stdio: 'inherit' });
    console.log(chalk.green(`\n✓ Committed ${applied.length} fix(es).\n`));
  } catch {
    console.warn(
      chalk.yellow('\nCommit failed — verify staged changes and commit manually.\n'),
    );
  }
}
