import type { AlmAdapter, PrRef } from './interface.js';

export class GitHubAlm implements AlmAdapter {
  readonly platform = 'github';

  // Uses GITHUB_TOKEN env var. All methods are NO-OPs unless config.ci.postComments === true.
  // Calls GitHub REST API v3 via native fetch.
  // Never log the token. Wrap all calls in try/catch — never fail the build because of ALM errors.

  async postSummary(prRef: PrRef, markdown: string): Promise<void> {
    const token = process.env['GITHUB_TOKEN'];
    if (!token) return; // silently no-op if no token
    const url = `https://api.github.com/repos/${prRef.owner}/${prRef.repo}/issues/${prRef.pullNumber}/comments`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ body: markdown }),
      });
    } catch {
      /* never fail the build */
    }
  }

  async postInlineComment(
    prRef: PrRef,
    commitSha: string,
    file: string,
    line: number,
    body: string,
  ): Promise<void> {
    const token = process.env['GITHUB_TOKEN'];
    if (!token) return;
    const url = `https://api.github.com/repos/${prRef.owner}/${prRef.repo}/pulls/${prRef.pullNumber}/comments`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ body, commit_id: commitSha, path: file, line, side: 'RIGHT' }),
      });
    } catch {
      /* never fail the build */
    }
  }

  async updateCheckStatus(
    _prRef: PrRef,
    _status: 'success' | 'failure' | 'pending',
    _summary: string,
  ): Promise<void> {
    // requires checks:write permission — silently no-op in default config
  }
}
