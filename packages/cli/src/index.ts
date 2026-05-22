import { Command } from 'commander';
import { agentsListCommand } from './commands/agents-list.js';
import { ciTemplatesCommand, type CiTemplatesOptions } from './commands/ci-templates.js';
import { configValidateCommand } from './commands/config-validate.js';
import { doctorCommand } from './commands/doctor.js';
import { evalCommand } from './commands/eval.js';
import { feedbackCollectCommand, type FeedbackCollectOptions } from './commands/feedback-collect.js';
import { feedbackImportCommand } from './commands/feedback-import.js';
import { initCommand, type InitOptions } from './commands/init.js';
import { modelsListCommand } from './commands/models-list.js';
import { modelsValidateCommand } from './commands/models-validate.js';
import { remediateCommand, type RemediateOptions } from './commands/remediate.js';
import {
  reportLatestCommand,
  reportListCommand,
  reportRunCommand,
} from './commands/report.js';
import { reviewCommand, type ReviewOptions } from './commands/review.js';

const VERSION = '0.1.0';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('engagement-harness')
    .description('CI-native, multi-agent pull request review platform')
    .version(VERSION, '-v, --version', 'output the current version');

  program
    .command('init')
    .description('Initialize Engagement Harness in the current repository')
    .option('-y, --yes', 'non-interactive mode using detected defaults')
    .action(async (options: InitOptions) => {
      await initCommand(options);
    });

  program
    .command('doctor')
    .description('Validate installation, config, and environment')
    .action(() => {
      doctorCommand();
    });

  program
    .command('review')
    .description('Run a pull request review')
    .option('--ci', 'run in CI (headless) mode')
    .option('--base <ref>', 'base git ref for diff (overrides auto-detect)')
    .option('--head <ref>', 'head git ref for diff (overrides auto-detect)')
    .action(async (options: ReviewOptions) => {
      await reviewCommand(options);
    });

  const report = program.command('report').description('Report inspection utilities');
  report
    .command('latest')
    .description('Print the most recent report to stdout')
    .action(() => {
      reportLatestCommand();
    });
  report
    .command('run <id>')
    .description('Print a specific run report to stdout')
    .action((id: string) => {
      reportRunCommand(id);
    });
  report
    .command('list')
    .description('List all run IDs with timestamps and decisions')
    .action(() => {
      reportListCommand();
    });

  const config = program.command('config').description('Configuration utilities');
  config
    .command('validate')
    .description('Validate the current configuration')
    .action(() => {
      configValidateCommand();
    });

  const agents = program.command('agents').description('Agent inspection utilities');
  agents
    .command('list')
    .description('List registered agents')
    .action(() => {
      agentsListCommand();
    });

  const models = program.command('models').description('Model and provider utilities');
  models
    .command('list')
    .description('List registered providers and routing')
    .action(() => {
      modelsListCommand();
    });
  models
    .command('validate')
    .description('Validate provider routing for each agent')
    .action(() => {
      modelsValidateCommand();
    });

  const ci = program.command('ci').description('CI integration utilities');
  ci.command('templates')
    .description('Generate CI workflow templates')
    .option('--platform <name>', 'CI platform: github | gitlab | azure-devops | bitbucket')
    .option('--write', 'Write the template file to disk (default for github; use --no-write to print instead)')
    .option('--no-print', 'Do not print to stdout')
    .option('--context <mode>', 'Template context: client | source | auto (default: auto)')
    .action((options: CiTemplatesOptions) => {
      ciTemplatesCommand(options);
    });

  program
    .command('eval')
    .description('Run the eval suite against fixture cases')
    .action(async () => {
      await evalCommand();
    });

  const feedback = program.command('feedback').description('Feedback ingestion utilities');
  feedback
    .command('import <file>')
    .description('Import a feedback JSON file')
    .action(async (file: string) => {
      await feedbackImportCommand(file);
    });
  feedback
    .command('collect')
    .description('Collect feedback from GitHub PR reaction emojis')
    .requiredOption('--repo <owner/repo>', 'GitHub repository (owner/repo)')
    .option('--pr <number>', 'specific PR number to scan', (v: string) => Number(v))
    .option('--since <date>', 'ISO date or "Xdays" shorthand (default: 7 days ago)')
    .option('--memory-dir <path>', 'write Claude memory file to this directory after collecting')
    .action(async (options: FeedbackCollectOptions) => {
      await feedbackCollectCommand(options);
    });

  program
    .command('remediate')
    .description('Generate a remediation plan for a finding')
    .option('--finding <id>', 'finding id (e.g. EH-0001)')
    .action(async (options: RemediateOptions) => {
      await remediateCommand(options);
    });

  return program;
}

export async function run(argv: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}
