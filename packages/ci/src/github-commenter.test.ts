import type { Finding } from '@engagement-harness/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubCommenter } from './github-commenter.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'EH-1',
    title: 'SQL injection in deleteUser',
    category: 'security',
    dimension: 'security',
    severity: 'high',
    confidence: 0.9,
    file: 'src/auth.ts',
    lineStart: 42,
    lineEnd: 42,
    evidence: [{ type: 'diff', content: 'db.query(q)' }],
    whyItMatters: 'Injectable.',
    suggestedFix: 'Use parameters.',
    clientRuleReferences: [],
    falsePositiveRisk: 'low',
    sourceAgent: 'security',
    modelProvider: 'mock',
    remediationReadiness: 'ready',
    verification: { status: 'approved', reason: 'ok' },
    pass: 'local',
    ...overrides,
  } as Finding;
}

interface Call {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

/** Install a fetch mock that records calls and routes by URL/method. */
function installFetch(
  responder: (url: string, method: string) => { ok: boolean; status: number; json?: unknown },
): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });
    const r = responder(url, method);
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.json ?? {},
    } as Response;
  });
  return calls;
}

const opts = { token: 't', owner: 'acme', repo: 'app', runId: 'run-1' };

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GitHubCommenter.postFindingComment (inline)', () => {
  it('posts an inline review comment to /pulls/{n}/comments with commit_id, path and line', async () => {
    const calls = installFetch((url) => {
      if (url.endsWith('/pulls/7'))
        return { ok: true, status: 200, json: { head: { sha: 'abc123' } } };
      if (url.endsWith('/pulls/7/comments')) return { ok: true, status: 201 };
      return { ok: false, status: 404 };
    });

    await new GitHubCommenter(opts).postFindingComment(makeFinding(), 7);

    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toMatch(/\/pulls\/7\/comments$/);
    expect(post?.body).toMatchObject({
      commit_id: 'abc123',
      path: 'src/auth.ts',
      line: 42,
      side: 'RIGHT',
    });
    // single-line finding → no start_line
    expect(post?.body?.['start_line']).toBeUndefined();
  });

  it('adds start_line for multi-line findings', async () => {
    const calls = installFetch((url) => {
      if (url.endsWith('/pulls/7'))
        return { ok: true, status: 200, json: { head: { sha: 'abc123' } } };
      if (url.endsWith('/pulls/7/comments')) return { ok: true, status: 201 };
      return { ok: false, status: 404 };
    });

    await new GitHubCommenter(opts).postFindingComment(
      makeFinding({ lineStart: 40, lineEnd: 45 }),
      7,
    );

    const post = calls.find((c) => c.url.endsWith('/pulls/7/comments'));
    expect(post?.body).toMatchObject({ start_line: 40, line: 45, start_side: 'RIGHT' });
  });

  it('resolves the head SHA once and reuses it across findings', async () => {
    const calls = installFetch((url) => {
      if (url.endsWith('/pulls/7'))
        return { ok: true, status: 200, json: { head: { sha: 'abc123' } } };
      if (url.endsWith('/pulls/7/comments')) return { ok: true, status: 201 };
      return { ok: false, status: 404 };
    });

    const commenter = new GitHubCommenter(opts);
    await commenter.postFindingComment(makeFinding({ id: 'EH-1' }), 7);
    await commenter.postFindingComment(makeFinding({ id: 'EH-2' }), 7);

    const prGets = calls.filter((c) => c.method === 'GET' && c.url.endsWith('/pulls/7'));
    expect(prGets).toHaveLength(1);
  });

  it('falls back to a conversation (issue) comment when inline placement fails', async () => {
    const calls = installFetch((url) => {
      if (url.endsWith('/pulls/7'))
        return { ok: true, status: 200, json: { head: { sha: 'abc123' } } };
      if (url.endsWith('/pulls/7/comments')) return { ok: false, status: 422 }; // line not in diff
      if (url.endsWith('/issues/7/comments')) return { ok: true, status: 201 };
      return { ok: false, status: 404 };
    });

    await new GitHubCommenter(opts).postFindingComment(makeFinding(), 7);

    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/pulls/7/comments'))).toBe(
      true,
    );
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/issues/7/comments'))).toBe(
      true,
    );
  });

  it('includes pass and findingId metadata in the comment body', async () => {
    const calls = installFetch((url) => {
      if (url.endsWith('/pulls/7'))
        return { ok: true, status: 200, json: { head: { sha: 'abc123' } } };
      if (url.endsWith('/pulls/7/comments')) return { ok: true, status: 201 };
      return { ok: false, status: 404 };
    });

    await new GitHubCommenter(opts).postFindingComment(makeFinding({ pass: 'integration' }), 7);

    const body = calls.find((c) => c.url.endsWith('/pulls/7/comments'))?.body?.['body'] as string;
    expect(body).toContain('eh-metadata:');
    expect(body).toContain('findingId=EH-1');
    expect(body).toContain('pass=integration');
    expect(body).toContain('🔗 Cross-file issue');
  });
});
