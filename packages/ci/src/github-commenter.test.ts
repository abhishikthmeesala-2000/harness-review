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

const emptyDelta = { newFindings: [], outstandingFindings: [], resolvedFindings: [] };

describe('GitHubCommenter.postReviewSummary (upsert)', () => {
  it('POSTs a new comment when no existing summary is found', async () => {
    const calls = installFetch((url, method) => {
      if (method === 'GET' && url.includes('/issues/7/comments'))
        return { ok: true, status: 200, json: [] };
      if (method === 'POST' && url.endsWith('/issues/7/comments')) return { ok: true, status: 201 };
      return { ok: false, status: 404 };
    });

    await new GitHubCommenter(opts).postReviewSummary(7, emptyDelta);

    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/issues/7/comments'))).toBe(true);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('PATCHes the existing comment when the marker is found', async () => {
    const calls = installFetch((url, method) => {
      if (method === 'GET' && url.includes('/issues/7/comments'))
        return {
          ok: true,
          status: 200,
          json: [{ id: 999, body: '<!-- eh-summary -->\nold content' }],
        };
      if (method === 'PATCH' && url.endsWith('/issues/comments/999'))
        return { ok: true, status: 200 };
      return { ok: false, status: 404 };
    });

    await new GitHubCommenter(opts).postReviewSummary(7, emptyDelta);

    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toMatch(/\/issues\/comments\/999$/);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('PATCHed body still contains SUMMARY_MARKER', async () => {
    const calls = installFetch((url, method) => {
      if (method === 'GET' && url.includes('/issues/7/comments'))
        return {
          ok: true,
          status: 200,
          json: [{ id: 999, body: '<!-- eh-summary -->\nold content' }],
        };
      if (method === 'PATCH' && url.endsWith('/issues/comments/999'))
        return { ok: true, status: 200 };
      return { ok: false, status: 404 };
    });

    await new GitHubCommenter(opts).postReviewSummary(7, emptyDelta);

    const patchBody = calls.find((c) => c.method === 'PATCH')?.body?.['body'] as string;
    expect(patchBody).toContain('<!-- eh-summary -->');
  });

  it('falls back to POST when the GET for existing comments fails', async () => {
    const calls = installFetch((url, method) => {
      if (method === 'GET' && url.includes('/issues/7/comments'))
        return { ok: false, status: 500 };
      if (method === 'POST' && url.endsWith('/issues/7/comments')) return { ok: true, status: 201 };
      return { ok: false, status: 404 };
    });

    await new GitHubCommenter(opts).postReviewSummary(7, emptyDelta);

    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/issues/7/comments'))).toBe(true);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
});

describe('GitHubCommenter.formatReviewSummary', () => {
  it('always embeds SUMMARY_MARKER as the first line', () => {
    const commenter = new GitHubCommenter(opts);
    const body = commenter.formatReviewSummary(emptyDelta);
    expect(body.startsWith('<!-- eh-summary -->')).toBe(true);
  });
});

describe('GitHubCommenter.formatReviewSummary (rendering)', () => {
  const commenter = new GitHubCommenter(opts);

  it('all-clear: shows clean message when all lists are empty', () => {
    const body = commenter.formatReviewSummary(emptyDelta);
    expect(body).toContain('No issues found');
    expect(body).toContain('ready to merge');
    expect(body).not.toContain('New Issues');
    expect(body).not.toContain('Outstanding');
    expect(body).not.toContain('Resolved This Run');
  });

  it('new-only: shows new findings section only', () => {
    const delta = { newFindings: [makeFinding()], outstandingFindings: [], resolvedFindings: [] };
    const body = commenter.formatReviewSummary(delta);
    expect(body).toContain('New Issues');
    expect(body).toContain('SQL injection in deleteUser');
    expect(body).not.toContain('Outstanding');
    expect(body).not.toContain('Resolved This Run');
    expect(body).not.toContain('No issues found');
  });

  it('outstanding-only: shows outstanding section only', () => {
    const delta = { newFindings: [], outstandingFindings: [makeFinding()], resolvedFindings: [] };
    const body = commenter.formatReviewSummary(delta);
    expect(body).toContain('Outstanding');
    expect(body).toContain('SQL injection in deleteUser');
    expect(body).not.toContain('New Issues');
    expect(body).not.toContain('Resolved This Run');
    expect(body).not.toContain('No issues found');
  });

  it('resolved-only: shows resolved section only', () => {
    const delta = {
      newFindings: [],
      outstandingFindings: [],
      resolvedFindings: [{ finding: makeFinding() }],
    };
    const body = commenter.formatReviewSummary(delta);
    expect(body).toContain('Resolved This Run');
    expect(body).toContain('SQL injection in deleteUser');
    expect(body).not.toContain('New Issues');
    expect(body).not.toContain('Outstanding');
    expect(body).not.toContain('No issues found');
  });

  it('mixed: renders new → outstanding → resolved in that order', () => {
    const delta = {
      newFindings: [makeFinding({ id: 'EH-1', title: 'New bug' })],
      outstandingFindings: [makeFinding({ id: 'EH-2', title: 'Old bug' })],
      resolvedFindings: [{ finding: makeFinding({ id: 'EH-3', title: 'Fixed bug' }) }],
    };
    const body = commenter.formatReviewSummary(delta);
    expect(body).toContain('New Issues');
    expect(body).toContain('New bug');
    expect(body).toContain('Outstanding');
    expect(body).toContain('Old bug');
    expect(body).toContain('Resolved This Run');
    expect(body).toContain('Fixed bug');
    expect(body.indexOf('New Issues')).toBeLessThan(body.indexOf('Outstanding'));
    expect(body.indexOf('Outstanding')).toBeLessThan(body.indexOf('Resolved This Run'));
    expect(body).not.toContain('No issues found');
  });
});
