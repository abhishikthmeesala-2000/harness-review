import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export type Language =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'java'
  | 'ruby'
  | 'rust'
  | 'csharp'
  | 'php'
  | 'kotlin'
  | 'swift'
  | null;

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'pip' | 'poetry' | 'go' | 'cargo' | 'maven' | 'gradle' | null;

export type CiProvider = 'github' | 'gitlab' | 'azure-devops' | 'bitbucket' | null;

export interface RepoProfile {
  language: Language;
  framework: string | null;
  packageManager: PackageManager;
  testFramework: string | null;
  ciProvider: CiProvider;
  isMonorepo: boolean;
  importantPaths: string[];
  suggestedIgnoredPaths: string[];
}

const EXTENSION_TO_LANGUAGE: Record<string, Exclude<Language, null>> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.java': 'java',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.cs': 'csharp',
  '.php': 'php',
  '.kt': 'kotlin',
  '.swift': 'swift',
};

const PRUNED_DIRS = new Set([
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

const SCAN_MAX_DEPTH = 4;
const SCAN_MAX_FILES = 5000;

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function safeReadFile(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function safeReadJson<T>(file: string): T | null {
  const raw = safeReadFile(file);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

interface ScanResult {
  extensionCounts: Map<string, number>;
  importantPaths: string[];
}

function scanRepo(repoRoot: string): ScanResult {
  const extensionCounts = new Map<string, number>();
  const importantPaths = new Set<string>();
  const candidateDirs = ['src', 'lib', 'app', 'tests', 'test', '__tests__', 'docs', 'scripts'];

  let totalFiles = 0;

  function walk(dir: string, depth: number): void {
    if (depth > SCAN_MAX_DEPTH) return;
    if (totalFiles >= SCAN_MAX_FILES) return;
    const entries = safeReaddir(dir);
    for (const entry of entries) {
      if (totalFiles >= SCAN_MAX_FILES) return;
      if (PRUNED_DIRS.has(entry)) continue;
      const full = path.join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (depth === 0 && candidateDirs.includes(entry)) {
          importantPaths.add(entry);
        }
        walk(full, depth + 1);
      } else if (st.isFile()) {
        totalFiles++;
        const ext = path.extname(entry).toLowerCase();
        if (ext) extensionCounts.set(ext, (extensionCounts.get(ext) ?? 0) + 1);
      }
    }
  }

  walk(repoRoot, 0);
  return { extensionCounts, importantPaths: [...importantPaths].sort() };
}

function detectLanguage(extCounts: Map<string, number>): Language {
  const tally = new Map<Exclude<Language, null>, number>();
  for (const [ext, n] of extCounts) {
    const lang = EXTENSION_TO_LANGUAGE[ext];
    if (!lang) continue;
    tally.set(lang, (tally.get(lang) ?? 0) + n);
  }
  let best: Exclude<Language, null> | null = null;
  let bestN = 0;
  for (const [lang, n] of tally) {
    if (n > bestN) {
      best = lang;
      bestN = n;
    }
  }
  return best;
}

interface NodePackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  scripts?: Record<string, string>;
}

function detectNodeFramework(pkg: NodePackageJson | null): string | null {
  if (!pkg) return null;
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const ordered = [
    'next',
    'nuxt',
    '@remix-run/react',
    '@nestjs/core',
    'express',
    'fastify',
    'koa',
    'hapi',
    '@angular/core',
    'react',
    'vue',
    'svelte',
    'astro',
  ];
  for (const name of ordered) {
    if (deps[name]) return name;
  }
  return null;
}

function detectNodeTestFramework(pkg: NodePackageJson | null): string | null {
  if (!pkg) return null;
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const candidates = ['vitest', 'jest', 'mocha', 'ava', 'tap', 'jasmine', 'playwright', 'cypress'];
  for (const name of candidates) {
    if (deps[name]) return name;
  }
  return null;
}

function detectPackageManager(repoRoot: string, language: Language): PackageManager {
  if (existsSync(path.join(repoRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(repoRoot, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(repoRoot, 'package-lock.json'))) return 'npm';
  if (existsSync(path.join(repoRoot, 'poetry.lock'))) return 'poetry';
  if (
    existsSync(path.join(repoRoot, 'requirements.txt')) ||
    existsSync(path.join(repoRoot, 'Pipfile')) ||
    existsSync(path.join(repoRoot, 'pyproject.toml'))
  ) {
    return 'pip';
  }
  if (existsSync(path.join(repoRoot, 'go.mod'))) return 'go';
  if (existsSync(path.join(repoRoot, 'Cargo.toml'))) return 'cargo';
  if (existsSync(path.join(repoRoot, 'pom.xml'))) return 'maven';
  if (
    existsSync(path.join(repoRoot, 'build.gradle')) ||
    existsSync(path.join(repoRoot, 'build.gradle.kts'))
  ) {
    return 'gradle';
  }
  if (language === 'javascript' || language === 'typescript') {
    if (existsSync(path.join(repoRoot, 'package.json'))) return 'npm';
  }
  return null;
}

function detectCiProvider(repoRoot: string): CiProvider {
  if (
    existsSync(path.join(repoRoot, '.github', 'workflows')) &&
    safeReaddir(path.join(repoRoot, '.github', 'workflows')).length > 0
  ) {
    return 'github';
  }
  if (existsSync(path.join(repoRoot, '.gitlab-ci.yml'))) return 'gitlab';
  if (existsSync(path.join(repoRoot, 'azure-pipelines.yml'))) return 'azure-devops';
  if (existsSync(path.join(repoRoot, 'bitbucket-pipelines.yml'))) return 'bitbucket';
  return null;
}

function detectMonorepo(repoRoot: string, pkg: NodePackageJson | null): boolean {
  if (existsSync(path.join(repoRoot, 'pnpm-workspace.yaml'))) return true;
  if (existsSync(path.join(repoRoot, 'lerna.json'))) return true;
  if (existsSync(path.join(repoRoot, 'nx.json'))) return true;
  if (existsSync(path.join(repoRoot, 'turbo.json'))) return true;
  if (pkg?.workspaces) return true;
  return false;
}

function detectPythonFramework(repoRoot: string): string | null {
  const reqs = safeReadFile(path.join(repoRoot, 'requirements.txt'));
  const pyproject = safeReadFile(path.join(repoRoot, 'pyproject.toml'));
  const blob = `${reqs ?? ''}\n${pyproject ?? ''}`.toLowerCase();
  if (!blob.trim()) return null;
  const ordered = ['django', 'flask', 'fastapi', 'starlette', 'tornado', 'aiohttp'];
  for (const name of ordered) {
    if (blob.includes(name)) return name;
  }
  return null;
}

function detectPythonTestFramework(repoRoot: string): string | null {
  const reqs = safeReadFile(path.join(repoRoot, 'requirements.txt'));
  const pyproject = safeReadFile(path.join(repoRoot, 'pyproject.toml'));
  const blob = `${reqs ?? ''}\n${pyproject ?? ''}`.toLowerCase();
  if (blob.includes('pytest')) return 'pytest';
  if (blob.includes('unittest')) return 'unittest';
  if (blob.includes('nose')) return 'nose';
  if (existsSync(path.join(repoRoot, 'pytest.ini'))) return 'pytest';
  return null;
}

function detectGoFramework(repoRoot: string): string | null {
  const goMod = safeReadFile(path.join(repoRoot, 'go.mod'));
  if (!goMod) return null;
  const lower = goMod.toLowerCase();
  if (lower.includes('gin-gonic/gin')) return 'gin';
  if (lower.includes('labstack/echo')) return 'echo';
  if (lower.includes('gorilla/mux')) return 'gorilla-mux';
  if (lower.includes('go-chi/chi')) return 'chi';
  if (lower.includes('gofiber/fiber')) return 'fiber';
  return null;
}

function buildSuggestedIgnored(language: Language, isMonorepo: boolean): string[] {
  const base = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/coverage/**',
    '**/*.lock',
    '**/*.lockb',
    '**/.engagement-harness/**',
  ];
  if (language === 'python') {
    base.push('**/__pycache__/**', '**/*.pyc', '**/.venv/**', '**/venv/**');
  }
  if (language === 'go') {
    base.push('**/vendor/**');
  }
  if (language === 'rust') {
    base.push('**/target/**');
  }
  if (isMonorepo) {
    base.push('**/.turbo/**', '**/.nx/**');
  }
  return [...new Set(base)].sort();
}

export const RepoProfiler = {
  detect(repoRoot: string): RepoProfile {
    const scan = scanRepo(repoRoot);
    const language = detectLanguage(scan.extensionCounts);

    const packageJson = safeReadJson<NodePackageJson>(path.join(repoRoot, 'package.json'));

    let framework: string | null = null;
    let testFramework: string | null = null;
    if (language === 'javascript' || language === 'typescript') {
      framework = detectNodeFramework(packageJson);
      testFramework = detectNodeTestFramework(packageJson);
    } else if (language === 'python') {
      framework = detectPythonFramework(repoRoot);
      testFramework = detectPythonTestFramework(repoRoot);
    } else if (language === 'go') {
      framework = detectGoFramework(repoRoot);
    }

    const packageManager = detectPackageManager(repoRoot, language);
    const ciProvider = detectCiProvider(repoRoot);
    const isMonorepo = detectMonorepo(repoRoot, packageJson);

    return {
      language,
      framework,
      packageManager,
      testFramework,
      ciProvider,
      isMonorepo,
      importantPaths: scan.importantPaths,
      suggestedIgnoredPaths: buildSuggestedIgnored(language, isMonorepo),
    };
  },
};
