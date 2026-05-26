import type { Finding } from '@engagement-harness/core';

export interface GitHubCommenterOptions {
  token: string;
  owner: string;
  repo: string;
  runId: string;
}

export class GitHubCommenter {
  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly runId: string;
  private readonly base: string;

  constructor(options: GitHubCommenterOptions) {
    this.token = options.token;
    this.owner = options.owner;
    this.repo = options.repo;
    this.runId = options.runId;
    this.base = `https://api.github.com/repos/${options.owner}/${options.repo}`;
  }

  async postFindings(findings: Finding[], prNumber: number): Promise<void> {
    for (const finding of findings) {
      const body = this.formatComment(finding);
      await this.postComment(prNumber, body);
    }
  }

  formatComment(finding: Finding): string {
    const parts: string[] = [
      `findingId=${finding.id}`,
      `runId=${this.runId}`,
      `sourceAgent=${finding.sourceAgent}`,
      `dimension=${finding.dimension}`,
      `severity=${finding.severity}`,
    ];
    const metadataTag = `<!-- eh-metadata: ${parts.join(' ')} -->`;

    const pct =
      finding.confidence !== undefined
        ? ` · confidence: ${Math.round(finding.confidence * 100)}%`
        : '';

    return [
      metadataTag,
      '',
      `### [${finding.severity.toUpperCase()}] ${finding.title}`,
      '',
      `**Why it matters:** ${finding.whyItMatters}`,
      '',
      `**Suggested fix:**`,
      finding.suggestedFix,
      '',
      `---`,
      `*Engagement Harness · agent: \`${finding.sourceAgent}\`${pct}*`,
      '',
      `---`,
      `**React to provide feedback:**  `,
      `👍 Accepted (will fix) | 👎 False positive | 🚀 Already fixed | 😕 Dismissed`,
    ].join('\n');
  }

  private async postComment(prNumber: number, body: string): Promise<void> {
    const res = await fetch(`${this.base}/issues/${prNumber}/comments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      throw new Error(`Failed to post comment for finding: ${res.status}`);
    }
  }
}
