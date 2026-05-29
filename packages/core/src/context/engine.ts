import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import micromatch from 'micromatch';

import type { Config } from '../schemas/config.js';
import type { FileDiff } from '../git/diff-parser.js';
import type { RepoProfile } from '../profile/profiler.js';
import type {
  ContextBundle,
  ContextEntry,
  ContextEntryKind,
  PrMetadata,
  RunMetadata,
} from './types.js';

const PRIORITY: Record<ContextEntryKind, number> = {
  'changed-file': 100,
  rule: 90,
  test: 80,
  'imported-by': 70,
  imports: 60,
};

const TS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const PY_EXTENSIONS = ['.py'];

export interface BuildOptions {
  prMetadata?: PrMetadata;
  runMetadata?: RunMetadata;
}

interface ResolvedRule {
  rulePath: string;
  globs: string[];
  body: string;
}

export class ContextEngine {
  static build(
    diff: FileDiff[],
    repoRoot: string,
    profile: RepoProfile,
    config: Config,
    options: BuildOptions = {},
  ): ContextBundle {
    const ignoredPaths = config.context.ignoredPaths;
    const maxFiles = config.context.maxFiles;
    const maxTokens = config.context.maxTokens;

    // Filter the diff to omit ignored paths so downstream agents see a consistent picture.
    const filteredDiff = diff.filter((f) => !isIgnored(f.path, ignoredPaths));

    // Build a map of repo files we may want to include. We only read what we need.
    const candidates = new Map<string, ContextEntry>();
    const addCandidate = (entry: ContextEntry): void => {
      if (isIgnored(entry.path, ignoredPaths)) return;
      const existing = candidates.get(entry.path);
      if (!existing || entry.priority > existing.priority) {
        candidates.set(entry.path, entry);
      }
    };

    // 1) Changed files (full content of new file)
    for (const file of filteredDiff) {
      if (file.status === 'deleted' || file.status === 'binary') continue;
      const content = safeReadFile(path.join(repoRoot, file.path));
      if (content === null) continue;
      addCandidate({
        path: file.path,
        content,
        reason: 'Changed file',
        priority: PRIORITY['changed-file'],
        kind: 'changed-file',
      });
    }

    // 2) Test files for each changed file
    for (const file of filteredDiff) {
      if (file.status === 'deleted' || file.status === 'binary') continue;
      const tests = findTestFiles(repoRoot, file.path);
      for (const t of tests) {
        const content = safeReadFile(path.join(repoRoot, t));
        if (content === null) continue;
        addCandidate({
          path: t,
          content,
          reason: `Test file for ${file.path}`,
          priority: PRIORITY.test,
          kind: 'test',
        });
      }
    }

    // 3) Rules that match changed files
    const rules = loadRules(repoRoot);
    for (const file of filteredDiff) {
      for (const rule of rules) {
        if (rule.globs.some((g) => micromatch.isMatch(file.path, g))) {
          addCandidate({
            path: rule.rulePath,
            content: rule.body,
            reason: `Rule applies to ${file.path}`,
            priority: PRIORITY.rule,
            kind: 'rule',
          });
        }
      }
    }

    // 4) Files imported BY each changed file (1-hop, priority 60)
    for (const file of filteredDiff) {
      if (file.status === 'deleted' || file.status === 'binary') continue;
      const fullPath = path.join(repoRoot, file.path);
      const content = safeReadFile(fullPath);
      if (content === null) continue;
      const imports = extractImports(file.path, content);
      for (const target of imports) {
        const resolved = resolveImport(repoRoot, file.path, target);
        if (!resolved) continue;
        const importedContent = safeReadFile(path.join(repoRoot, resolved));
        if (importedContent === null) continue;
        addCandidate({
          path: resolved,
          content: importedContent,
          reason: `Imported by changed file ${file.path}`,
          priority: PRIORITY.imports,
          kind: 'imports',
        });
      }
    }

    // 5) Files that import each changed file (1-hop, priority 70)
    const importers = findImporters(
      repoRoot,
      filteredDiff.map((f) => f.path),
      ignoredPaths,
    );
    for (const [changedPath, importerPaths] of importers) {
      for (const importer of importerPaths) {
        const content = safeReadFile(path.join(repoRoot, importer));
        if (content === null) continue;
        addCandidate({
          path: importer,
          content,
          reason: `Imports changed file ${changedPath}`,
          priority: PRIORITY['imported-by'],
          kind: 'imported-by',
        });
      }
    }

    const entries = applyBudget([...candidates.values()], maxFiles, maxTokens);

    const bundle: ContextBundle = {
      entries,
      diff: filteredDiff,
      repoProfile: profile,
    };
    if (options.prMetadata) bundle.prMetadata = options.prMetadata;
    if (options.runMetadata) bundle.runMetadata = options.runMetadata;
    return bundle;
  }
}

function isIgnored(filePath: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return false;
  return micromatch.isMatch(filePath, patterns as string[]);
}

