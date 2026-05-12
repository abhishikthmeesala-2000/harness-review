import type { FileDiff } from '@engagement-harness/core';

const MAX_LINES_PER_FILE = 50;

/**
 * A concrete JSON example of the exact CandidateFinding shape expected by
 * the pipeline's Zod schema. Embed this in every agent prompt so live LLMs
 * know the exact field names, types, and allowed enum values.
 *
 * Fields the pipeline overwrites (sourceAgent, modelProvider) are still
 * included so the model produces structurally valid JSON.
 */
export const FINDING_SCHEMA_BLOCK = `Return ONLY a JSON array. Each element must match this exact shape (no extra fields):
[
  {
    "id": "EH-<AGENT>-<N>",
    "title": "Short description (max 120 chars)",
    "category": "<one of: correctness | security | testing | domain-policy | design | data | observability | intent-gap>",
    "dimension": "<same as the Dimension line above>",
    "severity": "<one of: low | medium | high | critical>",
    "file": "<exact filename from the diff>",
    "lineStart": <positive integer>,
    "lineEnd": <positive integer, >= lineStart>,
    "evidence": [{ "type": "<diff | context | rule>", "content": "<exact line(s) from the diff>" }],
    "whyItMatters": "Why this is a real risk",
    "suggestedFix": "Concrete fix, not generic advice",
    "clientRuleReferences": [],
    "falsePositiveRisk": "<low | medium | high>",
    "sourceAgent": "placeholder",
    "modelProvider": "placeholder",
    "remediationReadiness": "<ready | needs-context | manual-only>"
  }
]
Return [] if you find nothing worth flagging. Do NOT wrap in markdown fences.`;

export function renderDiffSummary(diff: FileDiff[]): string {
  if (diff.length === 0) return '(no changed files)';
  return diff
    .map((file) => {
      const header = `--- ${file.path} (${file.status})`;
      if (file.status === 'binary' || file.hunks.length === 0) {
        return header;
      }
      const lines: string[] = [header];
      let printed = 0;
      outer: for (const hunk of file.hunks) {
        lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
        for (const ln of hunk.lines) {
          const sigil = ln.type === 'added' ? '+' : ln.type === 'removed' ? '-' : ' ';
          lines.push(`${sigil}${ln.content}`);
          printed++;
          if (printed >= MAX_LINES_PER_FILE) {
            lines.push('… (truncated)');
            break outer;
          }
        }
      }
      return lines.join('\n');
    })
    .join('\n\n');
}
