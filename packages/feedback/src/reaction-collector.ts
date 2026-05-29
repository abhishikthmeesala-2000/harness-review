import type { CollectionResult, FeedbackItem, FeedbackState, ReactionCounts } from './types.js';

interface GitHubComment {
  id: number;
  body: string;
}

interface GitHubReaction {
  content: string;
}

interface GitHubPull {
  number: number;
  updated_at: string;
}

export interface ReactionCollectorOptions {
  token: string;
  owner: string;
  repo: string;
}

export class ReactionCollector {
  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly base: string;

  constructor(options: ReactionCollectorOptions) {
    this.token = options.token;
    this.owner = options.owner;
    this.repo = options.repo;
    this.base = `https://api.github.com/repos/${options.owner}/${options.repo}`;
  }

  async collect(days: number): Promise<CollectionResult> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const prNumbers = await this.getRecentPRs(since);
    return this.collectFromPRs(prNumbers);
  }

  async collectFromSinglePR(prNumber: number): Promise<CollectionResult> {
    return this.collectFromPRs([prNumber]);
  }

  private async collectFromPRs(prNumbers: number[]): Promise<CollectionResult> {
    const items: FeedbackItem[] = [];

    for (const prNum of prNumbers) {
      let comments: GitHubComment[];
      try {
        comments = await this.ghFetch<GitHubComment[]>(
          `${this.base}/issues/${prNum}/comments?per_page=100`,
        );
      } catch (err) {
        console.warn(`  [warn] PR #${prNum}: failed to fetch comments — ${String(err)}`);
        continue;
      }

      const ehComments = comments.filter((c) => this.isEhComment(c));

      for (const comment of ehComments) {
        const metadata = this.extractMetadata(comment.body);
        if (!metadata) continue;

        const findingId = metadata['findingId'];
        const runId = metadata['runId'];
        if (!findingId || !runId) continue;

        let reactions: GitHubReaction[];
        try {
          reactions = await this.ghFetch<GitHubReaction[]>(
            `${this.base}/issues/comments/${comment.id}/reactions`,
          );
        } catch (err) {
          console.warn(
            `  [warn] comment ${comment.id} (${findingId}): failed to fetch reactions — ${String(err)}`,
          );
          continue;
        }

        const counts = this.countReactions(reactions);
        const state = this.mapReactionsToState(counts);
        if (state === 'ignored') continue;

        items.push({
          findingId,
          runId,
          state,
          prNumber: prNum,
          repository: `${this.owner}/${this.repo}`,
          commentId: comment.id,
          reactions: counts,
          timestamp: new Date().toISOString(),
          metadata: {
            sourceAgent: metadata['sourceAgent'],
            dimension: metadata['dimension'],
            severity: metadata['severity'],
          },
        });
      }
    }

    return { collected: items, prNumbers };
  }

  private extractMetadata(body: string): Record<string, string> | null {
    const match = body.match(/<!--\s*eh-metadata:\s*(.+?)\s*-->/);
    if (!match?.[1]) return null;

    const metadata: Record<string, string> = {};
    const pairs = match[1].match(/(\w+)=([^\s]+)/g);
    if (!pairs) return null;

    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx < 0) continue;
      metadata[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
    }

    return Object.keys(metadata).length > 0 ? metadata : null;
  }

  private isEhComment(comment: GitHubComment): boolean {
    return comment.body.includes('<!-- eh-metadata:');
  }

  private countReactions(reactions: GitHubReaction[]): ReactionCounts {
    const counts: ReactionCounts = {
      '+1': 0,
      '-1': 0,
      laugh: 0,
      confused: 0,
      heart: 0,
      hooray: 0,
      rocket: 0,
      eyes: 0,
    };
    for (const r of reactions) {
      const key = r.content as keyof ReactionCounts;
      if (key in counts) {
        counts[key]++;
      }
    }
    return counts;
  }

  private mapReactionsToState(reactions: ReactionCounts): FeedbackState {
    if (reactions['-1'] > 0) return 'false_positive';
    if (reactions['+1'] > 0) return 'accepted';
    if (reactions['rocket'] > 0 || reactions['hooray'] > 0) return 'fixed';
    if (reactions['confused'] > 0) return 'dismissed';
    if (reactions['eyes'] > 0) return 'acknowledged';
    return 'ignored';
  }

  private async getRecentPRs(since: Date): Promise<number[]> {
    const pulls = await this.ghFetch<GitHubPull[]>(
      `${this.base}/pulls?state=all&sort=updated&direction=desc&per_page=100`,
    );
    return pulls.filter((pr) => new Date(pr.updated_at) >= since).map((pr) => pr.number);
  }

  private async ghFetch<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub API error ${res.status} for ${url}`);
    }
    return res.json() as Promise<T>;
  }
}
