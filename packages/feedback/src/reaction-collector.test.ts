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

/**
 * More expressive mock: each route is a function (url) => data, checked in order.
 * Useful when tests need to vary responses by page number or query param.
 */
function installFetchFn(routes: Array<{ match: (url: string) => boolean; data: unknown }>): void {
  vi.stubGlobal('fetch', async (url: string) => {
    const route = routes.find((r) => r.match(url));
    const data = route ? route.data : [];
    return { ok: true, status: 200, json: async () => data } as Response;
  });
}

describe('ReactionCollector — outdated/resolved thread coverage', () => {
  it('captures reactions on outdated review threads via state=all', async () => {
    // Simulates: 5 findings posted, fixes pushed (comments become outdated), 2 new findings added.
    // The pulls endpoint with state=all must return all 5 outdated comments + (potentially) 2 active ones.
    // Issue comments carry the 2 new findings; pulls endpoint carries the 5 old ones.
    installFetch({
      '/issues/9/comments': [
        { id: 300, body: ehBody('EH-NEW-1') },
        { id: 301, body: ehBody('EH-NEW-2') },
      ],
      '/pulls/9/comments': [
        { id: 100, body: ehBody('EH-OLD-1') },
        { id: 101, body: ehBody('EH-OLD-2') },
        { id: 102, body: ehBody('EH-OLD-3') },
        { id: 103, body: ehBody('EH-OLD-4') },
        { id: 104, body: ehBody('EH-OLD-5') },
      ],
      '/issues/comments/300/reactions': [{ content: '+1' }],
      '/issues/comments/301/reactions': [{ content: '+1' }],
      '/pulls/comments/100/reactions': [{ content: '+1' }],
      '/pulls/comments/101/reactions': [{ content: '-1' }],
      '/pulls/comments/102/reactions': [{ content: 'rocket' }],
      '/pulls/comments/103/reactions': [{ content: 'confused' }],
      '/pulls/comments/104/reactions': [{ content: 'eyes' }],
    });

    const collector = new ReactionCollector({ token: 't', owner: 'acme', repo: 'app' });
    const result = await collector.collectFromSinglePR(9);

    expect(result.collected).toHaveLength(7);
    const byId = Object.fromEntries(result.collected.map((i) => [i.findingId, i]));
    // All 5 outdated findings collected
    expect(byId['EH-OLD-1']?.state).toBe('accepted');
    expect(byId['EH-OLD-2']?.state).toBe('false_positive');
    expect(byId['EH-OLD-3']?.state).toBe('fixed');
    expect(byId['EH-OLD-4']?.state).toBe('dismissed');
    expect(byId['EH-OLD-5']?.state).toBe('acknowledged');
    // Both new findings collected
    expect(byId['EH-NEW-1']?.state).toBe('accepted');
    expect(byId['EH-NEW-2']?.state).toBe('accepted');
  });

  it('paginates past 100 review comments without losing any', async () => {
    // Page 1: 100 EH comments (triggers a second fetch); page 2: 1 EH comment.
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      body: ehBody(`EH-P1-${i + 1}`),
    }));
    const page2 = [{ id: 101, body: ehBody('EH-P2-1') }];

    let pullsCallCount = 0;
    installFetchFn([
      {
        match: (url) => url.includes('/pulls/9/comments'),
        get data() {
          pullsCallCount++;
          return pullsCallCount === 1 ? page1 : page2;
        },
      },
      { match: (url) => url.includes('/issues/9/comments'), data: [] },
      { match: (url) => url.includes('/reactions'), data: [{ content: '+1' }] },
    ]);

    const collector = new ReactionCollector({ token: 't', owner: 'acme', repo: 'app' });
    const result = await collector.collectFromSinglePR(9);

    expect(pullsCallCount).toBe(2);
    expect(result.collected).toHaveLength(101);
  });

  it('deduplicates comments with the same ID within a single endpoint', async () => {
    installFetch({
      '/issues/9/comments': [
        { id: 100, body: ehBody('EH-CONV') },
        { id: 100, body: ehBody('EH-CONV') }, // duplicate — must not yield two FeedbackItems
      ],
      '/pulls/9/comments': [],
      '/issues/comments/100/reactions': [{ content: '+1' }],
    });

    const collector = new ReactionCollector({ token: 't', owner: 'acme', repo: 'app' });
    const result = await collector.collectFromSinglePR(9);

    expect(result.collected).toHaveLength(1);
    expect(result.collected[0]?.findingId).toBe('EH-CONV');
  });
});

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
