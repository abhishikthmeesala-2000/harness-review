import {
  ClaudeMemoryExporter,
  FeedbackDeduplicator,
  FeedbackStore,
  MetricsCalculator,
  ReactionCollector,
} from '@engagement-harness/feedback';
import { FpPatternStore } from '@engagement-harness/pipeline';
import chalk from 'chalk';
import { getRemoteUrl } from '../utils/git.js';

export interface FeedbackCollectOptions {
  repo?: string;
  pr?: number;
  days?: number;
  since?: string;
  memoryDir?: string;
}

function parseOwnerRepo(raw: string): { owner: string; repo: string } | null {
  // HTTPS:  https://github.com/owner/repo  or  https://github.com/owner/repo.git
  // SSH:    git@github.com:owner/repo.git
  const https = /github\.com\/([^/]+)\/([^/.]+)/;
  const ssh = /github\.com:([^/]+)\/([^/.]+)/;
  const m = https.exec(raw) ?? ssh.exec(raw);
  return m && m[1] && m[2] ? { owner: m[1], repo: m[2] } : null;
}

export async function feedbackCollectCommand(options: FeedbackCollectOptions): Promise<void> {
  const token = process.env['GITHUB_TOKEN'];
  if (!token) {
    console.error(chalk.red('GITHUB_TOKEN env var not set — cannot collect feedback.'));
    process.exit(1);
    return;
  }

  let owner: string;
  let repoName: string;

  if (options.repo) {
    const parts = options.repo.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      console.error(chalk.red(`Invalid --repo value "${options.repo}". Expected "owner/repo".`));
      process.exit(1);
      return;
    }
    owner = parts[0];
    repoName = parts[1];
  } else {
    // Auto-detect from git remote
    const remoteUrl = await getRemoteUrl(process.cwd());
    const parsed = remoteUrl ? parseOwnerRepo(remoteUrl) : null;
    if (!parsed) {
      console.error(
        chalk.red(
          'Could not detect GitHub repo from git remote. Pass --repo owner/repo explicitly.',
        ),
      );
      process.exit(1);
      return;
    }
    owner = parsed.owner;
    repoName = parsed.repo;
    console.log(chalk.dim(`[feedback] repo detected from git remote: ${owner}/${repoName}`));
  }

  const collector = new ReactionCollector({ token, owner, repo: repoName });

  let result;
  if (options.pr !== undefined) {
    console.log(chalk.dim(`[feedback] collecting from PR #${options.pr}...`));
    result = await collector.collectFromSinglePR(options.pr);
  } else {
    const days = options.days ?? parseDays(options.since) ?? 7;
    console.log(chalk.dim(`[feedback] collecting from last ${days} days...`));
    result = await collector.collect(days);
  }

  if (result.collected.length === 0) {
    console.log(chalk.dim('No feedback reactions found.'));
    return;
  }

  const store = new FeedbackStore();
  const existing = store.loadAllFeedback();
  const deduplicator = new FeedbackDeduplicator();
  const merged = deduplicator.merge(existing, result.collected);
  store.saveFeedback(merged);

  const calculator = new MetricsCalculator();
  const metrics = calculator.calculate(merged);
  store.saveMetrics(metrics);

  // Learn FP patterns from false_positive reactions
  const fpStore = new FpPatternStore(process.cwd());
  for (const item of result.collected) {
    if (item.state === 'false_positive') {
      fpStore.learnFromFalsePositive({
        sourceAgent: item.metadata?.sourceAgent,
        category: item.metadata?.dimension,
        timestamp: item.timestamp,
      });
    }
  }

  const counts: Record<string, number> = {};
  for (const item of result.collected) {
    counts[item.state] = (counts[item.state] ?? 0) + 1;
  }

  console.log(
    chalk.green(`✓ Collected ${result.collected.length} feedback entries from reactions`),
  );
  for (const [state, count] of Object.entries(counts)) {
    console.log(`  ${state}: ${count}`);
  }

  if (options.memoryDir) {
    const exporter = new ClaudeMemoryExporter();
    exporter.export(metrics, options.memoryDir);
    console.log(chalk.dim(`  memory → ${options.memoryDir}/feedback_pr_reactions.md`));
  }
}

function parseDays(since: string | undefined): number | undefined {
  if (!since) return undefined;
  const m = /^(\d+)days?$/i.exec(since);
  return m ? Number(m[1]) : undefined;
}
