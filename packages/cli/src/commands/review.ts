import { execSync } from 'node:child_process';
import path from 'node:path';

import {
  AgentOrchestrator,
  CrossFileReviewer,
  ModelRouter,
  PerFileOrchestrator,
} from '@engagement-harness/agents';
import {
  ConfigLoader,
  ContextEngine,
  createAlmAdapter,
  GitDiffParser,
  RepoProfiler,
  SecretRedactor,
} from '@engagement-harness/core';
import { GitHubCommenter } from '@engagement-harness/ci';
import { FindingPipeline, FindingTracker } from '@engagement-harness/pipeline';
import { ReportGenerator, ReportWriter } from '@engagement-harness/reports';
import chalk from 'chalk';

import type { RunMetadata } from '@engagement-harness/reports';

const SEVERITY_COLOR: Record<string, (s: string) => string> = {
  critical: chalk.red,
  high: chalk.yellow,
  medium: chalk.cyan,
  low: chalk.blue,
};

const DECISION_COLOR: Record<string, (s: string) => string> = {
  approved: chalk.green,
  approved_with_warnings: chalk.yellow,
  needs_manual_review: chalk.cyan,
  blocked_by_policy: chalk.red,
};

export interface ReviewOptions {
  ci?: boolean;
  base?: string;
  head?: string;
}

export function buildInlineCommentBody(
  f: {
    title: string;
    severity: string;
    dimension?: string;
    whyItMatters: string;
    suggestedFix: string;
    sourceAgent: string;
    confidence?: number;
    id: string;
  },
  runId: string,
): string {
  const pct = f.confidence !== undefined ? ` · confidence: ${Math.round(f.confidence * 100)}%` : '';
  const metaParts = [
    `findingId=${f.id}`,
    `runId=${runId}`,
    `sourceAgent=${f.sourceAgent}`,
    ...(f.dimension ? [`dimension=${f.dimension}`] : []),
    `severity=${f.severity}`,
  ];
  return [
    `### [${f.severity.toUpperCase()}] ${f.title}`,
    '',
    `**Why it matters:** ${f.whyItMatters}`,
    '',
    `**Suggested fix:**`,
    f.suggestedFix,
    '',
    `---`,
    `*Engagement Harness · agent: \`${f.sourceAgent}\`${pct}*`,
    '',
    `---`,
    `**React to provide feedback:**  `,
    `👍 Accepted (will fix) | 👎 False positive | 🚀 Already fixed | 😕 Dismissed`,
    '',
    `<!-- eh-metadata: ${metaParts.join(' ')} -->`,
  ].join('\n');
}

