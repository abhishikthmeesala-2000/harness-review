import path from 'node:path';

import { ConfigLoader } from '@engagement-harness/core';
import { EvalRunner } from '@engagement-harness/eval';
import chalk from 'chalk';

export async function evalCommand(): Promise<void> {
  const repoRoot = process.cwd();

  let config;
  try {
    config = ConfigLoader.load(repoRoot);
  } catch {
    console.error(
      chalk.red('No config found. Run `engagement-harness init` first, or run from your repo root.'),
    );
    process.exit(1);
  }

  const casesDir = path.join(repoRoot, 'examples', 'eval-cases');
  console.log(chalk.bold(`Running eval suite from ${casesDir}\n`));

  const report = await EvalRunner.runAll(casesDir, config);

  for (const result of report.results) {
    const icon = result.passed ? chalk.green('✓') : chalk.red('✗');
    console.log(`  ${icon} ${result.caseId} (decision: ${result.decision})`);
    for (const err of result.errors) {
      console.log(`      ${chalk.red(err)}`);
    }
  }

  console.log('');
  console.log(
    `${report.passed}/${report.totalCases} cases passed` +
      (report.failed > 0 ? chalk.red(` — ${report.failed} failed`) : chalk.green(' — all pass')),
  );

  if (report.failed > 0) process.exit(1);
}