function safeReadFile(absPath: string): string | null {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function applyBudget(entries: ContextEntry[], maxFiles: number, maxTokens: number): ContextEntry[] {
  // Order by priority desc, then by smaller content first (cheaper to keep).
  const sorted = [...entries].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.content.length - b.content.length;
  });
  const kept: ContextEntry[] = [];
  let totalTokens = 0;
  for (const entry of sorted) {
    if (kept.length >= maxFiles) break;
    const cost = approxTokens(entry.content);
    if (totalTokens + cost > maxTokens && kept.length > 0) continue;
    kept.push(entry);
    totalTokens += cost;
  }
  return kept;
}

function findTestFiles(repoRoot: string, changedPath: string): string[] {
  const found: string[] = [];
  const ext = path.extname(changedPath);
  const base = path.basename(changedPath, ext);
  const dir = path.dirname(changedPath);

  // 1) Sibling: foo.test.ts, foo.spec.ts, foo_test.go, etc.
  const siblings = [
    `${base}.test${ext}`,
    `${base}.spec${ext}`,
    `${base}_test${ext}`,
    `${base}-test${ext}`,
  ];
  for (const sibling of siblings) {
    const candidate = path.join(dir, sibling);
    if (existsSync(path.join(repoRoot, candidate))) found.push(candidate);
  }

  // 2) __tests__ adjacent dir
  const inTestsDir = path.join(dir, '__tests__', `${base}${ext}`);
  if (existsSync(path.join(repoRoot, inTestsDir))) found.push(inTestsDir);
  const inTestsDirTest = path.join(dir, '__tests__', `${base}.test${ext}`);
  if (existsSync(path.join(repoRoot, inTestsDirTest))) found.push(inTestsDirTest);

  // 3) tests/ mirror at repo root: src/foo/bar.ts -> tests/foo/bar.ts (or .test.ts)
  const segments = changedPath.split(path.sep);
  if (
    segments.length > 1 &&
    (segments[0] === 'src' || segments[0] === 'lib' || segments[0] === 'app')
  ) {
    const tail = segments.slice(1).join(path.sep);
    const tailDir = path.dirname(tail);
    const tailBase = path.basename(tail, ext);
    const candidates = [
      path.join('tests', tail),
      path.join('test', tail),
      path.join('tests', tailDir, `${tailBase}.test${ext}`),
      path.join('tests', tailDir, `${tailBase}.spec${ext}`),
    ];
    for (const c of candidates) {
      if (existsSync(path.join(repoRoot, c))) found.push(c);
    }
  }

  return [...new Set(found)];
}

const RULE_HEADER_RE = /^---\s*$/m;

