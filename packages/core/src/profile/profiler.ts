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
  | 'elixir'
  | 'scala'
  | null;

export type PackageManager =
  | 'pnpm'
  | 'npm'
  | 'yarn'
  | 'bun'
  | 'pip'
  | 'poetry'
  | 'uv'
  | 'go'
  | 'cargo'
  | 'maven'
  | 'gradle'
  | 'bundler'
  | 'composer'
  | 'spm'
  | 'nuget'
  | 'mix'
  | 'sbt'
  | null;

export type CiProvider =
  | 'github'
  | 'gitlab'
  | 'azure-devops'
  | 'bitbucket'
  | 'circleci'
  | 'jenkins'
  | 'travis'
  | 'drone'
  | 'teamcity'
  | null;

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
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.java': 'java',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.cs': 'csharp',
  '.php': 'php',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.scala': 'scala',
  '.sc': 'scala',
};

// Config files that strongly signal a specific language (weighted as extra votes)
const CONFIG_FILE_SIGNALS: Array<{ file: string; lang: Exclude<Language, null>; weight: number }> =
  [
    { file: 'tsconfig.json', lang: 'typescript', weight: 50 },
    { file: 'tsconfig.base.json', lang: 'typescript', weight: 50 },
    { file: 'jsconfig.json', lang: 'javascript', weight: 30 },
    { file: 'pyproject.toml', lang: 'python', weight: 30 },
    { file: 'setup.py', lang: 'python', weight: 30 },
    { file: 'setup.cfg', lang: 'python', weight: 20 },
    { file: 'go.mod', lang: 'go', weight: 50 },
    { file: 'Cargo.toml', lang: 'rust', weight: 50 },
    { file: 'Gemfile', lang: 'ruby', weight: 50 },
    { file: 'mix.exs', lang: 'elixir', weight: 50 },
    { file: 'build.sbt', lang: 'scala', weight: 50 },
    { file: 'Package.swift', lang: 'swift', weight: 50 },
    { file: 'composer.json', lang: 'php', weight: 30 },
  ];

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
  'vendor',
  '.turbo',
  '.nx',
  '_build',
  'deps',
]);

const SCAN_MAX_DEPTH = 4;
const SCAN_MAX_FILES = 5000;

const IMPORTANT_DIR_NAMES = new Set([
  'src',
  'lib',
  'app',
  'apps',
  'packages',
  'tests',
  'test',
  '__tests__',
  'spec',
  'docs',
  'scripts',
  'api',
  'cmd',
  'internal',
  'pkg',
  'handlers',
  'services',
  'models',
  'routes',
  'controllers',
  'middleware',
  'components',
  'pages',
  'utils',
  'helpers',
  'config',
  'migrations',
]);

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

  let totalFiles = 0;

  function walk(dir: string, depth: number, relBase: string): void {
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
        const rel = relBase ? `${relBase}/${entry}` : entry;
        if (depth <= 2 && IMPORTANT_DIR_NAMES.has(entry)) {
          importantPaths.add(rel);
        }
        walk(full, depth + 1, rel);
      } else if (st.isFile()) {
        totalFiles++;
        // Skip TypeScript declaration files — generated, not source
        if (entry.endsWith('.d.ts')) continue;
        const ext = path.extname(entry).toLowerCase();
        if (ext && ext !== '.') {
          extensionCounts.set(ext, (extensionCounts.get(ext) ?? 0) + 1);
        }
      }
    }
  }

  walk(repoRoot, 0, '');
  return { extensionCounts, importantPaths: [...importantPaths].sort() };
}

