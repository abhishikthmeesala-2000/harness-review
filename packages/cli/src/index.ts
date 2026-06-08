import { Command } from 'commander';
import { agentsListCommand } from './commands/agents-list.js';
import { ciTemplatesCommand, type CiTemplatesOptions } from './commands/ci-templates.js';
import { configValidateCommand } from './commands/config-validate.js';
import { doctorCommand, type DoctorOptions } from './commands/doctor.js';
import { evalCommand } from './commands/eval.js';
import {
  feedbackCollectCommand,
  type FeedbackCollectOptions,
} from './commands/feedback-collect.js';
import { feedbackImportCommand } from './commands/feedback-import.js';
import {
  feedbackPilotReportCommand,
  type FeedbackPilotReportOptions,
} from './commands/feedback-pilot-report.js';
import { feedbackReportCommand, type FeedbackReportOptions } from './commands/feedback-report.js';
import { initCommand, type InitOptions } from './commands/init.js';
import { uninitCommand, type UninitOptions } from './commands/uninit.js';
import { modelsListCommand } from './commands/models-list.js';
import { modelsValidateCommand } from './commands/models-validate.js';
import {
  remediateListCommand,
  remediateApplyCommand,
  remediateAutoFixCommand,
  type ApplyOptions,
  type AutoFixOptions,
} from './commands/remediate.js';
import { reportLatestCommand, reportListCommand, reportRunCommand } from './commands/report.js';
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
    .command('uninit')
    .description(
      'Remove Engagement Harness config, scaffold, and workflows from the current repository',
    )
    .option('-y, --yes', 'non-interactive mode — skip all prompts')
    .action(async (options: UninitOptions) => {
      await uninitCommand(options);
    });

  program
    .command('doctor')
    .description('Validate installation, config, and environment')
    .option('--fix', 'auto-fix common configuration issues')
    .action((options: DoctorOptions) => {
      doctorCommand(options);
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
    .option(
      '--write',
      'Write the template file to disk (default for github; use --no-write to print instead)',
    )
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
    .option('--repo <owner/repo>', 'GitHub repository (owner/repo) — auto-detected from git remote if omitted')
    .option('--pr <number>', 'specific PR number to scan', (v: string) => Number(v))
    .option('--days <number>', 'days to look back (default: 7)', (v: string) => Number(v))
    .option('--since <date>', 'ISO date or "Xdays" shorthand — alias for --days')
    .option('--memory-dir <path>', 'write Claude memory file to this directory after collecting')
    .action(async (options: FeedbackCollectOptions) => {
      await feedbackCollectCommand(options);
    });
  feedback
    .command('report')
    .description('Print a feedback metrics report')
    .option('--format <format>', 'output format: text|json', 'text')
    .action(async (options: FeedbackReportOptions) => {
      await feedbackReportCommand(options);
    });
  feedback
    .command('pilot-report')
    .description('Print a pilot program summary report')
    .option('--days <number>', 'days to include (default: 14)', (v: string) => Number(v))
    .action(async (options: FeedbackPilotReportOptions) => {
      await feedbackPilotReportCommand(options);
    });

  const remediate = program
    .command('remediate')
    .description('Apply AI-generated code patches to findings');

  remediate
    .command('list')
    .description('Show findings and available patches')
    .action(async () => {
      await remediateListCommand();
    });

  remediate
    .command('apply <findingId>')
    .description('Apply patch for a specific finding')
    .option('--yes', 'skip confirmation prompt')
    .action(async (findingId: string, options: ApplyOptions) => {
      await remediateApplyCommand(findingId, options);
    });

  remediate
    .command('auto-fix')
    .description('Apply all patches at or below a risk level and commit')
    .option('--risk <level>', 'risk ceiling: low | medium | high', 'low')
    .option('--yes', 'skip confirmation prompt')
    .action(async (options: AutoFixOptions) => {
      await remediateAutoFixCommand(options);
    });

  return program;
}

export async function run(argv: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}
