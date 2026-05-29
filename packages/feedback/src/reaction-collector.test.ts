import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReactionCollector } from './reaction-collector.js';

function ehBody(findingId: string): string {
  return `🔴 **[HIGH] Something**\n\n<!-- eh-metadata: findingId=${findingId} runId=R-1 sourceAgent=security severity=high -->`;
}

/** Route GET requests by URL to canned JSON. */
function installFetch(routes: Record<string, unknown>): void {
  vi.stubGlobal('fetch', async (url: string) => {
    // find the first route key that the url ends with / contains
    const key = Object.keys(routes).find((k) => url.includes(k));
    const data = key ? routes[key] : [];
    return { ok: true, status: 200, json: async () => data } as Response;
  });
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('ReactionCollector — inline + conversation comments', () => {
  it('collects feedback from BOTH issue comments and pull review comments', async () => {
    installFetch({
      '/issues/9/comments': [{ id: 100, body: ehBody('EH-CONV') }],
      '/pulls/9/comments': [{ id: 200, body: ehBody('EH-INLINE') }],
      '/issues/comments/100/reactions': [{ content: '+1' }],
      '/pulls/comments/200/reactions': [{ content: '-1' }],
    });

    const collector = new ReactionCollector({ token: 't', owner: 'acme', repo: 'app' });
    const result = await collector.collectFromSinglePR(9);

    const byId = Object.fromEntries(result.collected.map((i) => [i.findingId, i]));
    expect(byId['EH-CONV']?.state).toBe('accepted');
    expect(byId['EH-CONV']?.commentId).toBe(100);
    expect(byId['EH-INLINE']?.state).toBe('false_positive');
    expect(byId['EH-INLINE']?.commentId).toBe(200);
    expect(result.collected).toHaveLength(2);
  });

  it('still works when there are no inline review comments', async () => {
    installFetch({
      '/issues/9/comments': [{ id: 100, body: ehBody('EH-CONV') }],
      '/pulls/9/comments': [],
      '/issues/comments/100/reactions': [{ content: 'rocket' }],
    });

    const collector = new ReactionCollector({ token: 't', owner: 'acme', repo: 'app' });
    const result = await collector.collectFromSinglePR(9);

    expect(result.collected).toHaveLength(1);
    expect(result.collected[0]!.findingId).toBe('EH-CONV');
    expect(result.collected[0]!.state).toBe('fixed');
  });

  it('ignores comments without eh-metadata', async () => {
    installFetch({
      '/issues/9/comments': [{ id: 1, body: 'just a normal comment' }],
      '/pulls/9/comments': [{ id: 2, body: 'LGTM' }],
    });

    const collector = new ReactionCollector({ token: 't', owner: 'acme', repo: 'app' });
    const result = await collector.collectFromSinglePR(9);

    expect(result.collected).toHaveLength(0);
  });
});