function detectLanguage(extCounts: Map<string, number>, repoRoot: string): Language {
  const tally = new Map<Exclude<Language, null>, number>();

  for (const [ext, n] of extCounts) {
    const lang = EXTENSION_TO_LANGUAGE[ext];
    if (!lang) continue;
    tally.set(lang, (tally.get(lang) ?? 0) + n);
  }

  // Config-file signals act as weighted votes — beats ambiguous file counts
  for (const { file, lang, weight } of CONFIG_FILE_SIGNALS) {
    if (existsSync(path.join(repoRoot, file))) {
      tally.set(lang, (tally.get(lang) ?? 0) + weight);
    }
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
  peerDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  scripts?: Record<string, string>;
}

function allDeps(pkg: NodePackageJson | null): Record<string, string> {
  if (!pkg) return {};
  return {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  };
}

function detectNodeFramework(pkg: NodePackageJson | null): string | null {
  if (!pkg) return null;
  const deps = allDeps(pkg);
  const ordered: Array<[string, string]> = [
    ['next', 'next'],
    ['nuxt', 'nuxt'],
    ['@remix-run/react', '@remix-run/react'],
    ['@nestjs/core', '@nestjs/core'],
    ['hono', 'hono'],
    ['elysia', 'elysia'],
    ['fastify', 'fastify'],
    ['express', 'express'],
    ['koa', 'koa'],
    ['@hapi/hapi', '@hapi/hapi'],
    ['@apollo/server', '@apollo/server'],
    ['@trpc/server', '@trpc/server'],
    ['socket.io', 'socket.io'],
    ['@angular/core', '@angular/core'],
    ['react', 'react'],
    ['vue', 'vue'],
    ['svelte', 'svelte'],
    ['astro', 'astro'],
    ['solid-js', 'solid-js'],
  ];
  for (const [dep, label] of ordered) {
    if (deps[dep]) return label;
  }
  return null;
}

function detectNodeTestFramework(pkg: NodePackageJson | null): string | null {
  if (!pkg) return null;
  const deps = allDeps(pkg);
  const candidates: Array<[string, string]> = [
    ['vitest', 'vitest'],
    ['jest', 'jest'],
    ['@jest/core', 'jest'],
    ['mocha', 'mocha'],
    ['ava', 'ava'],
    ['tap', 'tap'],
    ['jasmine', 'jasmine'],
    ['@playwright/test', 'playwright'],
    ['playwright', 'playwright'],
    ['cypress', 'cypress'],
  ];
  for (const [dep, label] of candidates) {
    if (deps[dep]) return label;
  }
  // Fall back to script hints
  const scripts = Object.values(pkg.scripts ?? {}).join(' ');
  if (scripts.includes('vitest')) return 'vitest';
  if (scripts.includes('jest')) return 'jest';
  if (scripts.includes('mocha')) return 'mocha';
  return null;
}

function detectPackageManager(repoRoot: string): PackageManager {
  // Lock files are definitive
  if (existsSync(path.join(repoRoot, 'bun.lockb'))) return 'bun';
  if (existsSync(path.join(repoRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(repoRoot, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(repoRoot, 'package-lock.json'))) return 'npm';
  if (existsSync(path.join(repoRoot, 'poetry.lock'))) return 'poetry';
  if (existsSync(path.join(repoRoot, 'uv.lock'))) return 'uv';
  if (existsSync(path.join(repoRoot, 'Cargo.lock'))) return 'cargo';
  if (existsSync(path.join(repoRoot, 'Gemfile.lock'))) return 'bundler';
  if (existsSync(path.join(repoRoot, 'composer.lock'))) return 'composer';
  // Manifests (no lock file present)
  if (existsSync(path.join(repoRoot, 'Cargo.toml'))) return 'cargo';
  if (existsSync(path.join(repoRoot, 'go.mod'))) return 'go';
  if (existsSync(path.join(repoRoot, 'mix.exs'))) return 'mix';
  if (existsSync(path.join(repoRoot, 'build.sbt'))) return 'sbt';
  if (existsSync(path.join(repoRoot, 'Package.swift'))) return 'spm';
  if (existsSync(path.join(repoRoot, 'pom.xml'))) return 'maven';
  if (
    existsSync(path.join(repoRoot, 'build.gradle')) ||
    existsSync(path.join(repoRoot, 'build.gradle.kts'))
  ) {
    return 'gradle';
  }
  if (existsSync(path.join(repoRoot, 'Gemfile'))) return 'bundler';
  if (existsSync(path.join(repoRoot, 'composer.json'))) return 'composer';
  if (
    existsSync(path.join(repoRoot, 'requirements.txt')) ||
    existsSync(path.join(repoRoot, 'Pipfile')) ||
    existsSync(path.join(repoRoot, 'pyproject.toml'))
  ) {
    return 'pip';
  }
  if (existsSync(path.join(repoRoot, 'package.json'))) return 'npm';
  // .NET: look for .csproj or .sln in root
  const rootEntries = safeReaddir(repoRoot);
  if (rootEntries.some((e) => e.endsWith('.csproj') || e.endsWith('.sln'))) return 'nuget';
  return null;
}

function detectCiProvider(repoRoot: string): CiProvider {
  if (
    existsSync(path.join(repoRoot, '.github', 'workflows')) &&
    safeReaddir(path.join(repoRoot, '.github', 'workflows')).some(
      (f) => f.endsWith('.yml') || f.endsWith('.yaml'),
    )
  ) {
    return 'github';
  }
  if (
    existsSync(path.join(repoRoot, '.circleci', 'config.yml')) ||
    existsSync(path.join(repoRoot, '.circleci', 'config.yaml'))
  ) {
    return 'circleci';
  }
  if (existsSync(path.join(repoRoot, 'Jenkinsfile'))) return 'jenkins';
  if (existsSync(path.join(repoRoot, '.travis.yml'))) return 'travis';
  if (
    existsSync(path.join(repoRoot, '.drone.yml')) ||
    existsSync(path.join(repoRoot, '.drone.yaml'))
  ) {
    return 'drone';
  }
  if (existsSync(path.join(repoRoot, '.gitlab-ci.yml'))) return 'gitlab';
  if (existsSync(path.join(repoRoot, 'azure-pipelines.yml'))) return 'azure-devops';
  if (existsSync(path.join(repoRoot, 'bitbucket-pipelines.yml'))) return 'bitbucket';
  if (existsSync(path.join(repoRoot, '.teamcity'))) return 'teamcity';
  return null;
}

function detectMonorepo(repoRoot: string, pkg: NodePackageJson | null): boolean {
  if (existsSync(path.join(repoRoot, 'pnpm-workspace.yaml'))) return true;
  if (existsSync(path.join(repoRoot, 'lerna.json'))) return true;
  if (existsSync(path.join(repoRoot, 'nx.json'))) return true;
  if (existsSync(path.join(repoRoot, 'turbo.json'))) return true;
  if (existsSync(path.join(repoRoot, 'rush.json'))) return true;
  if (
    existsSync(path.join(repoRoot, 'WORKSPACE')) ||
    existsSync(path.join(repoRoot, 'WORKSPACE.bazel'))
  ) {
    return true;
  }
  if (existsSync(path.join(repoRoot, 'go.work'))) return true;
  if (pkg?.workspaces) return true;
  const pomXml = safeReadFile(path.join(repoRoot, 'pom.xml'));
  if (pomXml?.includes('<modules>')) return true;
  return false;
}

function detectPythonFramework(repoRoot: string): string | null {
  const blobs = [
    safeReadFile(path.join(repoRoot, 'requirements.txt')),
    safeReadFile(path.join(repoRoot, 'requirements-dev.txt')),
    safeReadFile(path.join(repoRoot, 'pyproject.toml')),
    safeReadFile(path.join(repoRoot, 'setup.cfg')),
    safeReadFile(path.join(repoRoot, 'Pipfile')),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  if (!blobs.trim()) return null;
  const ordered = [
    'django',
    'fastapi',
    'flask',
    'starlette',
    'tornado',
    'aiohttp',
    'falcon',
    'sanic',
    'litestar',
  ];
  for (const name of ordered) {
    if (blobs.includes(name)) return name;
  }
  return null;
}

function detectPythonTestFramework(repoRoot: string): string | null {
  const blobs = [
    safeReadFile(path.join(repoRoot, 'requirements.txt')),
    safeReadFile(path.join(repoRoot, 'requirements-dev.txt')),
    safeReadFile(path.join(repoRoot, 'pyproject.toml')),
    safeReadFile(path.join(repoRoot, 'setup.cfg')),
    safeReadFile(path.join(repoRoot, 'Pipfile')),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  if (
    blobs.includes('pytest') ||
    existsSync(path.join(repoRoot, 'pytest.ini')) ||
    existsSync(path.join(repoRoot, 'conftest.py'))
  ) {
    return 'pytest';
  }
  if (blobs.includes('nose2')) return 'nose2';
  if (blobs.includes('nose')) return 'nose';
  if (blobs.includes('unittest')) return 'unittest';
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
  if (lower.includes('danielgtaylor/huma')) return 'huma';
  return null;
}

function detectGoTestFramework(repoRoot: string): string | null {
  const goMod = safeReadFile(path.join(repoRoot, 'go.mod'));
  if (!goMod) return null;
  const lower = goMod.toLowerCase();
  if (lower.includes('stretchr/testify')) return 'testify';
  if (lower.includes('onsi/ginkgo') || lower.includes('onsi/gomega')) return 'ginkgo';
  // Go's standard library testing is always available
  return 'testing';
}

function detectRubyFramework(repoRoot: string): string | null {
  const gemfile = safeReadFile(path.join(repoRoot, 'Gemfile'));
  if (!gemfile) return null;
  const lower = gemfile.toLowerCase();
  if (lower.includes("'rails'") || lower.includes('"rails"')) return 'rails';
  if (lower.includes('sinatra')) return 'sinatra';
  if (lower.includes('hanami')) return 'hanami';
  if (lower.includes('grape')) return 'grape';
  if (lower.includes('padrino')) return 'padrino';
  return null;
}

function detectRubyTestFramework(repoRoot: string): string | null {
  const gemfile = safeReadFile(path.join(repoRoot, 'Gemfile'));
  if (!gemfile) return null;
  const lower = gemfile.toLowerCase();
  if (lower.includes('rspec')) return 'rspec';
  if (lower.includes('minitest')) return 'minitest';
  if (lower.includes('test-unit')) return 'test-unit';
  return null;
}

function detectJvmFramework(repoRoot: string): string | null {
  const pom = safeReadFile(path.join(repoRoot, 'pom.xml'));
  const gradle =
    safeReadFile(path.join(repoRoot, 'build.gradle')) ??
    safeReadFile(path.join(repoRoot, 'build.gradle.kts'));
  const blob = `${pom ?? ''}\n${gradle ?? ''}`.toLowerCase();
  if (!blob.trim()) return null;
  if (blob.includes('spring-boot')) return 'spring-boot';
  if (blob.includes('springframework')) return 'spring';
  if (blob.includes('io.quarkus')) return 'quarkus';
  if (blob.includes('micronaut')) return 'micronaut';
  if (blob.includes('jakarta.ws.rs') || blob.includes('javax.ws.rs')) return 'jakarta-rs';
  if (blob.includes('vertx')) return 'vert.x';
  if (blob.includes('ktor')) return 'ktor';
  return null;
}

function detectJvmTestFramework(repoRoot: string): string | null {
  const pom = safeReadFile(path.join(repoRoot, 'pom.xml'));
  const gradle =
    safeReadFile(path.join(repoRoot, 'build.gradle')) ??
    safeReadFile(path.join(repoRoot, 'build.gradle.kts'));
  const blob = `${pom ?? ''}\n${gradle ?? ''}`.toLowerCase();
  if (blob.includes('junit')) return 'junit';
  if (blob.includes('testng')) return 'testng';
  if (blob.includes('kotest')) return 'kotest';
  if (blob.includes('spock')) return 'spock';
  return null;
}

function detectRustFramework(repoRoot: string): string | null {
  const cargo = safeReadFile(path.join(repoRoot, 'Cargo.toml'));
  if (!cargo) return null;
  const lower = cargo.toLowerCase();
  if (lower.includes('actix-web')) return 'actix-web';
  if (lower.includes('axum')) return 'axum';
  if (lower.includes('rocket')) return 'rocket';
  if (lower.includes('warp')) return 'warp';
  if (lower.includes('salvo')) return 'salvo';
  if (lower.includes('poem')) return 'poem';
  return null;
}

function detectRustTestFramework(repoRoot: string): string | null {
  const cargo = safeReadFile(path.join(repoRoot, 'Cargo.toml'));
  if (!cargo) return null;
  const lower = cargo.toLowerCase();
  if (lower.includes('rstest')) return 'rstest';
  if (lower.includes('proptest')) return 'proptest';
  if (lower.includes('quickcheck')) return 'quickcheck';
  return 'rust-test'; // built-in #[test] is always available
}

function detectPhpFramework(repoRoot: string): string | null {
  const composer = safeReadJson<{
    require?: Record<string, string>;
    'require-dev'?: Record<string, string>;
  }>(path.join(repoRoot, 'composer.json'));
  if (!composer) return null;
  const keys = Object.keys({
    ...(composer.require ?? {}),
    ...(composer['require-dev'] ?? {}),
  })
    .join(' ')
    .toLowerCase();
  if (keys.includes('laravel/framework')) return 'laravel';
  if (keys.includes('symfony/framework-bundle') || keys.includes('symfony/symfony'))
    return 'symfony';
  if (keys.includes('slim/slim')) return 'slim';
  if (keys.includes('cakephp/cakephp')) return 'cakephp';
  if (keys.includes('yiisoft/yii')) return 'yii';
  if (keys.includes('codeigniter')) return 'codeigniter';
  return null;
}

function detectPhpTestFramework(repoRoot: string): string | null {
  const composer = safeReadJson<{
    require?: Record<string, string>;
    'require-dev'?: Record<string, string>;
  }>(path.join(repoRoot, 'composer.json'));
  if (!composer) return null;
  const keys = Object.keys({
    ...(composer.require ?? {}),
    ...(composer['require-dev'] ?? {}),
  })
    .join(' ')
    .toLowerCase();
  if (keys.includes('phpunit')) return 'phpunit';
  if (keys.includes('pestphp')) return 'pest';
  if (keys.includes('behat')) return 'behat';
  return null;
}

function detectDotnetFramework(repoRoot: string): string | null {
  const rootEntries = safeReaddir(repoRoot);
  const csproj = rootEntries.find((e) => e.endsWith('.csproj'));
  if (!csproj) return null;
  const content = safeReadFile(path.join(repoRoot, csproj))?.toLowerCase() ?? '';
  if (content.includes('microsoft.aspnetcore') || content.includes('microsoft.net.sdk.web')) {
    return 'aspnet-core';
  }
  if (content.includes('avalonia')) return 'avalonia';
  if (content.includes('maui')) return 'maui';
  return null;
}

function detectDotnetTestFramework(repoRoot: string): string | null {
  const rootEntries = safeReaddir(repoRoot);
  const csproj = rootEntries.find((e) => e.endsWith('.csproj'));
  if (!csproj) return null;
  const content = safeReadFile(path.join(repoRoot, csproj))?.toLowerCase() ?? '';
  if (content.includes('xunit')) return 'xunit';
  if (content.includes('nunit')) return 'nunit';
  if (content.includes('mstest')) return 'mstest';
  return null;
}

function detectSwiftFramework(repoRoot: string): string | null {
  const pkg = safeReadFile(path.join(repoRoot, 'Package.swift'));
  if (!pkg) return null;
  const lower = pkg.toLowerCase();
  if (lower.includes('vapor')) return 'vapor';
  if (lower.includes('hummingbird')) return 'hummingbird';
  if (lower.includes('kitura')) return 'kitura';
  return null;
}

function detectElixirFramework(repoRoot: string): string | null {
  const mixExs = safeReadFile(path.join(repoRoot, 'mix.exs'));
  if (!mixExs) return null;
  const lower = mixExs.toLowerCase();
  if (lower.includes(':phoenix')) return 'phoenix';
  if (lower.includes(':plug')) return 'plug';
  if (lower.includes(':absinthe')) return 'absinthe';
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
    base.push('**/__pycache__/**', '**/*.pyc', '**/.venv/**', '**/venv/**', '**/*.egg-info/**');
  }
  if (language === 'go') {
    base.push('**/vendor/**');
  }
  if (language === 'rust') {
    base.push('**/target/**');
  }
  if (language === 'java' || language === 'kotlin' || language === 'scala') {
    base.push('**/target/**', '**/.gradle/**', '**/out/**');
  }
  if (language === 'ruby') {
    base.push('**/tmp/**', '**/log/**', '**/.bundle/**');
  }
  if (language === 'php') {
    base.push('**/vendor/**', '**/storage/**');
  }
  if (language === 'csharp') {
    base.push('**/bin/**', '**/obj/**');
  }
  if (language === 'elixir') {
    base.push('**/_build/**', '**/deps/**');
  }
  if (isMonorepo) {
    base.push('**/.turbo/**', '**/.nx/**');
  }
  return [...new Set(base)].sort();
}

export const RepoProfiler = {
  detect(repoRoot: string): RepoProfile {
    const scan = scanRepo(repoRoot);
    const language = detectLanguage(scan.extensionCounts, repoRoot);

    const packageJson = safeReadJson<NodePackageJson>(path.join(repoRoot, 'package.json'));

    let framework: string | null = null;
    let testFramework: string | null = null;

    switch (language) {
      case 'typescript':
      case 'javascript':
        framework = detectNodeFramework(packageJson);
        testFramework = detectNodeTestFramework(packageJson);
        break;
      case 'python':
        framework = detectPythonFramework(repoRoot);
        testFramework = detectPythonTestFramework(repoRoot);
        break;
      case 'go':
        framework = detectGoFramework(repoRoot);
        testFramework = detectGoTestFramework(repoRoot);
        break;
      case 'ruby':
        framework = detectRubyFramework(repoRoot);
        testFramework = detectRubyTestFramework(repoRoot);
        break;
      case 'java':
      case 'kotlin':
        framework = detectJvmFramework(repoRoot);
        testFramework = detectJvmTestFramework(repoRoot);
        break;
      case 'rust':
        framework = detectRustFramework(repoRoot);
        testFramework = detectRustTestFramework(repoRoot);
        break;
      case 'php':
        framework = detectPhpFramework(repoRoot);
        testFramework = detectPhpTestFramework(repoRoot);
        break;
      case 'csharp':
        framework = detectDotnetFramework(repoRoot);
        testFramework = detectDotnetTestFramework(repoRoot);
        break;
      case 'swift':
        framework = detectSwiftFramework(repoRoot);
        break;
      case 'elixir':
        framework = detectElixirFramework(repoRoot);
        break;
    }

    const packageManager = detectPackageManager(repoRoot);
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
