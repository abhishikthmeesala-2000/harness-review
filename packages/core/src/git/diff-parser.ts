import { simpleGit, type SimpleGit } from 'simple-git';

export type FileDiffStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'binary';

export type DiffLineType = 'added' | 'removed' | 'context';

export interface DiffLine {
  type: DiffLineType;
  content: string;
  lineNumber: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: FileDiffStatus;
  hunks: DiffHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

interface FileHeader {
  path: string;
  oldPath?: string;
  status: FileDiffStatus;
}

function parseHunkHeader(line: string): {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
} | null {
  const m = HUNK_HEADER.exec(line);
  if (!m) return null;
  const oldStart = Number(m[1]);
  const oldLines = m[2] === undefined ? 1 : Number(m[2]);
  const newStart = Number(m[3]);
  const newLines = m[4] === undefined ? 1 : Number(m[4]);
  return { oldStart, oldLines, newStart, newLines };
}

function unquotePath(p: string): string {
  // git quotes paths containing unusual chars: "path/with space"
  if (p.startsWith('"') && p.endsWith('"')) {
    return p.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return p;
}

function pathFromAB(side: string): string | null {
  // side is like 'a/path' or 'b/path' or '/dev/null'
  if (side === '/dev/null') return null;
  if (side.startsWith('a/') || side.startsWith('b/')) return side.slice(2);
  return side;
}

interface ParsedFileBlock {
  header: FileHeader;
  bodyLines: string[];
}

function splitFileBlocks(diffText: string): ParsedFileBlock[] {
  const blocks: ParsedFileBlock[] = [];
  const lines = diffText.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.startsWith('diff --git ')) {
      i++;
      continue;
    }

    // Parse the file-level metadata until we hit the first hunk header or the next diff --git.
    const header: FileHeader = parsePathsFromDiffGit(line);
    let isBinary = false;
    let isNewFile = false;
    let isDeleted = false;
    let renameFrom: string | undefined;
    let renameTo: string | undefined;
    const bodyLines: string[] = [];

    i++;
    while (i < lines.length) {
      const cur = lines[i] ?? '';
      if (cur.startsWith('diff --git ')) break;
      if (cur.startsWith('@@')) {
        // Body starts here
        while (i < lines.length) {
          const inner = lines[i] ?? '';
          if (inner.startsWith('diff --git ')) break;
          bodyLines.push(inner);
          i++;
        }
        break;
      }
      if (cur.startsWith('new file mode ')) isNewFile = true;
      else if (cur.startsWith('deleted file mode ')) isDeleted = true;
      else if (cur.startsWith('rename from '))
        renameFrom = unquotePath(cur.slice('rename from '.length));
      else if (cur.startsWith('rename to ')) renameTo = unquotePath(cur.slice('rename to '.length));
      else if (cur.startsWith('Binary files ') || cur.startsWith('GIT binary patch'))
        isBinary = true;
      else if (cur.startsWith('--- ')) {
        const old = pathFromAB(cur.slice(4).trim());
        if (old !== null) header.oldPath = old;
      } else if (cur.startsWith('+++ ')) {
        const newP = pathFromAB(cur.slice(4).trim());
        if (newP !== null) header.path = newP;
      }
      i++;
    }

    if (renameFrom !== undefined) header.oldPath = renameFrom;
    if (renameTo !== undefined) header.path = renameTo;

    if (isBinary) header.status = 'binary';
    else if (isNewFile) header.status = 'added';
    else if (isDeleted) header.status = 'deleted';
    else if (renameFrom !== undefined && renameTo !== undefined) header.status = 'renamed';
    else header.status = 'modified';

    blocks.push({ header, bodyLines });
  }

  return blocks;
}

function parsePathsFromDiffGit(line: string): FileHeader {
  // `diff --git a/foo b/bar` — paths may be quoted.
  const rest = line.slice('diff --git '.length);
  // We need to split into two halves. Handle both quoted and unquoted forms.
  const tokens = tokenizeDiffGitPaths(rest);
  const a = tokens[0] ?? '';
  const b = tokens[1] ?? '';
  const aPath = unquotePath(a).replace(/^a\//, '');
  const bPath = unquotePath(b).replace(/^b\//, '');
  return { path: bPath || aPath, oldPath: aPath !== bPath ? aPath : undefined, status: 'modified' };
}

function tokenizeDiffGitPaths(rest: string): [string, string] {
  // Two paths separated by a single space; each can be quoted.
  if (rest.startsWith('"')) {
    let end = 1;
    while (end < rest.length) {
      if (rest[end] === '\\') {
        end += 2;
        continue;
      }
      if (rest[end] === '"') break;
      end++;
    }
    const a = rest.slice(0, end + 1);
    const remainder = rest.slice(end + 2);
    return [a, remainder];
  }
  const space = rest.indexOf(' ');
  if (space === -1) return [rest, ''];
  return [rest.slice(0, space), rest.slice(space + 1)];
}

function parseHunks(bodyLines: string[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let i = 0;
  while (i < bodyLines.length) {
    const line = bodyLines[i] ?? '';
    if (!line.startsWith('@@')) {
      i++;
      continue;
    }
    const meta = parseHunkHeader(line);
    if (!meta) {
      i++;
      continue;
    }
    const lines: DiffLine[] = [];
    let oldCounter = meta.oldStart;
    let newCounter = meta.newStart;
    i++;
    while (i < bodyLines.length) {
      const cur = bodyLines[i] ?? '';
      if (cur.startsWith('@@')) break;
      // Trailing empty string from final split — ignore at end.
      if (cur === '' && i === bodyLines.length - 1) {
        i++;
        continue;
      }
      const marker = cur[0] ?? ' ';
      const content = cur.slice(1);
      if (marker === '+') {
        lines.push({ type: 'added', content, lineNumber: newCounter });
        newCounter++;
      } else if (marker === '-') {
        lines.push({ type: 'removed', content, lineNumber: oldCounter });
        oldCounter++;
      } else if (marker === ' ') {
        lines.push({ type: 'context', content, lineNumber: newCounter });
        oldCounter++;
        newCounter++;
      } else if (marker === '\\') {
        // "\ No newline at end of file" — skip
      } else {
        // Unknown line; treat as context to keep the parser forgiving.
        lines.push({ type: 'context', content: cur, lineNumber: newCounter });
        oldCounter++;
        newCounter++;
      }
      i++;
    }
    hunks.push({ ...meta, lines });
  }
  return hunks;
}

export function parseUnifiedDiff(diffText: string): FileDiff[] {
  if (!diffText) return [];
  const blocks = splitFileBlocks(diffText);
  const result: FileDiff[] = [];
  for (const block of blocks) {
    const { header, bodyLines } = block;
    if (header.status === 'binary') {
      result.push({ path: header.path, oldPath: header.oldPath, status: 'binary', hunks: [] });
      continue;
    }
    const hunks = parseHunks(bodyLines);
    result.push({
      path: header.path,
      oldPath: header.oldPath,
      status: header.status,
      hunks,
    });
  }
  return result;
}

export class GitDiffParser {
  private readonly git: SimpleGit;

  constructor(repoRoot: string) {
    this.git = simpleGit(repoRoot);
  }

  async parseDiff(baseRef: string, headRef: string): Promise<FileDiff[]> {
    const text = await this.git.diff(['--find-renames', '--no-color', '-U3', baseRef, headRef]);
    return parseUnifiedDiff(text);
  }

  static async parseDiff(repoRoot: string, baseRef: string, headRef: string): Promise<FileDiff[]> {
    return new GitDiffParser(repoRoot).parseDiff(baseRef, headRef);
  }
}
