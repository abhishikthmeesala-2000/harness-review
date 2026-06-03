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
import {
  estimateCostPerPR,
  estimateMonthly,
  formatCost,
} from '../pricing.js';

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
  provider: 'anthropic' | 'openai' | 'mock';
  model: string;
  setupCi: boolean;
  commitAndPush: boolean;
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

const AGENT_DESCRIPTIONS: Record<string, string> = {
  security: 'Secret scanning, hardcoded creds, injection risks',
  testing: 'Test coverage gaps and test quality',
  reviewer: 'General code quality and best practices',
  'domain-policy': 'Engagement-specific rules from rules/',
  'data-architecture': 'Schema changes, migrations, data model concerns',
  'sre-observability': 'Logging, metrics, error handling, alerting',
  'design-principles': 'SOLID, DRY, architecture patterns',
  'pr-intent-gap': 'Intent vs implementation drift detection',
  remediation: 'Auto-generates fix suggestions',
};

const ANTHROPIC_MODELS = [
  { value: 'claude-sonnet-4-20250514', name: 'claude-sonnet-4-20250514   Recommended · Best value' },
  { value: 'claude-opus-4-6', name: 'claude-opus-4-6                Most capable · Highest cost' },
  { value: 'claude-haiku-4-5-20251001', name: 'claude-haiku-4-5-20251001  Fastest · Lowest cost' },
];

const OPENAI_MODELS = [
  { value: 'gpt-4-turbo', name: 'gpt-4-turbo    Recommended · Best balance' },
  { value: 'gpt-4o', name: 'gpt-4o         Faster · Good quality' },
  { value: 'gpt-3.5-turbo', name: 'gpt-3.5-turbo  Cheapest · Less accurate' },
];

interface ProjectContext {
  projectName: string;
  projectType: string;
  repoUrl: string | null;
  weeklyPRs: number;
  stackSummary: string[];
}

function detectProjectContext(cwd: string): ProjectContext {
  let projectName = path.basename(path.resolve(cwd));
  let projectType = 'Unknown';
  let repoUrl: string | null = null;
  let weeklyPRs = 10;
  const stackSummary: string[] = [];

  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
      if (typeof pkg.name === 'string' && pkg.name) projectName = pkg.name;
      projectType = 'Node.js';
      const deps = {
        ...(typeof pkg.dependencies === 'object' && pkg.dependencies ? pkg.dependencies : {}),
        ...(typeof pkg.devDependencies === 'object' && pkg.devDependencies
          ? pkg.devDependencies
          : {}),
      } as Record<string, unknown>;
      const known: Record<string, string> = {
        react: 'React',
        next: 'Next.js',
        nextjs: 'Next.js',
        express: 'Express',
        fastify: 'Fastify',
        pg: 'PostgreSQL',
        postgres: 'PostgreSQL',
        prisma: 'Prisma',
        mongoose: 'MongoDB',
        vue: 'Vue',
        nuxt: 'Nuxt',
        angular: '@angular/core',
      };
      for (const [dep, label] of Object.entries(known)) {
        if (dep in deps && !stackSummary.includes(label)) stackSummary.push(label);
      }
    } else if (existsSync(path.join(cwd, 'requirements.txt')) || existsSync(path.join(cwd, 'pyproject.toml'))) {
      projectType = 'Python';
    } else if (existsSync(path.join(cwd, 'go.mod'))) {
      projectType = 'Go';
    } else if (existsSync(path.join(cwd, 'Gemfile'))) {
      projectType = 'Ruby';
    }
  } catch {
    // ignore
  }

  try {
    repoUrl = execSync('git remote get-url origin', { cwd, stdio: 'pipe' })
      .toString()
      .trim()
      .replace(/\.git$/, '')
      .replace(/^git@github\.com:/, 'https://github.com/');
  } catch {
    // ignore
  }

  try {
    const logLines = execSync('git log --oneline --since="30 days ago"', { cwd, stdio: 'pipe' })
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean);
    if (logLines.length > 0) {
      weeklyPRs = Math.max(1, Math.round(logLines.length / 4.3));
    }
  } catch {
    // ignore
  }

  return { projectName, projectType, repoUrl, weeklyPRs, stackSummary };
}

const STEPS = ['Provider', 'Agents', 'Review', 'CI', 'Done'];

