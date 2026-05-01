import type { FileDiff } from '@engagement-harness/core';

const MAX_LINES_PER_FILE = 50;

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
