import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  ConfigSchema,
  ContextEngine,
  GitDiffParser,
  RepoProfiler,
  SecretRedactor,
} from '@engagement-harness/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentOrchestrator } from './orchestrator.js';

function git(repo: string, args: string[]): void {
  execFileSync('git', args, {
    cwd: repo,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'EH Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'EH Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function write(repo: string, rel: string, content: string): void {
  const full = path.join(repo, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

describe('end-to-end: diff → context → redact → orchestrator', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'eh-orch-'));
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    write(repo, 'package.json', JSON.stringify({ name: 'fixture' }));
    write(repo, 'src/util.ts', 'export const helper = 1;\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'init']);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('runs the orchestrator on a redacted bundle and produces candidates without leaking the planted secret', async () => {
    const planted = 'AKIAIOSFODNN7EXAMPLE';
    write(
      repo,
      'src/admin/route.ts',
      `// AWS_ACCESS_KEY=${planted}\nexport function adminRoute() { return 1; }\n`,
    );
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'add admin route']);

    const diff = await GitDiffParser.parseDiff(repo, 'HEAD~1', 'HEAD');
    const profile = RepoProfiler.detect(repo);
    const config = ConfigSchema.parse({
      client: { name: 'X', engagement: 'Y' },
      agents: { enabled: ['reviewer', 'security', 'testing'] },
      models: {},
    });
    const bundle = SecretRedactor.redactBundle(ContextEngine.build(diff, repo, profile, config));

    // Defensive: bundle was redacted before reaching the orchestrator.
    expect(JSON.stringify(bundle)).not.toContain(planted);

    const orchestrator = new AgentOrchestrator();
    const candidates = await orchestrator.run(bundle, config);

    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const dimensions = new Set(candidates.map((c) => c.dimension));
    expect(dimensions.has('security')).toBe(true);
    expect(dimensions.has('correctness')).toBe(true);
    expect(dimensions.has('testing')).toBe(true);

    // The planted secret must not surface in any candidate's evidence or text.
    const candidateText = JSON.stringify(candidates);
    expect(candidateText).not.toContain(planted);
  });
});
