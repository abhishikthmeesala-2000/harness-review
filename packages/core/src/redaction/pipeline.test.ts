import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ContextEngine } from '../context/engine.js';
import { GitDiffParser } from '../git/diff-parser.js';
import { RepoProfiler } from '../profile/profiler.js';
import { ConfigSchema } from '../schemas/config.js';
import { SecretRedactor } from './redactor.js';

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

describe('end-to-end: diff → context → redact removes planted secrets', () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'eh-pipeline-'));
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    write(repo, 'package.json', JSON.stringify({ name: 'fixture' }));
    write(repo, 'src/clean.ts', 'export const clean = 1;\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'init']);
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('strips secrets from both context entries and diff lines', async () => {
    // Plant secrets across BOTH the changed file AND a 1-hop import.
    const aws = 'AKIAIOSFODNN7EXAMPLE';
    const gh = 'ghp_' + 'a'.repeat(40);
    const sk = 'sk-' + 'b'.repeat(40);
    const jwt = 'eyJabc123_-XYZ.eyJpYXQiOjE2OTM4MDAwMDB9.signature_part_abc';

    write(repo, 'src/secrets.ts', `export const aws = "${aws}";\nexport const gh = "${gh}";\n`);
    write(
      repo,
      'src/uses-secrets.ts',
      `import { aws } from './secrets.js';\nconst api_key = "${sk}";\nconst tok = "${jwt}";\nexport const x = aws;\n`,
    );
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'add secrets']);

    const diff = await GitDiffParser.parseDiff(repo, 'HEAD~1', 'HEAD');
    const profile = RepoProfiler.detect(repo);
    const config = ConfigSchema.parse({ client: { name: 'X', engagement: 'Y' } });

    const rawBundle = ContextEngine.build(diff, repo, profile, config);

    // Sanity: secrets exist in raw form before redaction.
    const rawConcat = JSON.stringify(rawBundle);
    expect(rawConcat).toContain(aws);

    const redacted = SecretRedactor.redactBundle(rawBundle);
    const concat = JSON.stringify(redacted);
    for (const secret of [aws, gh, sk, jwt]) {
      expect(concat).not.toContain(secret);
    }
    expect(concat).toContain('[REDACTED_SECRET]');
  });
});