function printProgress(current: number, log: (s: string) => void): void {
  const parts = STEPS.map((s, i) => {
    if (i < current) return chalk.green(`✓ ${s}`);
    if (i === current) return chalk.cyan(`● ${s}`);
    return chalk.dim(`○ ${s}`);
  });
  log('  ' + parts.join('  '));
  log('');
}

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

  const models: Record<string, string> = {};
  for (const id of DEFAULT_AGENT_IDS) {
    models[id] = answers.enabledAgents.includes(id) ? answers.provider : 'mock';
  }

  return {
    ...base,
    review: {
      ...base.review,
      confidenceThreshold: answers.confidenceThreshold,
      severityThreshold: answers.severityThreshold,
    },
    agents: { enabled: answers.enabledAgents },
    models,
    providers: {
      mock: {},
      ...(answers.provider === 'anthropic'
        ? { anthropic: { model: answers.model, maxTokens: 4096, temperature: 0.0 } }
        : {}),
      ...(answers.provider === 'openai'
        ? { openai: { model: answers.model, maxTokens: 4096, temperature: 0.0 } }
        : {}),
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
    enabledAgents: ['security', 'testing', 'reviewer', 'pr-intent-gap'],
    confidenceThreshold: 0.8,
    severityThreshold: 'low',
    ignoredPaths: profile.suggestedIgnoredPaths,
    blockOnPolicy: false,
    postComments: true,
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    setupCi: true,
    commitAndPush: true,
  };
}

export function generateConfigMd(config: Config): string {
  const enabledSet = new Set(config.agents.enabled);
  const agentRows = [...DEFAULT_AGENT_IDS]
    .map((id) => {
      const provider = config.models[id] ?? 'mock';
      const enabled = enabledSet.has(id) ? '✓' : '—';
      const desc = AGENT_DESCRIPTIONS[id] ?? '';
      return `| ${id} | ${desc} | ${enabled} | \`${provider}\` |`;
    })
    .join('\n');

  const modelTable = `
| Value | Description | Cost/PR (est.) |
|-------|-------------|----------------|
| \`anthropic\` | Claude (recommended) | ~$0.005 |
| \`openai\` | GPT-4 | ~$0.010 |
| \`mock\` | No findings (testing only) | Free |
`.trim();

  return `# Engagement Harness Configuration Reference

Generated for **${config.client.name}** / ${config.client.engagement}.
Edit \`config.json\` — this file is documentation only.

---

## agents.enabled

Which agents run on every PR. Remove agents you don't need to reduce cost and noise.

| Agent | What it checks | Enabled | Provider |
|-------|---------------|---------|----------|
${agentRows}

---

## models

Maps each agent to an AI provider.

${modelTable}

---

## review.confidenceThreshold

**Range:** 0.0 to 1.0  ·  **Default:** 0.8

Findings below this threshold are filtered out before reporting.

- Raise to 0.9 if seeing too many false positives
- Lower to 0.6 if missing real issues
- Check with: \`engagement-harness feedback pilot-report\`

---

## review.severityThreshold

**Default:** low  ·  **Valid values:** low · medium · high · critical

Only report findings at or above this severity. Start with \`low\` and raise after tuning.

---

## ci.postComments

**Default:** true

Posts each finding as an inline PR comment.
Requires \`pull-requests: write\` permission in workflows.
Enables reaction-based feedback collection (👍 👎 🚀 😕).

---

## ci.blockOnPolicy

**Default:** false

Fails the GitHub check if any findings exist.
**Recommendation:** Enable after 2 weeks of tuning when false positive rate is below 10%.

---

## ci.artifactsOnly

**Default:** true

Uploads the full report as a GitHub Actions artifact.
Set to \`false\` if you only want inline comments and no artifact upload.

---

## providers.anthropic / providers.openai

Configures the AI provider used by agents mapped to that provider.

\`\`\`json
{
  "model": "claude-sonnet-4-20250514",
  "maxTokens": 4096,
  "temperature": 0.0
}
\`\`\`

**Anthropic models:**
| Model | Quality | Cost |
|-------|---------|------|
| claude-opus-4-6 | Most capable | Highest |
| claude-sonnet-4-20250514 | Recommended | Best value |
| claude-haiku-4-5-20251001 | Fastest | Lowest |

**OpenAI models:**
| Model | Quality | Cost |
|-------|---------|------|
| gpt-4-turbo | Recommended | Best balance |
| gpt-4o | Faster | Good quality |
| gpt-3.5-turbo | Cheapest | Less accurate |

---

## pipeline (review.confidenceThreshold)

Confidence filtering is controlled via \`review.confidenceThreshold\` (see above).

---

## feedback.enabled

**Default:** true

Enables feedback collection workflows. When true, the \`feedback-on-merge.yml\` workflow
collects 👍/👎 reactions from PR comments to measure review accuracy over time.

---

## feedback.autoCollect

**Default:** false

Automatically runs the weekly feedback sweep. Set to \`true\` once your team has been
using the tool for 2+ weeks.

---

## feedback.retentionDays

**Default:** 90

How many days to keep raw feedback data before pruning.

---

## context.maxFiles

**Default:** 30

Maximum number of changed files to include in the review context.
Raise if large PRs are being partially reviewed.

---

## context.maxTokens

**Default:** 80000

Maximum tokens sent to each agent per review run.
Lower if hitting provider rate limits.

---

## context.ignoredPaths

Glob patterns for files to exclude from review context.
Example: \`["**/node_modules/**", "**/*.lock", "dist/**"]\`

---

## alm.platform

**Valid values:** github · gitlab · azure-devops · bitbucket · none

Determines which ALM API to use for posting inline PR comments.

---

## reports.formats

**Default:** json · markdown · html

Which report formats to generate after each review run.

---

## reports.outputDir

**Default:** .engagement-harness/reports

Where to write report files. This path is gitignored by default.
`;
}

