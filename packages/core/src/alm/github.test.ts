import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubAlm } from './github.js';

const PR_REF = { owner: 'acme', repo: 'backend', pullNumber: 42 };
const TOKEN = 'ghp_test_token';

describe('GitHubAlm', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);
    process.env['GITHUB_TOKEN'] = TOKEN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['GITHUB_TOKEN'];
  });

  describe('postInlineComment', () => {
    it('POSTs to pulls/{n}/comments with correct fields', async () => {
      const alm = new GitHubAlm();
      await alm.postInlineComment(PR_REF, 'abc123sha', 'src/auth.ts', 47, '**[HIGH] Unsafe eval**');

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

      expect(url).toBe('https://api.github.com/repos/acme/backend/pulls/42/comments');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/vnd.github+json',
      });

      const body = JSON.parse(init.body as string);
      expect(body).toEqual({
        body: '**[HIGH] Unsafe eval**',
        commit_id: 'abc123sha',
        path: 'src/auth.ts',
        line: 47,
        side: 'RIGHT',
      });
    });

    it('no-ops silently when GITHUB_TOKEN missing', async () => {
      delete process.env['GITHUB_TOKEN'];
      const alm = new GitHubAlm();
      await alm.postInlineComment(PR_REF, 'abc123', 'src/auth.ts', 10, 'body');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('swallows fetch errors without throwing', async () => {
      fetchMock.mockRejectedValue(new Error('network failure'));
      const alm = new GitHubAlm();
      await expect(
        alm.postInlineComment(PR_REF, 'abc123', 'src/auth.ts', 10, 'body'),
      ).resolves.toBeUndefined();
    });
  });

  describe('postSummary', () => {
    it('POSTs to issues/{n}/comments', async () => {
      const alm = new GitHubAlm();
      await alm.postSummary(PR_REF, '## Summary\nAll good.');

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.github.com/repos/acme/backend/issues/42/comments');
      const body = JSON.parse(init.body as string);
      expect(body.body).toBe('## Summary\nAll good.');
    });
  });
});
