/**
 * Run the actual reviewCommand with a real Anthropic provider config
 * against the sample repo, then print what inline PR comments would be posted.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/run-real-anthropic-review.ts
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_REPO = path.join(REPO_ROOT, 'examples', 'sample-repo');

async function main(): Promise<void> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) { console.error('ERROR: ANTHROPIC_API_KEY not set.'); process.exit(1); }

  // ── 1. Create fixture repo ────────────────────────────────────────────────
  const tmpDir = path.join(os.tmpdir(), `eh-anthropic-real-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  cpSync(SAMPLE_REPO, tmpDir, { recursive: true });

  // Anthropic config — security agent only, maps to anthropic provider
  const config = {
    client: { name: 'Demo Client', engagement: 'anthropic-real-test' },
    agents: { enabled: ['security'] },
    providers: { mock: {}, anthropic: { model: 'claude-sonnet-4-20250514' } },
    models: { security: 'anthropic' },
    review: { confidenceThreshold: 0.6, severityThreshold: 'low', requireVerifierApproval: false },
    alm: { platform: 'none' },
    ci: { blockOnPolicy: false, postComments: false, artifactsOnly: false },
    reports: { formats: ['json', 'markdown'], outputDir: '.engagement-harness/reports' },
  };
  const configDir = path.join(tmpDir, '.engagement-harness');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');

  const git = (cmd: string): void => { execSync(cmd, { cwd: tmpDir, stdio: 'pipe' }); };
  git('git init');
  git('git config user.email "test@example.com"');
  git('git config user.name "Test"');
  git('git commit --allow-empty -m "base"');
  git('git add .');
  git('git commit -m "add sample files"');

  console.log(`\nFixture repo: ${tmpDir}`);
  console.log('Config: security agent → anthropic (claude-sonnet-4-20250514)\n');

  // ── 2. Run reviewCommand ──────────────────────────────────────────────────
  const originalCwd = process.cwd();
  process.chdir(tmpDir);

  // Patch process.exit so the command doesn't kill this script
  const exitCodes: number[] = [];
  const origExit = process.exit.bind(process);
  (process as NodeJS.Process).exit = ((code?: number) => {
    exitCodes.push(code ?? 0);
  }) as typeof process.exit;

  const { reviewCommand } = await import('../packages/cli/src/commands/review.js');

  console.log('Running reviewCommand...\n');
  await reviewCommand({ ci: false, base: 'HEAD~1', head: 'HEAD' });

  (process as NodeJS.Process).exit = origExit;
  process.chdir(originalCwd);

  // ── 3. Read generated JSON report ────────────────────────────────────────
  const reportsDir = path.join(tmpDir, '.engagement-harness', 'reports');
  const runs = existsSync(reportsDir)
    ? readdirSync(reportsDir).filter(d => d.startsWith('run-'))
    : [];
  if (runs.length === 0) { console.error('No report found.'); rmSync(tmpDir, { recursive: true, force: true }); process.exit(1); }

  const reportPath = path.join(reportsDir, runs[0]!, 'report.json');
  const raw = JSON.parse(readFileSync(reportPath, 'utf8')) as {
    result: {
      published: Array<{
        id: string; title: string; severity: string; file: string;
        lineStart: number; lineEnd: number; confidence: number;
        sourceAgent: string; modelProvider: string;
        whyItMatters: string; suggestedFix: string;
        verification: { status: string; reason: string };
      }>;
      rejected: Array<{ finding: { id: string; title: string }; reason: string; stage: string }>;
      decision: string;
      overallConfidence: number;
      metrics: { totalCandidates: number; publishedCount: number };
    };
  };
  const report = raw.result;

  // ── 4. Print results ──────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(68));
  console.log('PIPELINE RESULT');
  console.log('═'.repeat(68));
  console.log(`Decision:          ${report.decision}`);
  console.log(`Overall confidence:${Math.round(report.overallConfidence * 100)}%`);
  console.log(`Total candidates:  ${report.metrics.totalCandidates}`);
  console.log(`Published:         ${report.metrics.publishedCount}`);
  console.log(`Rejected:          ${report.rejected.length}`);

  if (report.rejected.length > 0) {
    console.log('\nRejected:');
    for (const r of report.rejected) {
      console.log(`  ✗ [${r.stage}] ${r.finding.id}: ${r.reason}`);
    }
  }

  console.log(`\n${'═'.repeat(68)}`);
  console.log(`INLINE PR COMMENTS (${report.published.length})`);
  console.log('═'.repeat(68));

  for (let i = 0; i < report.published.length; i++) {
    const f = report.published[i]!;
    const pct = Math.round(f.confidence * 100);
    const body = [
      `### [${f.severity.toUpperCase()}] ${f.title}`,
      '',
      `**Why it matters:** ${f.whyItMatters}`,
      '',
      `**Suggested fix:**`,
      f.suggestedFix,
      '',
      `---`,
      `*Engagement Harness · agent: \`${f.sourceAgent}\` · confidence: ${pct}%*`,
    ].join('\n');

    console.log(`\n${'─'.repeat(68)}`);
    console.log(`Finding ${i + 1}/${report.published.length}  [${f.severity.toUpperCase()}]  confidence: ${pct}%`);
    console.log(`File: ${f.file}  lines ${f.lineStart}–${f.lineEnd}`);
    console.log(`Agent: ${f.sourceAgent}  Provider: ${f.modelProvider}`);
    console.log(`Verification: ${f.verification.status} — ${f.verification.reason}`);
    console.log(`\nGitHub API payload (POST /pulls/{n}/comments):`);
    console.log(JSON.stringify({
      commit_id: '<HEAD sha>',
      path: f.file,
      line: f.lineEnd,
      side: 'RIGHT',
      body,
    }, null, 2).split('\n').map(l => '  ' + l).join('\n'));
    console.log('\nRendered:');
    console.log('  ' + '─'.repeat(60));
    body.split('\n').forEach(l => console.log('  ' + l));
    console.log('  ' + '─'.repeat(60));
  }

  console.log(`\n${'═'.repeat(68)}`);
  console.log(`SUMMARY: ${report.published.length} inline + 1 summary comment would be posted`);
  console.log('═'.repeat(68));

  // Cleanup
  rmSync(tmpDir, { recursive: true, force: true });
}

main().catch(err => { console.error(err); process.exit(1); });
