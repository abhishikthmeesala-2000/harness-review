import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ConfigLoader,
  DEFAULT_AGENT_IDS,
  RepoProfiler,
  defaultConfig,
  type AlmPlatform,
  type Config,
  type RepoProfile,
  type SeverityLevel,
} from '@engagement-harness/core';
import chalk from 'chalk';
import { generateGithubWorkflow, writeFeedbackWorkflows } from './ci-templates.js';
import { checkIfGitRepo, detectGitPlatform, getCurrentBranch, getRemoteUrl } from '../utils/git.js';
import { CliError } from '../utils/errors.js';

export interface InitOptions {
  yes?: boolean;
  cwd?: string;
}

export interface InitAnswers {
  clientName: string;
  engagement: string;
  almPlatform: AlmPlatform;
  enabledAgents: string[];
  confidenceThreshold: number;
  severityThreshold: SeverityLevel;
  ignoredPaths: string[];
  blockOnPolicy: boolean;
  postComments: boolean;
}

const SCAFFOLD_README = {
  rules: `# Rules

This folder holds client-specific rules that the DomainPolicyAgent consults during review.
Each rule is a Markdown file with a YAML frontmatter \`pathGlob\` field describing which
changed files trigger it. Rules are matched against the diff and surfaced in the agent
context bundle so reviewers can flag policy violations grounded in your engagement's
domain knowledge.
`,
  evals: `# Evals

This folder holds eval cases that measure review quality on representative diffs.
Each case names a fixture, a base/head ref, expected findings, and an expected policy
decision. The eval runner replays cases through the full pipeline with a deterministic
mock provider, and produces precision/recall metrics so you can track review quality
over time.
`,
  examples: `# Examples

This folder holds reference materials for the engagement: example diffs, sample reports,
or annotated finding outputs. Treat it as documentation that tells consultants what
"good" looks like in this client's codebase. Files here are read-only context and do
not affect runtime behavior.
`,
};

function deriveAlmPlatform(profile: RepoProfile): AlmPlatform {
  switch (profile.ciProvider) {
    case 'github':
      return 'github';
    case 'gitlab':
      return 'gitlab';
    case 'azure-devops':
      return 'azure-devops';
    case 'bitbucket':
      return 'bitbucket';
    default:
      return 'none';
  }
}

export function buildConfigFromAnswers(answers: InitAnswers): Config {
  const base = defaultConfig({ name: answers.clientName, engagement: answers.engagement });
  return {
    ...base,
    review: {
      ...base.review,
      confidenceThreshold: answers.confidenceThreshold,
      severityThreshold: answers.severityThreshold,
    },
    agents: { enabled: answers.enabledAgents },
    models: Object.fromEntries(answers.enabledAgents.map((id) => [id, 'anthropic'])),
    providers: {
      mock: {},
      anthropic: { model: 'claude-haiku-4-5-20251001' },
    },
    context: { ...base.context, ignoredPaths: answers.ignoredPaths },
    ci: { ...base.ci, blockOnPolicy: answers.blockOnPolicy, postComments: answers.postComments },
    alm: { platform: answers.almPlatform },
  };
}

export function defaultAnswersFromProfile(cwd: string, profile: RepoProfile): InitAnswers {
  return {
    clientName: path.basename(path.resolve(cwd)),
    engagement: 'pilot',
    almPlatform: deriveAlmPlatform(profile),
    enabledAgents: [...DEFAULT_AGENT_IDS],
    confidenceThreshold: 0.8,
    severityThreshold: 'low',
    ignoredPaths: profile.suggestedIgnoredPaths,
    blockOnPolicy: false,
    postComments: true,
  };
}

interface ScaffoldOptions {
  cwd: string;
  config: Config;
}

function scaffoldDirectoryTree({ cwd, config }: ScaffoldOptions): string[] {
  const root = path.join(cwd, '.engagement-harness');
  const written: string[] = [];

  mkdirSync(root, { recursive: true });

  const subdirs: Array<{ name: string; readme?: string; gitkeep?: boolean }> = [
    { name: 'rules', readme: SCAFFOLD_README.rules },
    { name: 'evals', readme: SCAFFOLD_README.evals },
    { name: 'examples', readme: SCAFFOLD_README.examples },
    { name: 'reports', gitkeep: true },
    { name: 'feedback', gitkeep: true },
  ];
  for (const sub of subdirs) {
    const dir = path.join(root, sub.name);
    mkdirSync(dir, { recursive: true });
    if (sub.readme) {
      const file = path.join(dir, 'README.md');
      writeFileSync(file, sub.readme, 'utf8');
      written.push(file);
    }
    if (sub.gitkeep) {
      const file = path.join(dir, '.gitkeep');
      writeFileSync(file, '', 'utf8');
      written.push(file);
    }
  }

  ConfigLoader.save(cwd, config);
  written.push(ConfigLoader.resolvePath(cwd));

  return written;
}

