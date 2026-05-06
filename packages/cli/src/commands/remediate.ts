import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { ConfigLoader, type Finding } from '@engagement-harness/core';
import { RemediationAgent } from '@engagement-harness/agents';
import { ModelRouter } from '@engagement-harness/agents';
import chalk from 'chalk';

export interface RemediateOptions {
  finding?: string;
}

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

export async function remediateCommand(options: RemediateOptions): Promise<void> {
  if (!options.finding) {
    console.error(chalk.red('--finding <id> is required'));
    process.exit(1);
  }

  const repoRoot = process.cwd();

  let config;
  try {
    config = ConfigLoader.load(repoRoot);
  } catch {
    console.error(chalk.red('No config found. Run `engagement-harness init` first.'));
    process.exit(1);
  }

  const findings = loadLatestFindings(repoRoot);
  const finding = findings.find((f) => f.id === options.finding);

  if (!finding) {
    console.error(
      chalk.red(`Finding "${options.finding}" not found in the latest report. Run a review first.`),
    );
    process.exit(1);
  }

  const agent = new RemediationAgent();
  const provider = ModelRouter.route('remediation', config);

  console.log(chalk.bold(`\nGenerating remediation plan for: ${finding.title}\n`));

  try {
    const plan = await agent.remediate(finding, { entries: [], diff: [], repoProfile: { language: 'typescript', framework: null, packageManager: 'npm', testFramework: null, ciProvider: null, isMonorepo: false, importantPaths: [], suggestedIgnoredPaths: [] } }, provider);

    console.log(`Finding: ${chalk.cyan(plan.findingId)}`);
    console.log(`Effort:  ${chalk.yellow(plan.estimatedEffort)}`);
    console.log(`\nSteps:`);
    plan.steps.forEach((step, i) => {
      console.log(`  ${i + 1}. ${step}`);
    });
    if (plan.notes) {
      console.log(`\nNotes: ${plan.notes}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Remediation failed: ${msg}`));
    process.exit(1);
  }
}