interface ScaffoldOptions {
  cwd: string;
  config: Config;
  log: (msg: string) => void;
}

function scaffoldDirectoryTree({ cwd, config, log }: ScaffoldOptions): string[] {
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
  log(chalk.green('✓') + ' Generated configuration');

  const configMdPath = path.join(root, 'CONFIG.md');
  writeFileSync(configMdPath, generateConfigMd(config), 'utf8');
  written.push(configMdPath);
  log(chalk.green('✓') + ' Created rules directory and CONFIG.md');

  return written;
}

const GITIGNORE_ENTRIES = [
  '.engagement-harness/reports/',
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

function printCompletionScreen(
  provider: string,
  repoUrl: string | null,
  filesCreated: string[],
  weeklyPRs: number,
  enabledAgents: string[],
  model: string,
  log: (s: string) => void,
): void {
  log('');
  log(chalk.green('┌─────────────────────────────────────────────────┐'));
  log(chalk.green('│') + chalk.bold('  ✓  Engagement Harness is ready!               ') + chalk.green('│'));
  log(chalk.green('└─────────────────────────────────────────────────┘'));
  log('');

  const keyName = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  const keyIsSet =
    provider === 'openai'
      ? Boolean(process.env['OPENAI_API_KEY'])
      : Boolean(process.env['ANTHROPIC_API_KEY']);

  if (keyIsSet) {
    log(chalk.green('  ✓ API key detected'));
  } else {
    log('  One step before your first review:');
    log('');
    log(chalk.yellow('┌─────────────────────────────────────────────────┐'));
    log(chalk.yellow('│') + '  Add your API key to GitHub Secrets             ' + chalk.yellow('│'));
    log(chalk.yellow('│') + '                                                 ' + chalk.yellow('│'));
    if (repoUrl) {
      const secretsUrl = `  → ${repoUrl}/settings/secrets/actions`;
      const padded = secretsUrl.padEnd(49);
      log(chalk.yellow('│') + padded + chalk.yellow('│'));
    }
    log(chalk.yellow('│') + '                                                 ' + chalk.yellow('│'));
    log(chalk.yellow('│') + `  Name:   ${chalk.bold(keyName)}`.padEnd(49 + 9) + chalk.yellow('│'));
    if (provider === 'openai') {
      log(chalk.yellow('│') + '  Value:  platform.openai.com → API Keys         ' + chalk.yellow('│'));
    } else {
      log(chalk.yellow('│') + '  Value:  console.anthropic.com → API Keys       ' + chalk.yellow('│'));
    }
    log(chalk.yellow('└─────────────────────────────────────────────────┘'));
  }

  log('');
  log('  Then open a pull request.');
  log('  Your first review appears within 3 minutes.');
  log('');

  const aiAgents = enabledAgents.filter((a) => a !== 'mock');
  if (provider !== 'mock') {
    const costPerPR = estimateCostPerPR(provider, model, aiAgents.length);
    const monthly = estimateMonthly(costPerPR, weeklyPRs);
    log(chalk.dim(`  Provider:  ${provider === 'anthropic' ? 'Anthropic Claude' : 'OpenAI'}`));
    log(chalk.dim(`  Model:     ${model}`));
    log(chalk.dim(`  Agents:    ${aiAgents.length} with real AI (${aiAgents.join(', ')})`));
    log('');
    log(chalk.dim(`  Cost estimate (~${weeklyPRs * 4} PRs/month):`));
    log(chalk.dim(`    Per PR:    ~${formatCost(costPerPR)}`));
    log(chalk.dim(`    Monthly:   ~${formatCost(monthly)}`));
    log(chalk.dim(`    Yearly:    ~${formatCost(monthly * 12)}`));
    log('');
  }

  log(chalk.bold('  Files created:'));
  const relFiles = filesCreated.map((f) => '    ' + path.relative(process.cwd(), f));
  for (const f of relFiles.slice(0, 8)) log(f);
  if (relFiles.length > 8) log(chalk.dim(`    ... and ${relFiles.length - 8} more`));

  log('');
  log(chalk.bold('  Useful commands:'));
  log(`    ${chalk.cyan('engagement-harness doctor')}         check system health`);
  log(`    ${chalk.cyan('engagement-harness review')}         run review locally`);
  log(`    ${chalk.cyan('engagement-harness feedback pilot-report')}  accuracy metrics`);
  log('');
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
  const filesCreated = scaffoldDirectoryTree({ cwd, config, log });
  ensureGitignoreEntries(cwd);

  const ctx = detectProjectContext(cwd);
  const weeklyPRs = ctx.weeklyPRs;

  await setupCiWorkflow(cwd, {
    yes,
    config,
    setupCi: answers.setupCi,
    commitAndPush: answers.commitAndPush,
    filesCreated,
  });

  printCompletionScreen(
    answers.provider,
    ctx.repoUrl,
    filesCreated,
    weeklyPRs,
    answers.enabledAgents,
    answers.model,
    log,
  );

  return { configPath: ConfigLoader.resolvePath(cwd) };
}

export async function setupCiWorkflow(
  cwd: string,
  options: {
    yes: boolean;
    config: Config;
    setupCi?: boolean;
    commitAndPush?: boolean;
    filesCreated?: string[];
  },
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

    const setupConfirmed =
      options.setupCi !== undefined
        ? options.setupCi
        : options.yes
          ? true
          : await confirm({ message: 'Set up GitHub Actions to run automatically on PRs?', default: true });
    if (!setupConfirmed) return;

    if (!options.yes && options.setupCi === undefined) {
      console.log('  3 workflow files will be created:');
      console.log('  • .github/workflows/engagement-harness.yml   — runs on every PR');
      console.log('  • .github/workflows/feedback-on-merge.yml    — collects reactions on merge');
      console.log('  • .github/workflows/collect-feedback.yml     — weekly learning sweep');
      console.log('');
    }

    const workflowDir = path.join(cwd, '.github', 'workflows');
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(path.join(workflowDir, 'engagement-harness.yml'), generateGithubWorkflow(cwd), 'utf8');

    let workflowCount = 1;
    if (options.config.feedback.enabled) {
      writeFeedbackWorkflows(workflowDir);
      workflowCount = 3;
    }
    console.log(chalk.green('✓') + ` Created ${workflowCount} workflow file${workflowCount > 1 ? 's' : ''}`);
    console.log('');
    console.log(chalk.yellow('⚠️  Action required: add HARNESS_PAT secret to this repository'));
    console.log('   The generated workflows clone the private engagement-harness repo.');
    console.log('   Without this secret, workflows will fail with a git authentication error.');
    console.log('');
    console.log('   1. Create a GitHub PAT with repo:read access to abhishikthmeesala-2000/harness-review');
    console.log('      https://github.com/settings/tokens/new?scopes=repo&description=HARNESS_PAT');
    console.log('   2. Add it as a repository secret named: HARNESS_PAT');
    console.log('      Settings → Secrets and variables → Actions → New repository secret');

    if (options.filesCreated) {
      options.filesCreated.push(path.join(workflowDir, 'engagement-harness.yml'));
      if (workflowCount === 3) {
        options.filesCreated.push(path.join(workflowDir, 'feedback-on-merge.yml'));
        options.filesCreated.push(path.join(workflowDir, 'collect-feedback.yml'));
      }
    }

    const commitConfirmed =
      options.commitAndPush !== undefined
        ? options.commitAndPush
        : options.yes
          ? true
          : await confirm({ message: 'Commit the workflow file to Git?', default: true });

    if (commitConfirmed) {
      execSync('git add .github/workflows/ .engagement-harness/ .gitignore', { cwd, stdio: 'pipe' });
      execSync('git commit -m "ci: add Engagement Harness config and workflow"', { cwd, stdio: 'pipe' });
      let sha = '';
      try {
        sha = execSync('git rev-parse --short HEAD', { cwd, stdio: 'pipe' }).toString().trim();
      } catch {
        // ignore
      }
      console.log(chalk.green('✓') + ` Committed${sha ? ` (${sha})` : ''}`);
    }

    const remoteUrl = await getRemoteUrl(cwd);

    if (remoteUrl && commitConfirmed) {
      const pushConfirmed =
        options.commitAndPush !== undefined
          ? options.commitAndPush
          : options.yes
            ? true
            : await confirm({ message: 'Push to remote repository?', default: true });

      if (pushConfirmed) {
        const branch = await getCurrentBranch(cwd);
        execSync(`git push origin -- ${branch}`, { cwd, stdio: 'pipe' });
        console.log(chalk.green('✓') + ` Pushed to origin/${branch}`);
      }
    }
  } catch (err) {
    console.log(
      chalk.yellow('  Warning: CI setup encountered an error —') +
        ` ${err instanceof Error ? err.message : String(err)}`,
    );
    console.log(
      chalk.dim('  Run `engagement-harness ci templates --platform github --write` to set up CI manually.'),
    );
  }
}

