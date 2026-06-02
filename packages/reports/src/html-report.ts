import type { Finding } from '@engagement-harness/core';
import type { PipelineResult } from '@engagement-harness/pipeline';

import type { RunMetadata } from './types.js';

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#2563eb',
};

const DECISION_LABEL: Record<string, string> = {
  approved: '✅ Approved',
  approved_with_warnings: '⚠️ Approved with Warnings',
  needs_manual_review: '👀 Needs Manual Review',
  blocked_by_policy: '🚫 Blocked by Policy',
};

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function severityBadge(severity: string): string {
  const color = SEVERITY_COLOR[severity] ?? '#64748b';
  return `<span style="color:${color};font-weight:bold">${esc(severity.toUpperCase())}</span>`;
}

function renderFinding(f: Finding): string {
  const color = SEVERITY_COLOR[f.severity] ?? '#64748b';
  const conf = Math.round(f.confidence * 100);
  const evidenceHtml = f.evidence
    .map(
      (ev) =>
        `<details style="margin-left:1rem"><summary style="cursor:pointer">[${esc(ev.type)}] evidence</summary><pre>${esc(ev.content)}</pre></details>`,
    )
    .join('\n');
  return `
    <div style="border-left:4px solid ${color};padding:0.75rem 1rem;margin-bottom:1rem;background:#f8fafc">
      <strong>${esc(f.title)}</strong>
      <div style="margin:0.25rem 0;font-size:0.875rem">
        <code>${esc(f.file)}:${f.lineStart}–${f.lineEnd}</code> &nbsp;
        ${severityBadge(f.severity)} &nbsp;
        <span>Confidence: ${conf}%</span>
      </div>
      ${evidenceHtml}
      <p><strong>Why it matters:</strong> ${esc(f.whyItMatters)}</p>
      <p><strong>Suggested fix:</strong> ${esc(f.suggestedFix)}</p>
    </div>`;
}

export const HtmlReport = {
  generate(result: PipelineResult, meta: RunMetadata): string {
    const { published, rejected, decision, overallConfidence, metrics } = result;

    const byDimension = new Map<string, Finding[]>();
    for (const f of published) {
      const arr = byDimension.get(f.dimension) ?? [];
      arr.push(f);
      byDimension.set(f.dimension, arr);
    }

    const dimensionsHtml = [...byDimension.entries()]
      .map(([dim, findings]) => {
        const sorted = [...findings].sort(
          (a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99),
        );
        return `
    <details open>
      <summary style="cursor:pointer;font-size:1.125rem;font-weight:600;padding:0.5rem 0">${esc(dim)}</summary>
      ${sorted.map(renderFinding).join('\n')}
    </details>`;
      })
      .join('\n');

    const stageRows = Object.entries(metrics.rejectedByStage)
      .map(([s, c]) => `<tr><td>${esc(s)}</td><td>${c}</td></tr>`)
      .join('\n');

    const evidenceRows = Object.entries(metrics.evidenceDistribution)
      .map(([l, c]) => `<tr><td>${esc(l)}</td><td>${c}</td></tr>`)
      .join('\n');

    const decisionLabel = DECISION_LABEL[decision] ?? decision;
    const confPct = Math.round(overallConfidence * 100);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Engagement Harness Review — ${esc(meta.runId)}</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:1.5rem;color:#1e293b}
    h1{font-size:1.75rem;margin-bottom:0.25rem}
    h2{font-size:1.25rem;margin-top:2rem;border-bottom:1px solid #e2e8f0;padding-bottom:0.25rem}
    table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #e2e8f0;padding:0.5rem 0.75rem;text-align:left}
    th{background:#f8fafc;font-weight:600}
    pre{background:#f1f5f9;padding:1rem;overflow-x:auto;border-radius:4px;font-size:0.875rem}
    code{background:#f1f5f9;padding:0.1em 0.3em;border-radius:3px;font-size:0.875rem}
    details{margin-bottom:0.5rem}
    summary{user-select:none}
  </style>
</head>
<body>
  <h1>Engagement Harness Review</h1>
  <p><strong>Decision:</strong> ${decisionLabel} &nbsp; <strong>Confidence:</strong> ${confPct}%</p>

  <h2>Summary</h2>
  <table>
    <tr><th>Metric</th><th>Value</th></tr>
    <tr><td>Decision</td><td>${decisionLabel}</td></tr>
    <tr><td>Overall Confidence</td><td>${confPct}%</td></tr>
    <tr><td>Published Findings</td><td>${metrics.publishedCount}</td></tr>
    <tr><td>Total Candidates</td><td>${metrics.totalCandidates}</td></tr>
  </table>

  <h2>Findings by Dimension</h2>
  ${published.length === 0 ? '<p><em>No findings published.</em></p>' : dimensionsHtml}

  <h2>Quality Summary</h2>
  <h3 style="font-size:1rem">Rejected by Stage</h3>
  <table>
    <tr><th>Stage</th><th>Count</th></tr>
    ${stageRows || '<tr><td colspan="2">—</td></tr>'}
  </table>
  <h3 style="font-size:1rem;margin-top:1rem">Evidence Distribution</h3>
  <table>
    <tr><th>Level</th><th>Count</th></tr>
    ${evidenceRows}
  </table>

  <h2>Rejected Findings (for tuning)</h2>
  ${
    rejected.length === 0
      ? '<p><em>No findings were rejected.</em></p>'
      : `<table>
    <tr><th>Title</th><th>File</th><th>Severity</th><th>Confidence</th><th>Stage</th><th>Reason</th></tr>
    ${rejected
      .map((r) => {
        const f = r.finding;
        const conf =
          typeof f.confidence === 'number' ? `${Math.round(f.confidence * 100)}%` : '—';
        const color = SEVERITY_COLOR[f.severity ?? ''] ?? '#64748b';
        return `<tr>
      <td>${esc(f.title)}</td>
      <td><code>${esc(f.file ?? '')}</code></td>
      <td><span style="color:${color};font-weight:bold">${esc((f.severity ?? '').toUpperCase())}</span></td>
      <td>${conf}</td>
      <td>${esc(r.stage)}</td>
      <td>${esc(r.reason)}</td>
    </tr>`;
      })
      .join('\n')}
  </table>`
  }

  <h2>Run Metadata</h2>
  <table>
    <tr><th>Field</th><th>Value</th></tr>
    <tr><td>Run ID</td><td><code>${esc(meta.runId)}</code></td></tr>
    <tr><td>Timestamp</td><td>${esc(meta.timestamp)}</td></tr>
    <tr><td>Base Ref</td><td><code>${esc(meta.baseRef)}</code></td></tr>
    <tr><td>Head Ref</td><td><code>${esc(meta.headRef)}</code></td></tr>
    <tr><td>Agents</td><td>${meta.agentsRun.map(esc).join(', ') || '—'}</td></tr>
    <tr><td>Providers</td><td>${meta.providersUsed.map(esc).join(', ') || '—'}</td></tr>
  </table>
</body>
</html>`;
  },
};
