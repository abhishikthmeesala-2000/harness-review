import type { Finding } from '@engagement-harness/core';

export interface GitHubCommenterOptions {
  token: string;
  owner: string;
  repo: string;
  runId: string;
}

/**
 * Structurally compatible with the pipeline's DeltaResult. Declared locally so
 * the ci package need not depend on the pipeline package.
 */
export interface ReviewDelta {
  newFindings: Finding[];
  outstandingFindings: Finding[];
  resolvedFindings: Array<{ finding: Finding }>;
}

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
};

function severityEmoji(severity: string): string {
  return SEVERITY_EMOJI[severity] ?? '⚪';
}

export class GitHubCommenter {
  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly runId: string;
  private readonly base: string;
  /** Cached PR head SHA, resolved lazily and reused across findings in one run. */
  private headSha: string | null = null;

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
    const parts = [
      `findingId=${finding.id}`,
      `runId=${this.runId}`,
      `sourceAgent=${finding.sourceAgent}`,
      ...(finding.dimension ? [`dimension=${finding.dimension}`] : []),
      `severity=${finding.severity}`,
    ];

    const pct =
      finding.confidence !== undefined
        ? ` · confidence: ${Math.round(finding.confidence * 100)}%`
        : '';

    return [
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
      '',
      `<!-- eh-metadata: ${parts.join(' ')} -->`,
    ].join('\n');
  }

  /**
   * Post a single finding as a true inline review comment so it appears on the
   * line in the PR's "Files changed" tab. Falls back to a conversation comment
   * when the line can't be commented on inline (e.g. not part of the diff), so a
   * finding — and its reaction-based feedback — is never silently dropped.
   */
  async postFindingComment(finding: Finding, prNumber: number): Promise<void> {
    const body = this.formatFindingComment(finding);
    try {
      const commitId = await this.resolveCommitId(prNumber);
      await this.postReviewComment(prNumber, finding, commitId, body);
    } catch {
      // Inline placement failed — fall back to a conversation comment.
      await this.postComment(prNumber, body);
    }
  }

  /** Resolve (and cache) the PR head commit SHA that inline comments attach to. */
  private async resolveCommitId(prNumber: number): Promise<string> {
    if (this.headSha) return this.headSha;
    const res = await fetch(`${this.base}/pulls/${prNumber}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to resolve PR head SHA: ${res.status}`);
    }
    const pr = (await res.json()) as { head?: { sha?: string } };
    const sha = pr.head?.sha;
    if (!sha) {
      throw new Error('PR response missing head.sha');
    }
    this.headSha = sha;
    return sha;
  }

  /** POST an inline review comment via the pulls API. Throws on non-2xx. */
  private async postReviewComment(
    prNumber: number,
    finding: Finding,
    commitId: string,
    body: string,
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      body,
      commit_id: commitId,
      path: finding.file,
      line: finding.lineEnd,
      side: 'RIGHT',
    };
    // Multi-line span: anchor the comment from lineStart to lineEnd.
    if (finding.lineEnd > finding.lineStart) {
      payload['start_line'] = finding.lineStart;
      payload['start_side'] = 'RIGHT';
    }
    const res = await fetch(`${this.base}/pulls/${prNumber}/comments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Failed to post inline review comment: ${res.status}`);
    }
  }

  formatFindingComment(finding: Finding): string {
    const meta = [
      `findingId=${finding.id}`,
      `runId=${this.runId}`,
      `sourceAgent=${finding.sourceAgent}`,
      `severity=${finding.severity}`,
      `pass=${finding.pass ?? 'local'}`,
    ];

    const emoji = severityEmoji(finding.severity);
    const scope = finding.pass === 'integration' ? '🔗 Cross-file issue' : '📄 Local issue';
    const evidence = finding.evidence.map((e) => e.content).join('\n');

    return [
      `${emoji} **[${finding.severity.toUpperCase()}] ${finding.title}**`,
      '',
      scope,
      '',
      `**What's wrong:** ${finding.whyItMatters}`,
      '',
      '**Evidence:**',
      '```',
      evidence,
      '```',
      '',
      '**Suggested fix:**',
      '```',
      finding.suggestedFix,
      '```',
      '',
      '---',
      '**React:** 👍 Valid | 👎 False positive | 🚀 Fixed | 😕 Dismissed',
      '',
      `<!-- eh-metadata: ${meta.join(' ')} -->`,
    ].join('\n');
  }

  /** Post one summary comment reflecting the current re-review state of the PR. */
  async postReviewSummary(prNumber: number, delta: ReviewDelta): Promise<void> {
    await this.postComment(prNumber, this.formatReviewSummary(delta));
  }

  formatReviewSummary(delta: ReviewDelta): string {
    const lines: string[] = ['## 🔍 Engagement Harness Re-Review', ''];

    if (delta.resolvedFindings.length > 0) {
      lines.push(`### ✅ Resolved (${delta.resolvedFindings.length})`, '');
      for (const { finding } of delta.resolvedFindings) {
        lines.push(`- ~~${finding.title}~~ ✅`);
      }
      lines.push('');
    }

    if (delta.outstandingFindings.length > 0) {
      lines.push(
        `### ⚠️ Still Outstanding (${delta.outstandingFindings.length}) — please fix before merging`,
        '',
      );
      for (const f of delta.outstandingFindings) {
        lines.push(
          `- ${severityEmoji(f.severity)} [${f.severity.toUpperCase()}] ${f.title} — \`${f.file}:${f.lineStart}\``,
        );
      }
      lines.push('');
    }

    if (delta.newFindings.length > 0) {
      lines.push(`### 🆕 New Issues (${delta.newFindings.length})`, '');
      for (const f of delta.newFindings) {
        lines.push(
          `- ${severityEmoji(f.severity)} [${f.severity.toUpperCase()}] ${f.title} — \`${f.file}:${f.lineStart}\``,
        );
      }
      lines.push('');
    }

    if (delta.outstandingFindings.length === 0 && delta.newFindings.length === 0) {
      lines.push(
        '### 🎉 All Issues Resolved!',
        '',
        'No outstanding or new issues found. Ready to merge.',
        '',
      );
    }

    return lines.join('\n').trimEnd();
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