const GITIGNORE_ENTRIES = [
  '.engagement-harness/reports/',
  '.engagement-harness/findings/',
  '.engagement-harness/feedback/feedback-*.json',
  '!.engagement-harness/feedback/metrics.json',
];

function ensureGitignoreEntries(cwd: string): void {
  const file = path.join(cwd, '.gitignore');
  let body = '';
  if (existsSync(file)) {
    body = readFileSync(file, 'utf8');
  }
  const lines = body.split('\n').map((l) => l.trim());
  let next = body;
  let changed = false;
  for (const entry of GITIGNORE_ENTRIES) {
    if (!lines.includes(entry)) {
      if (next.length > 0 && !next.endsWith('\n')) next += '\n';
      next += `${entry}\n`;
      changed = true;
    }
  }
  if (changed) {
    writeFileSync(file, next, 'utf8');
  }
}

interface RunInitInput {
  cwd: string;
  yes: boolean;
  promptAnswers?: (defaults: InitAnswers, profile: RepoProfile) => Promise<InitAnswers>;
  log?: (msg: string) => void;
}

export async function runInit(input: RunInitInput): Promise<{ configPath: string }> {
  const { cwd, yes, log = (msg: string) => console.log(msg) } = input;

  if (ConfigLoader.exists(cwd)) {
    throw new CliError(
      `Engagement Harness is already initialized at ${ConfigLoader.resolvePath(cwd)}. Edit it directly or remove it before re-running init.`,
      1,
    );
  }

  const profile = RepoProfiler.detect(cwd);
  const defaults = defaultAnswersFromProfile(cwd, profile);
  let answers: InitAnswers = defaults;
  if (!yes) {
    if (!input.promptAnswers) {
      throw new CliError(
        'Interactive init requires a TTY. Run with --yes for non-interactive mode.',
        1,
      );
    }
    answers = await input.promptAnswers(defaults, profile);
  }

  const config = buildConfigFromAnswers(answers);
  scaffoldDirectoryTree({ cwd, config });
  ensureGitignoreEntries(cwd);

  log(chalk.green('✓') + ` Initialized Engagement Harness for ${chalk.bold(answers.clientName)}`);
  log(
    `  Config: ${path.relative(cwd, ConfigLoader.resolvePath(cwd)) || '.engagement-harness/config.json'}`,
  );
  log(
    `  Detected: language=${profile.language ?? 'unknown'}, ci=${profile.ciProvider ?? 'none'}` +
      (profile.framework ? `, framework=${profile.framework}` : '') +
      (profile.testFramework ? `, tests=${profile.testFramework}` : '') +
      (profile.isMonorepo ? ', monorepo=yes' : ''),
  );
  log(`  Agents enabled: ${answers.enabledAgents.length} (${answers.enabledAgents.join(', ')})`);
  log('');
  log(`Next: run ${chalk.cyan('engagement-harness doctor')} to verify the install.`);

  await setupCiWorkflow(cwd, { yes, config });

  return { configPath: ConfigLoader.resolvePath(cwd) };
}