async function promptAnswersInteractive(
  defaults: InitAnswers,
  profile: RepoProfile,
): Promise<InitAnswers> {
  const { input, select, checkbox, confirm } = await import('@inquirer/prompts');
  const log = (s: string) => console.log(s);

  // Part 1: Auto-detection
  const ctx = detectProjectContext(process.cwd());
  log('');
  log(chalk.bold('Detecting your project...'));
  log('');
  log(chalk.green('  ✓') + ` Project:    ${chalk.bold(ctx.projectName)} (${ctx.projectType})`);
  if (ctx.repoUrl) {
    const platform = ctx.repoUrl.includes('github')
      ? 'GitHub'
      : ctx.repoUrl.includes('gitlab')
        ? 'GitLab'
        : 'Git';
    log(chalk.green('  ✓') + ` Platform:   ${platform} (${ctx.repoUrl.replace('https://', '')})`);
  }
  log(chalk.green('  ✓') + ` PR volume:  ~${ctx.weeklyPRs} PRs/week`);
  if (ctx.stackSummary.length > 0) {
    log(chalk.green('  ✓') + ` Stack:      ${ctx.stackSummary.join(' · ')}`);
  }
  if (profile.language || profile.ciProvider) {
    const parts: string[] = [];
    if (profile.language) parts.push(`language=${profile.language}`);
    if (profile.ciProvider) parts.push(`ci=${profile.ciProvider}`);
    if (profile.framework) parts.push(`framework=${profile.framework}`);
    log(chalk.dim(`  Auto-detected: ${parts.join(', ')}`));
  }
  log('');

  // Part 2: Step 0 — Provider
  printProgress(0, log);

  const providerChoice = (await select({
    message: 'Which AI provider?',
    choices: [
      { value: 'anthropic', name: 'Anthropic (Claude)  — recommended' },
      { value: 'openai', name: 'OpenAI (GPT-4)' },
      { value: 'mock', name: 'Skip (mock mode — free but no real findings)' },
    ],
    default: 'anthropic',
  })) as 'anthropic' | 'openai' | 'mock';

  let model = defaults.model;
  if (providerChoice === 'mock') {
    log('');
    log(chalk.yellow('  ⚠  Mock mode: reviews will run but produce no findings.'));
    log(chalk.yellow('     You can enable real AI later in config.json.'));
    log('');
  } else {
    const modelChoices = providerChoice === 'anthropic' ? ANTHROPIC_MODELS : OPENAI_MODELS;
    model = await select({
      message: 'Which model?',
      choices: modelChoices,
      default: modelChoices[0]?.value,
    });
  }

  // Part 3: Step 1 — Agents
  printProgress(1, log);

  let enabledAgents: string[] = [...DEFAULT_AGENT_IDS];
  if (providerChoice !== 'mock') {
    const agentChoices = [...DEFAULT_AGENT_IDS].map((id) => ({
      value: id,
      name: `${id.padEnd(20)} — ${AGENT_DESCRIPTIONS[id] ?? ''}`,
      checked: ['security', 'testing', 'reviewer', 'pr-intent-gap'].includes(id),
    }));

    enabledAgents = await checkbox({
      message: 'Which agents to enable with AI? (Space to toggle)',
      choices: agentChoices,
    });

    if (enabledAgents.length === 0) {
      log(chalk.yellow('  ⚠  No agents selected — defaulting to security and testing'));
      enabledAgents = ['security', 'testing'];
    }

    // Show cost summary
    const costPerPR = estimateCostPerPR(providerChoice, model, enabledAgents.length);
    const weeklyPRs = ctx.weeklyPRs;
    const monthly = estimateMonthly(costPerPR, weeklyPRs);
    log('');
    log(chalk.dim(`  Model:    ${model}`));
    log(chalk.dim(`  Selected: ${enabledAgents.length} agents`));
    log('');
    log(chalk.dim(`  Cost per PR:    ~${formatCost(costPerPR)}`));
    log(chalk.dim(`  Weekly (~${weeklyPRs} PRs): ~${formatCost(costPerPR * weeklyPRs)}`));
    log(chalk.dim(`  Monthly:        ~${formatCost(monthly)}`));
    log(chalk.dim(`  Yearly:         ~${formatCost(monthly * 12)}`));
    log('');
  }

  // Part 4: Step 2 — Review behavior
  printProgress(2, log);

  const postComments = (await select({
    message: 'Post findings as inline PR comments?',
    choices: [
      { value: true, name: 'Yes — post inline comments (recommended)' },
      { value: false, name: 'No — artifact only' },
    ],
    default: true,
  })) as boolean;

  log(chalk.dim('  Tip: Enable blocking after 2 weeks of tuning'));
  const blockOnPolicy = (await select({
    message: 'Block PR merge on critical findings?',
    choices: [
      { value: false, name: 'No — advisory only (recommended)' },
      { value: true, name: 'Yes — block merge' },
    ],
    default: false,
  })) as boolean;

  // Part 5: Step 3 — CI
  printProgress(3, log);

  let setupCi = false;
  let commitAndPush = false;

  const platform = await detectGitPlatform(process.cwd());
  if (platform === 'github' || platform === null) {
    setupCi = await confirm({
      message: 'Set up GitHub Actions automatically?',
      default: true,
    });

    if (setupCi) {
      log('');
      log('  3 workflow files will be created:');
      log('  • .github/workflows/engagement-harness.yml   — runs on every PR');
      log('  • .github/workflows/feedback-on-merge.yml    — collects reactions on merge');
      log('  • .github/workflows/collect-feedback.yml     — weekly learning sweep');
      log('');

      commitAndPush = await confirm({
        message: 'Commit and push now?',
        default: true,
      });
    }
  }

  // Only ask for ALM platform if not auto-detected
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
    log(chalk.dim(`  ALM platform: ${defaults.almPlatform} (auto-detected)`));
  }

  const clientName = await input({ message: 'Client name', default: ctx.projectName });
  const engagement = await input({ message: 'Engagement name / phase', default: defaults.engagement });

  return {
    ...defaults,
    clientName,
    engagement,
    almPlatform,
    enabledAgents,
    provider: providerChoice,
    model,
    postComments,
    blockOnPolicy,
    setupCi,
    commitAndPush,
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
