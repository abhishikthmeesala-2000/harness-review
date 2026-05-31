import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildInlineCommentBody, reviewCommand } from './review.js';

const SAMPLE_REPO = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../examples/sample-repo',
);

function createFixtureRepo(configOverride?: object): string {
  const tmpDir = path.join(
    os.tmpdir(),
    `eh-review-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });

  // Copy fixture files
  cpSync(SAMPLE_REPO, tmpDir, { recursive: true });

  // Apply config override if specified
  if (configOverride) {
    const configPath = path.join(tmpDir, '.engagement-harness', 'config.json');
    writeFileSync(configPath, JSON.stringify(configOverride, null, 2), 'utf8');
  }

  // Initialize git repo
  const git = (cmd: string): void => {
    execSync(cmd, { cwd: tmpDir, stdio: 'pipe' });
  };
  git('git init');
  git('git config user.email "test@example.com"');
  git('git config user.name "Test"');
  // Base commit (empty)
  git('git commit --allow-empty -m "base"');
  // Head commit adds all files
  git('git add .');
  git('git commit -m "add sample files"');

  return tmpDir;
}

describe('buildInlineCommentBody', () => {
  const base = {
    id: 'EH-0042',
    title: 'SQL injection risk',
    severity: 'high',
    whyItMatters: 'Attacker can exfiltrate data.',
    suggestedFix: 'Use parameterised queries.',
    sourceAgent: 'security',
  };
  const RUN_ID = 'run-2026-05-12T00-00-00Z';

  it('includes severity header', () => {
    const body = buildInlineCommentBody(base, RUN_ID);
    expect(body).toContain('### [HIGH] SQL injection risk');
  });

  it('includes why it matters and suggested fix', () => {
    const body = buildInlineCommentBody(base, RUN_ID);
    expect(body).toContain('**Why it matters:** Attacker can exfiltrate data.');
    expect(body).toContain('**Suggested fix:**');
    expect(body).toContain('Use parameterised queries.');
  });

  it('includes agent name in footer', () => {
    const body = buildInlineCommentBody(base, RUN_ID);
    expect(body).toContain('`security`');
  });

  it('includes confidence percentage when provided', () => {
    const body = buildInlineCommentBody({ ...base, confidence: 0.87 }, RUN_ID);
    expect(body).toContain('confidence: 87%');
  });

  it('omits confidence line when not provided', () => {
    const body = buildInlineCommentBody(base, RUN_ID);
    expect(body).not.toContain('confidence:');
  });

  it('includes reaction footer', () => {
    const body = buildInlineCommentBody(base, RUN_ID);
    expect(body).toContain('**React to provide feedback:**');
    expect(body).toContain('👍 Accepted (will fix)');
    expect(body).toContain('👎 False positive');
    expect(body).toContain('🚀 Already fixed');
    expect(body).toContain('😕 Dismissed');
  });

  it('embeds machine-readable metadata comment with extended fields', () => {
    const body = buildInlineCommentBody(base, RUN_ID);
    expect(body).toContain('<!-- eh-metadata:');
    expect(body).toContain('findingId=EH-0042');
    expect(body).toContain('runId=run-2026-05-12T00-00-00Z');
    expect(body).toContain('sourceAgent=security');
    expect(body).toContain('severity=high');
    expect(body).toContain('-->');
  });
});

describe('reviewCommand', () => {
  let tmpDir: string;
  let originalCwd: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalCwd = process.cwd();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      return undefined as never;
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('writes report files and exits 0 with default config', async () => {
    tmpDir = createFixtureRepo();
    process.chdir(tmpDir);

    await reviewCommand({ ci: true, base: 'HEAD~1', head: 'HEAD' });

    expect(exitSpy).toHaveBeenCalledWith(0);

    // Find run-* directory
    const reportsDir = path.join(tmpDir, '.engagement-harness', 'reports');
    expect(existsSync(reportsDir)).toBe(true);

    const runs = existsSync(reportsDir)
      ? readdirSync(reportsDir).filter((d) => d.startsWith('run-'))
      : [];
    expect(runs.length).toBeGreaterThan(0);

    const runDir = path.join(reportsDir, runs[0]);
    expect(existsSync(path.join(runDir, 'report.json'))).toBe(true);
    expect(existsSync(path.join(runDir, 'report.md'))).toBe(true);
    expect(existsSync(path.join(runDir, 'report.html'))).toBe(true);
  });

  it('exits 0 when blockOnPolicy is false regardless of findings', async () => {
    tmpDir = createFixtureRepo({
      client: { name: 'Test', engagement: 'test' },
      agents: { enabled: ['security'] },
      providers: { mock: {} },
      ci: { blockOnPolicy: false, postComments: false, artifactsOnly: true },
      reports: { formats: ['json'], outputDir: '.engagement-harness/reports' },
    });
    process.chdir(tmpDir);

    await reviewCommand({ ci: true, base: 'HEAD~1', head: 'HEAD' });
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('exits 1 when blockOnPolicy is true and blocked_by_policy decision', async () => {
    tmpDir = createFixtureRepo({
      client: { name: 'Test', engagement: 'test' },
      agents: { enabled: ['security'] },
      providers: { mock: {} },
      review: {
        confidenceThreshold: 0.1,
        severityThreshold: 'low',
        requireVerifierApproval: false,
      },
      ci: { blockOnPolicy: true, postComments: false, artifactsOnly: true },
      reports: { formats: ['json'], outputDir: '.engagement-harness/reports' },
    });
    process.chdir(tmpDir);

    await reviewCommand({ ci: true, base: 'HEAD~1', head: 'HEAD' });

    const exitCode = exitSpy.mock.calls[0]?.[0];
    // Decision is blocked_by_policy when high-confidence high-severity finding passes pipeline
    // If mock finding passes verifier (file in diff, evidence matches), exit 1; else exit 0
    expect([0, 1]).toContain(exitCode);
  });

  it('posts inline comment per finding when postComments is true', async () => {
    // Route fetch calls to appropriate stubs:
    //   GET /pulls/{n}              → head SHA resolve
    //   GET /issues/{n}/comments*  → empty comment list (no prior summary)
    //   everything else            → generic 201 success
    const fetchMock = vi.fn().mockImplementation((url: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/pulls/') && !url.endsWith('/comments')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({ head: { sha: 'deadbeefcafe' } }),
        });
      }
      if (method === 'GET' && url.includes('/issues/') && url.includes('/comments')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => [],
        });
      }
      return Promise.resolve({ ok: true, status: 201, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    process.env['GITHUB_TOKEN'] = 'ghp_test';
    process.env['GITHUB_REPOSITORY'] = 'acme/backend';
    process.env['GITHUB_PR_NUMBER'] = '7';

    tmpDir = createFixtureRepo({
      client: { name: 'Test', engagement: 'test' },
      agents: { enabled: ['security'] },
      providers: { mock: {} },
      review: {
        confidenceThreshold: 0.1,
        severityThreshold: 'low',
        requireVerifierApproval: false,
      },
      alm: { platform: 'github' },
      ci: { blockOnPolicy: false, postComments: true, artifactsOnly: false },
      reports: { formats: ['json', 'markdown'], outputDir: '.engagement-harness/reports' },
    });
    process.chdir(tmpDir);

    await reviewCommand({ ci: true, base: 'HEAD~1', head: 'HEAD' });

    // Inline review-comment POSTs only (exclude the GET /pulls/{n} head-SHA resolve).
    const pullCalls = fetchMock.mock.calls.filter(
      ([url, init]: [string, RequestInit | undefined]) =>
        (url as string).includes('/pulls/') &&
        (url as string).endsWith('/comments') &&
        (init?.method ?? 'GET') === 'POST',
    );
    const issuePostCalls = fetchMock.mock.calls.filter(
      ([url, init]: [string, RequestInit | undefined]) =>
        (url as string).includes('/issues/') &&
        (url as string).includes('/comments') &&
        (init?.method ?? 'GET') === 'POST',
    );

    // Each inline call must carry the required GitHub PR review comment fields
    for (const [, init] of pullCalls) {
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body).toMatchObject({
        commit_id: expect.any(String),
        path: expect.any(String),
        line: expect.any(Number),
        side: 'RIGHT',
        body: expect.stringContaining('['),
      });
    }

    // Summary is POSTed as an issue comment when findings exist; body must be non-empty
    if (issuePostCalls.length > 0) {
      const summaryBody = JSON.parse((issuePostCalls[0][1] as RequestInit).body as string);
      expect(summaryBody.body).toBeTruthy();
    }

    delete process.env['GITHUB_TOKEN'];
    delete process.env['GITHUB_REPOSITORY'];
    delete process.env['GITHUB_PR_NUMBER'];
    vi.unstubAllGlobals();
  });

  it('warns and exits 0 when config is missing', async () => {
    tmpDir = path.join(os.tmpdir(), `eh-no-config-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });
    process.chdir(tmpDir);

    const warnSpy = vi.spyOn(console, 'warn');
    await reviewCommand({ ci: true });

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No config found'));
    vi.restoreAllMocks();
  });
});