export async function setupCiWorkflow(
  cwd: string,
  options: { yes: boolean; config: Config },
): Promise<void> {
  try {
    const isGit = await checkIfGitRepo(cwd);
    if (!isGit) return;

    const platform = await detectGitPlatform(cwd);

    if (platform !== null && platform !== 'github') {
      console.log(
        chalk.dim(
          `  (CI setup not yet supported for ${platform} — run: engagement-harness ci templates --platform ${platform} --write)`,
        ),
      );
      return;
    }

    const { confirm } = await import('@inquirer/prompts');

    const setupConfirmed = options.yes
      ? true
      : await confirm({
          message: 'Set up GitHub Actions to run automatically on PRs?',
          default: true,
        });
    if (!setupConfirmed) return;

    const workflowDir = path.join(cwd, '.github', 'workflows');
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(
      path.join(workflowDir, 'engagement-harness.yml'),
      generateGithubWorkflow(cwd),
      'utf8',
    );
    console.log(chalk.green('✓') + ' Created .github/workflows/engagement-harness.yml');

    if (options.config.feedback.enabled) {
      writeFeedbackWorkflows(workflowDir);
      console.log(chalk.green('✓') + ' Created feedback collection workflows');
    } else {
      console.log(chalk.dim('  (feedback.enabled is false — skipping feedback workflows)'));
    }

    const commitConfirmed = options.yes
      ? true
      : await confirm({ message: 'Commit the workflow file to Git?', default: true });

    if (commitConfirmed) {
      execSync('git add .github/workflows/ .engagement-harness/ .gitignore', {
        cwd,
        stdio: 'pipe',
      });
      execSync('git commit -m "ci: add Engagement Harness config and workflow"', {
        cwd,
        stdio: 'pipe',
      });
      console.log(chalk.green('✓') + ' Changes committed');
    }

    const remoteUrl = await getRemoteUrl(cwd);

    if (remoteUrl && commitConfirmed) {
      const pushConfirmed = options.yes
        ? true
        : await confirm({ message: 'Push to remote repository?', default: true });

      if (pushConfirmed) {
        const branch = await getCurrentBranch(cwd);
        execSync(`git push origin -- ${branch}`, { cwd, stdio: 'pipe' });
        console.log(chalk.green('✓') + ` Pushed to origin/${branch}`);
      }
    }

    const match = remoteUrl?.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    const repoSlug = match?.[1];
    const secretsUrl = repoSlug
      ? `https://github.com/${repoSlug}/settings/secrets/actions`
      : 'your repo Settings → Secrets → Actions';

    console.log('');
    console.log(chalk.bold('📝 Next: Add your API key as a GitHub Secret'));
    console.log(`   Go to: ${chalk.cyan(secretsUrl)}`);
    console.log(`   Name:  ${chalk.yellow('ANTHROPIC_API_KEY')}`);
    console.log(`   Value: Your Anthropic API key`);
    console.log('');
    console.log(
      chalk.green.bold('🎉 Setup complete! Open a PR to see Engagement Harness in action.'),
    );
  } catch (err) {
    console.log(
      chalk.yellow('  Warning: CI setup encountered an error —') +
        ` ${err instanceof Error ? err.message : String(err)}`,
    );
    console.log(
      chalk.dim(
        '  Run `engagement-harness ci templates --platform github --write` to set up CI manually.',
      ),
    );
  }
}

async function promptAnswersInteractive(
  defaults: InitAnswers,
  profile: RepoProfile,
): Promise<InitAnswers> {
  const { input, select } = await import('@inquirer/prompts');

  // Show what was auto-detected so the user knows what we found.
  if (profile.language || profile.ciProvider) {
    console.log(
      chalk.dim(
        `  Auto-detected: language=${profile.language ?? 'unknown'}, ci=${profile.ciProvider ?? 'none'}` +
          (profile.framework ? `, framework=${profile.framework}` : ''),
      ),
    );
    console.log('');
  }

  const clientName = await input({ message: 'Client name', default: defaults.clientName });
  const engagement = await input({
    message: 'Engagement name / phase',
    default: defaults.engagement,
  });

  // Only ask about ALM platform if we could not detect it automatically.
  let almPlatform: AlmPlatform = defaults.almPlatform;
  if (defaults.almPlatform === 'none') {
    almPlatform = (await select({
      message: 'ALM platform (for PR comments)',
      default: 'none',
      choices: [
        { value: 'none', name: 'None — skip PR comments' },
        { value: 'github', name: 'GitHub' },
        { value: 'gitlab', name: 'GitLab' },
        { value: 'azure-devops', name: 'Azure DevOps' },
        { value: 'bitbucket', name: 'Bitbucket' },
      ],
    })) as AlmPlatform;
  } else {
    console.log(chalk.dim(`  ALM platform: ${defaults.almPlatform} (auto-detected)`));
  }

  // All agents are always enabled — no checkbox needed.
  // Technical settings (confidenceThreshold, severityThreshold, ignoredPaths,
  // blockOnPolicy, postComments) use safe defaults and can be tuned in config.json.
  return {
    ...defaults,
    clientName,
    engagement,
    almPlatform,
    enabledAgents: [...DEFAULT_AGENT_IDS],
  };
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const yes = options.yes === true;
  await runInit({
    cwd,
    yes,
    promptAnswers: yes ? undefined : promptAnswersInteractive,
  });
}