function resolveMergeBase(repoRoot: string): string {
  try {
    return execSync('git merge-base origin/main HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    // fall back to parent commit when no origin/main (e.g. shallow clones, fresh repos)
    try {
      return execSync('git rev-parse HEAD~1', {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      return 'HEAD~1';
    }
  }
}

export async function reviewCommand(options: ReviewOptions): Promise<void> {
  const repoRoot = process.cwd();

  if (!ConfigLoader.exists(repoRoot)) {
    console.warn(
      chalk.yellow(
        '[engagement-harness] No config found. Run `engagement-harness init` first. Skipping review.',
      ),
    );
    process.exit(0);
    return;
  }

  const config = ConfigLoader.load(repoRoot);

  const baseRef = options.base ?? process.env['GITHUB_BASE_REF'] ?? resolveMergeBase(repoRoot);
  const headRef = options.head ?? process.env['GITHUB_SHA'] ?? 'HEAD';

  const prTitle = process.env['GITHUB_PR_TITLE'] ?? '';
  const prBody = process.env['GITHUB_PR_BODY'] ?? '';

  console.log(chalk.dim(`[review] base: ${baseRef}  head: ${headRef}`));

  // Generate runId early so it can be threaded through context and finding metadata.
  const runTimestamp = new Date();
  const runId = runTimestamp.toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
  const runMetadata = { runId, timestamp: runTimestamp.toISOString() };

  const diffs = await GitDiffParser.parseDiff(repoRoot, baseRef, headRef);
  const profile = RepoProfiler.detect(repoRoot);
  const prMetadata = prTitle || prBody ? { title: prTitle, body: prBody } : undefined;
  const rawBundle = ContextEngine.build(diffs, repoRoot, profile, config, {
    prMetadata,
    runMetadata,
  });
  const bundle = SecretRedactor.redactBundle(rawBundle);

  const orchestrator = new AgentOrchestrator();

  // Pass 1: per-file analysis (all agents, one file at a time, in parallel).
  const pass1Findings = await new PerFileOrchestrator(orchestrator).execute(bundle, config);

  // Pass 2: cross-file integration analysis (skipped automatically for single-file PRs).
  const crossFileProvider = ModelRouter.route('reviewer', config);
  const pass2Findings = await new CrossFileReviewer(crossFileProvider).execute(
    bundle,
    pass1Findings,
  );

  const candidates = [...pass1Findings, ...pass2Findings];

  const result = await FindingPipeline.process(candidates, bundle, config);

  // Enrich published findings with run/PR metadata for comment traceability.
  const prNumber = detectPrNumber();
  const repository = process.env['GITHUB_REPOSITORY'];
  const publishedWithMeta = result.published.map((f) => ({
    ...f,
    metadata: {
      runId,
      timestamp: runTimestamp.toISOString(),
      ...(prNumber !== null ? { prNumber } : {}),
      ...(repository ? { repository } : {}),
    },
  }));

  // Delta tracking only makes sense in CI (where a PR number is available).
  // Local runs skip it and report all findings as normal.
  let delta: Awaited<ReturnType<FindingTracker['filterNew']>> | null = null;
  if (prNumber !== null) {
    const tracker = new FindingTracker(repoRoot);
    await tracker.load();
    delta = tracker.filterNew(publishedWithMeta, prNumber);
    await tracker.recordFindings(publishedWithMeta, prNumber);
    console.log(
      `\nDelta: ${delta.newFindings.length} new | ` +
        `${delta.outstandingFindings.length} outstanding | ` +
        `${delta.resolvedFindings.length} resolved`,
    );
  }

  const agentsRun = [...new Set(candidates.map((c) => c.sourceAgent))];
  const providersUsed = [...new Set(candidates.map((c) => c.modelProvider))];

  const meta: RunMetadata = {
    runId,
    timestamp: new Date().toISOString(),
    baseRef,
    headRef,
    repoProfile: profile,
    agentsRun,
    providersUsed,
  };

  const reports = ReportGenerator.generateAll(result, meta, config);
  ReportWriter.write(reports, path.join(repoRoot, config.reports.outputDir), runId);

  // Post comments as issue comments (for feedback reaction collection).
  // New findings get individual inline comments; a summary comment always
  // reflects the current new/outstanding/resolved state of the PR.
  if (config.ci.postComments && process.env['GITHUB_TOKEN'] && prNumber !== null && delta) {
    try {
      const ghRepo = process.env['GITHUB_REPOSITORY'] ?? '';
      const [ghOwner, ghRepoName] = ghRepo.split('/');
      if (ghOwner && ghRepoName) {
        const commenter = new GitHubCommenter({
          token: process.env['GITHUB_TOKEN'],
          owner: ghOwner,
          repo: ghRepoName,
          runId,
        });
        for (const finding of delta.newFindings) {
          await commenter.postFindingComment(finding, prNumber);
        }
        await commenter.postReviewSummary(prNumber, delta);
      }
    } catch {
      // never fail the build because of comment errors
    }
  }

  // ALM integration — post summary and support non-GitHub platforms
  if (config.ci.postComments) {
    try {
      const alm = createAlmAdapter(config);
      const prRef = detectPrRef();
      if (prRef && reports['markdown']) {
        await alm.postSummary(prRef, reports['markdown']);
      }
    } catch {
      // never fail the build because of ALM errors
    }
  }

  // Print summary
  const decisionFn = DECISION_COLOR[result.decision] ?? chalk.white;
  console.log('');
  console.log(chalk.bold('Engagement Harness Review'));
  console.log(`Decision:   ${decisionFn(result.decision)}`);
  console.log(`Confidence: ${Math.round(result.overallConfidence * 100)}%`);
  console.log(
    `Findings:   ${result.metrics.publishedCount} published / ` +
      `${result.metrics.totalCandidates - result.metrics.publishedCount} rejected`,
  );

  if (publishedWithMeta.length > 0) {
    console.log('');
    console.log(chalk.bold('Top findings:'));
    const top = publishedWithMeta.slice(0, 3);
    for (const f of top) {
      const colorFn = SEVERITY_COLOR[f.severity] ?? chalk.white;
      console.log(
        `  ${colorFn(`[${f.severity.toUpperCase()}]`)} ${f.file}:${f.lineStart}  ${f.title}`,
      );
    }
  }

  console.log('');
  console.log(
    chalk.dim(`Reports written to ${path.join(config.reports.outputDir, `run-${runId}`)}`),
  );

  if (config.ci.blockOnPolicy && result.decision === 'blocked_by_policy') {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

function detectPrRef(): { owner: string; repo: string; pullNumber: number } | null {
  const repo = process.env['GITHUB_REPOSITORY']; // "owner/repo"
  const prNum = process.env['GITHUB_PR_NUMBER'] ?? process.env['PR_NUMBER'];
  if (!repo || !prNum) return null;
  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) return null;
  return { owner, repo: repoName, pullNumber: Number(prNum) };
}

function detectPrNumber(): number | null {
  const prNum = process.env['GITHUB_PR_NUMBER'] ?? process.env['PR_NUMBER'];
  if (!prNum) return null;
  const n = Number(prNum);
  return Number.isFinite(n) && n > 0 ? n : null;
}
