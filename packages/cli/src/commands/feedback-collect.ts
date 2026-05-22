import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FeedbackImporter, type MetricsSummary } from '@engagement-harness/eval';
import chalk from 'chalk';

export interface FeedbackCollectOptions {
  repo: string;
  pr?: number;
  since?: string;
  memoryDir?: string;
}

interface GitHubComment {
  id: number;
  body: string;
}

interface GitHubReaction {
  content: string;
}

interface GitHubPull {
  number: number;
  updated_at: string;
}

const REACTION_PRIORITY = ['-1', '+1', 'hooray', 'confused', 'eyes', 'heart'];

const REACTION_MAP: Record<string, string> = {
  '+1': 'accepted',
  '-1': 'false_positive',
  'heart': 'accepted',
  'hooray': 'fixed',
  'confused': 'dismissed',
  'eyes': 'dismissed',
};

const METADATA_RE = /<!--\s*eh-metadata:\s*findingId=(\S+)\s+runId=(\S+)\s*-->/;

function parseSince(since: string): Date {
  const daysMatch = /^(\d+)days?$/i.exec(since);
  if (daysMatch) {
    const d = new Date();
    d.setDate(d.getDate() - Number(daysMatch[1]));
    return d;
  }
  return new Date(since);
}

async function ghFetch<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status} for ${url}`);
  }
  return res.json() as Promise<T>;
}

function pickReaction(reactions: GitHubReaction[]): string | null {
  for (const key of REACTION_PRIORITY) {
    if (reactions.some((r) => r.content === key)) {
      return REACTION_MAP[key] ?? null;
    }
  }
  return null;
}

export async function feedbackCollectCommand(options: FeedbackCollectOptions): Promise<void> {
  const token = process.env['GITHUB_TOKEN'];
  if (!token) {
    console.error(chalk.red('GITHUB_TOKEN env var not set — cannot collect feedback.'));
    process.exit(1);
    return;
  }

  const [owner, repoName] = options.repo.split('/');
  if (!owner || !repoName) {
    console.error(chalk.red(`Invalid --repo value "${options.repo}". Expected "owner/repo".`));
    process.exit(1);
    return;
  }

  const base = `https://api.github.com/repos/${owner}/${repoName}`;
  const sinceDate = options.since ? parseSince(options.since) : (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d; })();

  let prNumbers: number[];

  if (options.pr !== undefined) {
    prNumbers = [options.pr];
  } else {
    try {
      const pulls = await ghFetch<GitHubPull[]>(
        `${base}/pulls?state=all&per_page=100`,
        token,
      );
      prNumbers = pulls
        .filter((p) => new Date(p.updated_at) >= sinceDate)
        .map((p) => p.number);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Failed to list PRs: ${msg}`));
      process.exit(1);
      return;
    }
  }

  if (prNumbers.length === 0) {
    console.log(chalk.dim('No PRs found to scan.'));
    return;
  }

  type FeedbackEntry = {
    findingId: string;
    runId: string;
    state: string;
    timestamp: string;
    source: string;
  };

  const feedbackMap = new Map<string, FeedbackEntry>();

  for (const prNum of prNumbers) {
    let comments: GitHubComment[];
    try {
      comments = await ghFetch<GitHubComment[]>(
        `${base}/issues/${prNum}/comments?per_page=100`,
        token,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(chalk.yellow(`  [warn] PR #${prNum}: failed to fetch comments — ${msg}`));
      continue;
    }

    const findingComments = comments.filter((c) => METADATA_RE.test(c.body));

    for (const comment of findingComments) {
      const match = METADATA_RE.exec(comment.body);
      if (!match) continue;
      const findingId = match[1]!;
      const runId = match[2]!;

      let reactions: GitHubReaction[];
      try {
        reactions = await ghFetch<GitHubReaction[]>(
          `${base}/issues/comments/${comment.id}/reactions`,
          token,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(chalk.yellow(`  [warn] comment ${comment.id} (${findingId}): failed to fetch reactions — ${msg}`));
        continue;
      }

      const state = pickReaction(reactions);
      if (!state) continue;

      feedbackMap.set(findingId, {
        findingId,
        runId,
        state,
        timestamp: new Date().toISOString(),
        source: 'github-reactions',
      });
    }
  }

  if (feedbackMap.size === 0) {
    console.log(chalk.dim('No feedback reactions found.'));
    return;
  }

  const entries = [...feedbackMap.values()];
  const timestamp = Date.now();
  const tmpPath = join(tmpdir(), `feedback-auto-${timestamp}.json`);
  writeFileSync(tmpPath, JSON.stringify(entries, null, 2) + '\n', 'utf8');

  try {
    await new FeedbackImporter().import(tmpPath, process.cwd());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Failed to import feedback: ${msg}`));
    process.exit(1);
    return;
  }

  const counts: Record<string, number> = {};
  for (const e of entries) {
    counts[e.state] = (counts[e.state] ?? 0) + 1;
  }

  console.log(chalk.green(`✓ Collected ${entries.length} feedback entries from reactions`));
  for (const [state, count] of Object.entries(counts)) {
    console.log(`  ${state}: ${count}`);
  }

  if (options.memoryDir) {
    writeMemoryFile(options.memoryDir, counts, entries.length);
    console.log(chalk.dim(`  memory → ${options.memoryDir}/feedback_pr_reactions.md`));
  }
}

function writeMemoryFile(
  memoryDir: string,
  deltaCounts: Record<string, number>,
  deltaTotal: number,
): void {
  const metricsFile = join(process.cwd(), '.engagement-harness/feedback/metrics.json');
  let totalLine = `Delta this run: ${deltaTotal} entries`;

  if (existsSync(metricsFile)) {
    const metrics = JSON.parse(readFileSync(metricsFile, 'utf8')) as MetricsSummary;
    const stateLines = Object.entries(metrics.byState)
      .filter(([, n]) => n > 0)
      .map(([s, n]) => `- ${s}: ${n}`)
      .join('\n');
    totalLine = `Cumulative totals (${metrics.totalEntries} entries):\n${stateLines}`;
  }

  const deltaLines = Object.entries(deltaCounts)
    .map(([s, n]) => `- ${s}: ${n}`)
    .join('\n');

  const falsePositiveCount = deltaCounts['false_positive'] ?? 0;
  const acceptedCount = deltaCounts['accepted'] ?? 0;
  const fpNote =
    falsePositiveCount > acceptedCount
      ? '\n**Signal:** false_positive > accepted this run — consider tightening confidence/severity thresholds in config.'
      : '';

  const body = `---
name: feedback-pr-reactions-summary
description: Aggregate feedback from GitHub PR comment reactions — acceptance/rejection patterns for engagement-harness findings
metadata:
  type: project
---

Last collected: ${new Date().toISOString()}

${totalLine}

This run delta:
${deltaLines}${fpNote}

**Why:** Collected automatically from GitHub PR comment reactions (👍=accepted, 👎=false_positive, 🚀=fixed, 😕=dismissed).
**How to apply:** High false_positive rate signals overly permissive quality gate — tune \`review.confidenceThreshold\` or \`review.severityThreshold\` in \`.engagement-harness/config.json\`.
`;

  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
  writeFileSync(join(memoryDir, 'feedback_pr_reactions.md'), body, 'utf8');
}
