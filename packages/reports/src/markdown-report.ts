import type { Finding } from '@engagement-harness/core';
import type { PipelineResult } from '@engagement-harness/pipeline';

import type { RunMetadata } from './types.js';

// Local shape — mirrors RemediationOutput from @engagement-harness/agents
// without creating a cross-package dependency in reports.
interface RemediationOutputLike {
  findingId: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  before: string;
  after: string;
  explanation: string;
  test: string;
  riskLevel: 'low' | 'medium' | 'high';
  effort: 'minutes' | 'hours' | 'days';
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const SEVERITY_BADGE: Record<string, string> = {
  critical: '🔴 **CRITICAL**',
  high: '🟠 **HIGH**',
  medium: '🟡 **MEDIUM**',
  low: '🔵 **LOW**',
};

const DECISION_LABEL: Record<string, string> = {
  approved: '✅ Approved',
  approved_with_warnings: '⚠️ Approved with Warnings',
  needs_manual_review: '👀 Needs Manual Review',
  blocked_by_policy: '🚫 Blocked by Policy',
};

export const MarkdownReport = {
  generate(
    result: PipelineResult,
    meta: RunMetadata,
    remediations?: Record<string, RemediationOutputLike>,
  ): string {
    const lines: string[] = [];
    const { published, decision, overallConfidence, metrics } = result;

    lines.push('# Engagement Harness Review');
    lines.push('');
    lines.push(`**Decision:** ${DECISION_LABEL[decision] ?? decision}  `);
    lines.push(`**Overall Confidence:** ${Math.round(overallConfidence * 100)}%`);
    lines.push('');

    lines.push('## Summary');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Decision | ${DECISION_LABEL[decision] ?? decision} |`);
    lines.push(`| Overall Confidence | ${Math.round(overallConfidence * 100)}% |`);
    lines.push(`| Published Findings | ${metrics.publishedCount} |`);
    lines.push(`| Total Candidates | ${metrics.totalCandidates} |`);
    lines.push('');

    lines.push('## Findings by Dimension');
    lines.push('');
    if (published.length === 0) {
      lines.push('_No findings published._');
      lines.push('');
    } else {
      const byDimension = groupByDimension(published);
      for (const [dim, findings] of byDimension) {
        lines.push(`### ${dim}`);
        lines.push('');
        const sorted = [...findings].sort(
          (a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99),
        );
        for (const f of sorted) {
          lines.push(`#### ${f.title}`);
          lines.push('');
          lines.push(`**Location:** \`${f.file}:${f.lineStart}–${f.lineEnd}\`  `);
          lines.push(`**Severity:** ${SEVERITY_BADGE[f.severity] ?? f.severity}  `);
          lines.push(`**Confidence:** ${Math.round(f.confidence * 100)}%`);
          lines.push('');
          if (f.evidence.length > 0) {
            lines.push('<details><summary>Evidence</summary>');
            lines.push('');
            for (const ev of f.evidence) {
              lines.push(`> [${ev.type}] ${ev.content}`);
              lines.push('');
            }
            lines.push('</details>');
            lines.push('');
          }
          lines.push(`**Why it matters:** ${f.whyItMatters}`);
          lines.push('');
          lines.push(`**Suggested fix:** ${f.suggestedFix}`);
          lines.push('');
          lines.push('---');
          lines.push('');
        }
      }
    }

    if (remediations && Object.keys(remediations).length > 0) {
      lines.push('## Fixes');
      lines.push('');
      for (const output of Object.values(remediations)) {
        const riskEmoji =
          output.riskLevel === 'low' ? '🟢' : output.riskLevel === 'medium' ? '🟡' : '🔴';
        const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
        lines.push(`### 🔧 Fix for ${output.findingId}`);
        lines.push('');
        lines.push(
          `**Risk:** ${riskEmoji} ${capitalise(output.riskLevel)} · **Effort:** ⏱ ${capitalise(output.effort)}`,
        );
        lines.push('');
        lines.push(`**File:** \`${output.file}:${output.lineStart}–${output.lineEnd}\``);
        lines.push('');
        lines.push('**Before:**');
        lines.push('```diff');
        for (const line of output.before.split('\n')) {
          lines.push(`- ${line}`);
        }
        lines.push('```');
        lines.push('');
        lines.push('**After:**');
        lines.push('```diff');
        for (const line of output.after.split('\n')) {
          lines.push(`+ ${line}`);
        }
        lines.push('```');
        lines.push('');
        lines.push(`**Explanation:** ${output.explanation}`);
        lines.push('');
        lines.push('**Test to add:**');
        lines.push('```typescript');
        lines.push(output.test);
        lines.push('```');
        lines.push('');
        lines.push('---');
        lines.push('');
      }
    }

    lines.push('## Quality Summary');
    lines.push('');
    lines.push('### Rejected by Stage');
    lines.push('');
    lines.push('| Stage | Count |');
    lines.push('|-------|-------|');
    const stages = Object.entries(metrics.rejectedByStage);
    if (stages.length === 0) {
      lines.push('| — | — |');
    } else {
      for (const [stage, count] of stages) {
        lines.push(`| ${stage} | ${count} |`);
      }
    }
    lines.push('');

    lines.push('### Evidence Distribution');
    lines.push('');
    lines.push('| Level | Count |');
    lines.push('|-------|-------|');
    for (const [level, count] of Object.entries(metrics.evidenceDistribution)) {
      lines.push(`| ${level} | ${count} |`);
    }
    lines.push('');

    lines.push('## Run Metadata');
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('|-------|-------|');
    lines.push(`| Run ID | \`${meta.runId}\` |`);
    lines.push(`| Timestamp | ${meta.timestamp} |`);
    lines.push(`| Base Ref | \`${meta.baseRef}\` |`);
    lines.push(`| Head Ref | \`${meta.headRef}\` |`);
    lines.push(`| Agents | ${meta.agentsRun.join(', ') || '—'} |`);
    lines.push(`| Providers | ${meta.providersUsed.join(', ') || '—'} |`);
    lines.push('');

    return lines.join('\n');
  },
};

function groupByDimension(findings: Finding[]): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>();
  for (const f of findings) {
    const arr = map.get(f.dimension) ?? [];
    arr.push(f);
    map.set(f.dimension, arr);
  }
  return map;
}
