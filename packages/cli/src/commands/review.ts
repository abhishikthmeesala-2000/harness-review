import { execSync } from 'node:child_process';
import path from 'node:path';

import {
  AgentOrchestrator,
} from '@engagement-harness/agents';
import {
  ConfigLoader,
  ContextEngine,
  createAlmAdapter,
  GitDiffParser,
  RepoProfiler,
  SecretRedactor,
} from '@engagement-harness/core';
import { FindingPipeline } from '@engagement-harness/pipeline';
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

  const baseRef =
    options.base ?? process.env['GITHUB_BASE_REF'] ?? resolveMergeBase(repoRoot);
  const headRef = options.head ?? process.env['GITHUB_SHA'] ?? 'HEAD';

  const prTitle = process.env['GITHUB_PR_TITLE'] ?? '';
  const prBody = process.env['GITHUB_PR_BODY'] ?? '';

  console.log(chalk.dim(`[review] base: ${baseRef}  head: ${headRef}`));

  const diffs = await GitDiffParser.parseDiff(repoRoot, baseRef, headRef);
  const profile = RepoProfiler.detect(repoRoot);
  const prMetadata = prTitle || prBody ? { title: prTitle, body: prBody } : undefined;
  const rawBundle = ContextEngine.build(diffs, repoRoot, profile, config, { prMetadata });
  const bundle = SecretRedactor.redactBundle(rawBundle);

  const orchestrator = new AgentOrchestrator();
  const candidates = await orchestrator.run(bundle, config);

  const result = await FindingPipeline.process(candidates, bundle, config);

  const agentsRun = [...new Set(candidates.map((c) => c.sourceAgent))];
  const providersUsed = [...new Set(candidates.map((c) => c.modelProvider))];

  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';

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

  // ALM integration — only when postComments is explicitly enabled
  if (config.ci.postComments) {
    try {
      const alm = createAlmAdapter(config);
      const prRef = detectPrRef(); // extract from env vars GITHUB_REPOSITORY + GITHUB_PR_NUMBER
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

  if (result.published.length > 0) {
    console.log('');
    console.log(chalk.bold('Top findings:'));
    const top = result.published.slice(0, 3);
    for (const f of top) {
      const colorFn = SEVERITY_COLOR[f.severity] ?? chalk.white;
      console.log(`  ${colorFn(`[${f.severity.toUpperCase()}]`)} ${f.file}:${f.lineStart}  ${f.title}`);
    }
  }

  console.log('');
  console.log(chalk.dim(`Reports written to ${path.join(config.reports.outputDir, `run-${runId}`)}`));

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