function loadRules(repoRoot: string): ResolvedRule[] {
  const rulesDir = path.join(repoRoot, '.engagement-harness', 'rules');
  if (!existsSync(rulesDir)) return [];
  let files: string[] = [];
  try {
    files = readdirSync(rulesDir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  const rules: ResolvedRule[] = [];
  for (const file of files) {
    const full = path.join(rulesDir, file);
    const content = safeReadFile(full);
    if (content === null) continue;
    const parsed = parseRule(content);
    if (parsed.globs.length === 0) continue;
    rules.push({
      rulePath: path.posix.join('.engagement-harness', 'rules', file),
      globs: parsed.globs,
      body: content,
    });
  }
  return rules;
}

interface ParsedRule {
  globs: string[];
}

function parseRule(content: string): ParsedRule {
  // Frontmatter format:
  // ---
  // glob: src/**/*.ts
  // ---
  // body...
  //
  // Or:
  // ---
  // globs:
  //   - src/**/*.ts
  //   - lib/**
  // ---
  if (!content.startsWith('---')) return { globs: [] };
  const lines = content.split('\n');
  // Find end of frontmatter
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (RULE_HEADER_RE.test(lines[i] ?? '')) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return { globs: [] };
  const fm = lines.slice(1, endIdx);
  const globs: string[] = [];
  let collectingArray = false;
  for (const raw of fm) {
    const line = raw.trim();
    if (line === '') {
      collectingArray = false;
      continue;
    }
    if (collectingArray && line.startsWith('-')) {
      const value = stripQuotes(line.slice(1).trim());
      if (value) globs.push(value);
      continue;
    }
    collectingArray = false;
    if (line.startsWith('glob:')) {
      const value = stripQuotes(line.slice('glob:'.length).trim());
      if (value) globs.push(value);
    } else if (line.startsWith('globs:')) {
      const inline = line.slice('globs:'.length).trim();
      if (inline.startsWith('[') && inline.endsWith(']')) {
        const inner = inline.slice(1, -1);
        for (const part of inner.split(',')) {
          const v = stripQuotes(part.trim());
          if (v) globs.push(v);
        }
      } else if (inline === '') {
        collectingArray = true;
      }
    }
  }
  return { globs };
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

const TS_IMPORT_RE = /^\s*import\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/gm;
const TS_REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const PY_IMPORT_RE = /^\s*(?:from\s+([\w.]+)\s+import\s+\w|import\s+([\w.]+))/gm;

function extractImports(filePath: string, content: string): string[] {
  const ext = path.extname(filePath).toLowerCase();
  const out = new Set<string>();
  if (TS_EXTENSIONS.includes(ext)) {
    let m: RegExpExecArray | null;
    TS_IMPORT_RE.lastIndex = 0;
    while ((m = TS_IMPORT_RE.exec(content)) !== null) {
      if (m[1]) out.add(m[1]);
    }
    TS_REQUIRE_RE.lastIndex = 0;
    while ((m = TS_REQUIRE_RE.exec(content)) !== null) {
      if (m[1]) out.add(m[1]);
    }
  } else if (PY_EXTENSIONS.includes(ext)) {
    let m: RegExpExecArray | null;
    PY_IMPORT_RE.lastIndex = 0;
    while ((m = PY_IMPORT_RE.exec(content)) !== null) {
      const mod = m[1] ?? m[2];
      if (mod) out.add(mod);
    }
  }
  return [...out];
}

function resolveImport(repoRoot: string, fromFile: string, target: string): string | null {
  const ext = path.extname(fromFile).toLowerCase();
  if (TS_EXTENSIONS.includes(ext)) {
    if (!target.startsWith('.')) return null; // bare specifier; npm pkg
    return resolveTsImport(repoRoot, fromFile, target);
  }
  if (PY_EXTENSIONS.includes(ext)) {
    return resolvePyImport(repoRoot, fromFile, target);
  }
  return null;
}

function resolveTsImport(repoRoot: string, fromFile: string, target: string): string | null {
  const fromDir = path.dirname(fromFile);
  const rawAbs = path.normalize(path.join(fromDir, target));
  const candidates: string[] = [];
  // Strip an explicit .js extension that ESM TypeScript uses to refer to .ts files.
  const stripped = rawAbs.replace(/\.js$/, '');
  for (const ext of TS_EXTENSIONS) {
    candidates.push(`${stripped}${ext}`);
    candidates.push(`${rawAbs}${ext}`);
  }
  candidates.push(rawAbs);
  for (const ext of TS_EXTENSIONS) {
    candidates.push(path.join(rawAbs, `index${ext}`));
  }
  for (const c of candidates) {
    const full = path.join(repoRoot, c);
    if (existsSync(full)) {
      try {
        if (statSync(full).isFile()) return c;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function resolvePyImport(repoRoot: string, fromFile: string, target: string): string | null {
  // Resolve dotted-path imports relative to repo root only (best-effort).
  const parts = target.split('.');
  if (parts.some((p) => p.length === 0)) return null;
  const rel = parts.join(path.sep) + '.py';
  const candidates = [rel, path.join(parts.join(path.sep), '__init__.py')];
  // Also try relative to fromFile's dir.
  const fromDir = path.dirname(fromFile);
  candidates.unshift(path.join(fromDir, rel));
  for (const c of candidates) {
    const full = path.join(repoRoot, c);
    if (existsSync(full)) {
      try {
        if (statSync(full).isFile()) return c;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

const PRUNE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'target',
  'out',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  '.engagement-harness',
]);

function findImporters(
  repoRoot: string,
  changedPaths: string[],
  ignoredPaths: readonly string[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (changedPaths.length === 0) return result;

  const allFiles = walkRepo(repoRoot, ignoredPaths);

  for (const target of changedPaths) {
    const targetExt = path.extname(target).toLowerCase();
    if (![...TS_EXTENSIONS, ...PY_EXTENSIONS].includes(targetExt)) {
      result.set(target, []);
      continue;
    }
    const importers: string[] = [];
    for (const candidate of allFiles) {
      if (candidate === target) continue;
      const ext = path.extname(candidate).toLowerCase();
      if (![...TS_EXTENSIONS, ...PY_EXTENSIONS].includes(ext)) continue;
      const content = safeReadFile(path.join(repoRoot, candidate));
      if (content === null) continue;
      const imports = extractImports(candidate, content);
      for (const imp of imports) {
        const resolved = resolveImport(repoRoot, candidate, imp);
        if (resolved === target) {
          importers.push(candidate);
          break;
        }
      }
    }
    result.set(target, importers);
  }
  return result;
}

function walkRepo(repoRoot: string, ignoredPaths: readonly string[]): string[] {
  const files: string[] = [];
  const MAX_FILES = 10000;

  function walk(dir: string): void {
    if (files.length >= MAX_FILES) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (PRUNE_DIRS.has(entry)) continue;
      const full = path.join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      const rel = path.relative(repoRoot, full);
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile()) {
        if (!isIgnored(rel, ignoredPaths)) files.push(rel);
      }
    }
  }

  walk(repoRoot);
  return files;
}
