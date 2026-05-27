import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FeedbackMetrics } from './types.js';

export class ClaudeMemoryExporter {
  export(metrics: FeedbackMetrics, memoryDir: string): void {
    if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });

    const stateLines = Object.entries(metrics.byState)
      .filter(([, n]) => (n ?? 0) > 0)
      .map(([s, n]) => `- ${s}: ${n}`)
      .join('\n');

    const agentLines = Object.entries(metrics.byAgent)
      .map(
        ([agent, m]) =>
          `- ${agent}: ${m.totalFindings} findings, acceptance: ${(m.acceptanceRate * 100).toFixed(0)}%, fp: ${(m.falsePositiveRate * 100).toFixed(0)}%`,
      )
      .join('\n');

    const fpCount = metrics.byState.false_positive ?? 0;
    const acceptedCount = metrics.byState.accepted ?? 0;
    const fpNote =
      fpCount > acceptedCount
        ? '\n**Signal:** false_positive > accepted — consider tightening confidence/severity thresholds in config.'
        : '';

    const body = `---
name: feedback-pr-reactions-summary
description: Aggregate feedback from GitHub PR comment reactions — acceptance/rejection patterns for engagement-harness findings
metadata:
  type: project
---

Last collected: ${metrics.lastUpdated}

Cumulative totals (${metrics.totalEntries} entries):
${stateLines || '- (none yet)'}${fpNote}

By agent:
${agentLines || '- (no agent data yet)'}

**Why:** Collected automatically from GitHub PR comment reactions (👍=accepted, 👎=false_positive, 🚀=fixed, 😕=dismissed).
**How to apply:** High false_positive rate signals overly permissive quality gate — tune \`review.confidenceThreshold\` or \`review.severityThreshold\` in \`.engagement-harness/config.json\`.
`;

    writeFileSync(join(memoryDir, 'feedback_pr_reactions.md'), body, 'utf8');
  }
}
