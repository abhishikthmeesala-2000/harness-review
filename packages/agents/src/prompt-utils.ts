import type { ContextEntry, FileDiff } from '@engagement-harness/core';

const MAX_LINES_PER_FILE = 50;
const MAX_LINES_PER_CONTEXT_FILE = 150;

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
    "id": "EH-<zero-padded 4-digit number, e.g. EH-0001, EH-0002>",
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

/**
 * Shared severity rubric appended to every finding agent's prompt so live LLMs
 * grade severity consistently and conservatively. Includes concrete ✅/❌ code
 * examples for each level plus the conservative-reporting rules.
 */
export const SEVERITY_CRITERIA_BLOCK = `SEVERITY CRITERIA — use EXACTLY these definitions:

CRITICAL — Exploitable vulnerability or data loss risk. ONLY report if you can show a concrete exploit path.
  ✅ REPORT as CRITICAL:
    const q = "SELECT * FROM users WHERE id=" + req.body.id   // injectable: attacker sends ' OR 1=1 --
    const STRIPE_KEY = "sk_live_51Hxyz1234567890"              // real production secret hardcoded
  ❌ DO NOT report as CRITICAL (mitigated):
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return res.status(400).send()
    const q = "SELECT * WHERE id=" + id                        // guaranteed integer — not injectable

HIGH — Bug causing incorrect behavior in production under reachable conditions. Describe the failure scenario.
  ✅ REPORT as HIGH:
    for (let i = 0; i < items.length - 1; i++) { process(items[i]) } // off-by-one: last item skipped
    const user = db.findUser(id); return user.name                  // null deref if not found
  ❌ DO NOT report as HIGH:
    Theoretical issue with no reachable code path, or an edge case requiring impossible preconditions.

MEDIUM — Fails under specific conditions or degrades reliability/maintainability significantly.
  ✅ REPORT as MEDIUM:
    let count = 0; async function increment() { count = count + 1 } // race under concurrency
    fetchData().catch(() => {})                                     // errors silently swallowed
  ❌ DO NOT report as MEDIUM:
    Unlikely edge case with negligible real-world impact.

LOW — Style, performance, or maintainability issue. Only report if clearly and obviously problematic.
  ✅ REPORT as LOW:
    users.forEach(u => { if (allUsers.find(x => x.id === u.id)) { ... } }) // O(n^2) where O(n) is easy
    const isValid = validate(input)   // name misleads: returns an error string, not a boolean
  ❌ DO NOT report as LOW:
    Minor preference or subjective style opinion that could go either way.

CONSERVATIVE REPORTING RULES:
- Only report issues IN changed lines or CAUSED BY changes.
- Set falsePositiveRisk by certainty: low = obvious, no mitigating factors; medium = likely, some context unclear; high = possible, significant uncertainty.
- Do NOT report if falsePositiveRisk would be high.
- Quote EXACT evidence from the file.
- If uncertain, do not report.`;

export function renderFileContext(entries: ContextEntry[]): string {
  const fileEntries = entries.filter(
    (e) =>
      e.kind === 'changed-file' ||
      e.kind === 'imports' ||
      e.kind === 'imported-by' ||
      e.kind === 'test',
  );
  if (fileEntries.length === 0) return '(no file context available)';
  return fileEntries
    .map((e) => {
      const lines = e.content.split('\n');
      const truncated = lines.length > MAX_LINES_PER_CONTEXT_FILE;
      const body = lines.slice(0, MAX_LINES_PER_CONTEXT_FILE).join('\n');
      return `### ${e.path} [${e.kind}]\n\`\`\`\n${body}${truncated ? '\n… (truncated)' : ''}\n\`\`\``;
    })
    .join('\n\n');
}

const MAX_FUNC_LINES = 80;

// Matches the start of a function/method declaration in TS/JS.
const FUNC_START_RE =
  /^\s*(export\s+)?(default\s+)?(async\s+)?function[\s*]\w+|^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(|^\s*(public|private|protected|static|\s)*(async\s+)?\w+\s*\([^)]*\)\s*(:\s*\S+\s*)?\{/;

function extractContainingFunction(
  lines: string[],
  targetLine: number, // 1-based
): { startLine: number; endLine: number; body: string } | null {
  const idx = Math.min(targetLine - 1, lines.length - 1);

  let startIdx = -1;
  for (let i = idx; i >= 0; i--) {
    if (FUNC_START_RE.test(lines[i] ?? '')) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;

  let depth = 0;
  let endIdx = -1;
  // State machine skips string literals and comments so braces inside them
  // don't corrupt the depth counter.
  let inLineComment = false;
  let inBlockComment = false;
  let stringChar: string | null = null;

  outer: for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i] ?? '';
    inLineComment = false; // reset per line — line comments don't span lines
    for (let j = 0; j < line.length; j++) {
      const ch = line[j] ?? '';
      const next = line[j + 1] ?? '';

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          j++;
        }
        continue;
      }
      if (inLineComment) continue;
      if (stringChar !== null) {
        if (ch === '\\') {
          j++;
          continue;
        } // escaped char
        if (ch === stringChar) stringChar = null;
        continue;
      }

      if (ch === '/' && next === '/') {
        inLineComment = true;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        j++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        stringChar = ch;
        continue;
      }

      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break outer;
        }
      }
    }
  }

  if (endIdx === -1) return null; // no matching closing brace found

  const actualEnd = Math.min(endIdx, startIdx + MAX_FUNC_LINES - 1);
  return {
    startLine: startIdx + 1,
    endLine: actualEnd + 1,
    body: lines.slice(startIdx, actualEnd + 1).join('\n'),
  };
}

/**
 * For each changed hunk, extract the containing function/method body from
 * full file context. Uses bracket-counting heuristics — no AST dependency.
 */
export function renderFunctionContext(diff: FileDiff[], entries: ContextEntry[]): string {
  const fileLines = new Map<string, string[]>();
  for (const e of entries) {
    if (e.kind === 'changed-file') {
      fileLines.set(e.path, e.content.split('\n'));
    }
  }

  const sections: string[] = [];
  const seen = new Set<string>();

  for (const file of diff) {
    const lines = fileLines.get(file.path);
    if (!lines) continue;

    for (const hunk of file.hunks) {
      const func = extractContainingFunction(lines, hunk.newStart);
      if (!func) continue;

      // Deduplicate: same function hit by multiple hunks in same file
      const dedupKey = `${file.path}:${func.startLine}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      sections.push(
        `### ${file.path} lines ${func.startLine}–${func.endLine}\n\`\`\`\n${func.body}\n\`\`\``,
      );
    }
  }

  return sections.length > 0 ? sections.join('\n\n') : '(no function context extracted)';
}

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
