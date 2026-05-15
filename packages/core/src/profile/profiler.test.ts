import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepoProfiler } from './profiler.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'eh-prof-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

// ── Node / TypeScript ──────────────────────────────────────────────────────────

describe('RepoProfiler', () => {
  it('detects a TypeScript pnpm Node fixture', () => {
    write(
      'package.json',
      JSON.stringify({
        name: 'demo',
        dependencies: { express: '^4.0.0' },
        devDependencies: { vitest: '^2.0.0' },
      }),
    );
    write('pnpm-lock.yaml', 'lockfileVersion: 9');
    write('src/index.ts', 'export const a = 1;');
    write('src/util.ts', 'export const b = 2;');
    write('tests/index.test.ts', 'test()');
    write('.github/workflows/ci.yml', 'name: CI');

    const p = RepoProfiler.detect(dir);

    expect(p.language).toBe('typescript');
    expect(p.framework).toBe('express');
    expect(p.testFramework).toBe('vitest');
    expect(p.packageManager).toBe('pnpm');
    expect(p.ciProvider).toBe('github');
    expect(p.isMonorepo).toBe(false);
    expect(p.importantPaths).toEqual(expect.arrayContaining(['src', 'tests']));
    expect(p.suggestedIgnoredPaths).toEqual(
      expect.arrayContaining(['**/node_modules/**', '**/dist/**']),
    );
  });

  it('detects tsconfig.json as strong TypeScript signal even with many .js config files', () => {
    write('tsconfig.json', '{}');
    write('webpack.config.js', 'module.exports = {}');
    write('babel.config.js', 'module.exports = {}');
    write('jest.config.js', 'module.exports = {}');
    write('src/index.ts', 'export {};');
    write('package.json', JSON.stringify({ name: 'x', devDependencies: { jest: '^29' } }));
    write('package-lock.json', '{}');

    const p = RepoProfiler.detect(dir);
    expect(p.language).toBe('typescript');
    expect(p.testFramework).toBe('jest');
  });

  it('does not count .d.ts declaration files toward TypeScript source count', () => {
    write('jsconfig.json', '{}');
    write('src/types.d.ts', 'export type Foo = string;');
    write('src/types2.d.ts', 'export type Bar = number;');
    write('src/index.js', 'const x = 1;');
    write('package-lock.json', '{}');
    write('package.json', JSON.stringify({ name: 'x' }));

    const p = RepoProfiler.detect(dir);
    expect(p.language).toBe('javascript');
  });

  it('detects Next.js', () => {
    write('package.json', JSON.stringify({ dependencies: { next: '^14.0.0', react: '^18.0.0' } }));
    write('pnpm-lock.yaml', '');
    write('tsconfig.json', '{}');
    write('app/page.tsx', 'export default function Page() {}');

    const p = RepoProfiler.detect(dir);
    expect(p.framework).toBe('next');
  });

  it('detects NestJS', () => {
    write(
      'package.json',
      JSON.stringify({
        dependencies: { '@nestjs/core': '^10.0.0' },
        devDependencies: { jest: '^29' },
      }),
    );
    write('pnpm-lock.yaml', '');
    write('tsconfig.json', '{}');

    const p = RepoProfiler.detect(dir);
    expect(p.framework).toBe('@nestjs/core');
    expect(p.testFramework).toBe('jest');
  });

  it('detects Hono + bun', () => {
    write('package.json', JSON.stringify({ dependencies: { hono: '^4.0.0' } }));
    write('bun.lockb', '');
    write('src/index.ts', '');
    write('tsconfig.json', '{}');

    const p = RepoProfiler.detect(dir);
    expect(p.framework).toBe('hono');
    expect(p.packageManager).toBe('bun');
  });

  it('detects yarn from yarn.lock', () => {
    write('package.json', JSON.stringify({ name: 'x' }));
    write('yarn.lock', '# yarn lockfile v1');
    write('tsconfig.json', '{}');
    write('src/a.ts', '');

    const p = RepoProfiler.detect(dir);
    expect(p.packageManager).toBe('yarn');
  });

  // ── Python ──────────────────────────────────────────────────────────────────

  it('detects a Python + pytest fixture', () => {
    write('requirements.txt', 'flask==2.0.0\npytest==7.0.0\n');
    write('app/__init__.py', '');
    write('app/main.py', 'print("hi")\n');
    write('tests/test_main.py', 'def test(): pass');

    const p = RepoProfiler.detect(dir);

    expect(p.language).toBe('python');
    expect(p.framework).toBe('flask');
    expect(p.testFramework).toBe('pytest');
    expect(p.packageManager).toBe('pip');
    expect(p.ciProvider).toBeNull();
    expect(p.isMonorepo).toBe(false);
    expect(p.suggestedIgnoredPaths).toEqual(expect.arrayContaining(['**/__pycache__/**']));
  });

  it('detects FastAPI + poetry', () => {
    write('pyproject.toml', '[tool.poetry.dependencies]\nfastapi = "*"\npytest = "*"\n');
    write('poetry.lock', '');
    write('app/main.py', '');

    const p = RepoProfiler.detect(dir);
    expect(p.language).toBe('python');
    expect(p.framework).toBe('fastapi');
    expect(p.testFramework).toBe('pytest');
    expect(p.packageManager).toBe('poetry');
  });

  it('detects Django', () => {
    write('requirements.txt', 'django>=4.2\n');
    write('manage.py', '');
    write('app/models.py', '');

    const p = RepoProfiler.detect(dir);
    expect(p.framework).toBe('django');
  });

  it('detects uv from uv.lock', () => {
    write('uv.lock', '');
    write('pyproject.toml', '[project]\nname = "x"');
    write('src/main.py', '');

    const p = RepoProfiler.detect(dir);
    expect(p.packageManager).toBe('uv');
  });

  it('detects pytest from conftest.py alone', () => {
    write('conftest.py', '');
    write('app/main.py', '');
    write('pyproject.toml', '[project]\nname = "x"');

    const p = RepoProfiler.detect(dir);
    expect(p.testFramework).toBe('pytest');
  });

  // ── Go ──────────────────────────────────────────────────────────────────────

  it('detects a Go modules fixture', () => {
    write(
      'go.mod',
      'module example.com/demo\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.9.0\n',
    );
    write('main.go', 'package main\nfunc main() {}\n');
    write('handler.go', 'package main\n');
    write('.gitlab-ci.yml', 'stages: []');

    const p = RepoProfiler.detect(dir);

    expect(p.language).toBe('go');
    expect(p.framework).toBe('gin');
    expect(p.packageManager).toBe('go');
    expect(p.ciProvider).toBe('gitlab');
    expect(p.isMonorepo).toBe(false);
  });

  it('detects Go testify test framework', () => {
    write(
      'go.mod',
      'module example.com/demo\n\ngo 1.22\n\nrequire github.com/stretchr/testify v1.8.0\n',
    );
    write('main.go', 'package main\n');

    const p = RepoProfiler.detect(dir);
    expect(p.testFramework).toBe('testify');
  });

  it('detects Go built-in testing when no extra framework present', () => {
    write('go.mod', 'module example.com/demo\n\ngo 1.22\n');
    write('main.go', 'package main\n');

    const p = RepoProfiler.detect(dir);
    expect(p.testFramework).toBe('testing');
  });

  it('detects chi router', () => {
    write(
      'go.mod',
      'module example.com/demo\n\ngo 1.22\n\nrequire github.com/go-chi/chi v5.0.0\n',
    );
    write('main.go', 'package main\n');

    const p = RepoProfiler.detect(dir);
    expect(p.framework).toBe('chi');
  });

  it('detects Go workspace as monorepo', () => {
    write('go.work', 'go 1.22\nuse ./service-a\nuse ./service-b\n');
    write('service-a/go.mod', 'module example.com/a\n\ngo 1.22\n');
    write('service-a/main.go', 'package main\n');

    const p = RepoProfiler.detect(dir);
    expect(p.isMonorepo).toBe(true);
  });

  // ── Ruby ────────────────────────────────────────────────────────────────────

  it('detects Ruby + Rails + RSpec', () => {
    write(
      'Gemfile',
      "source 'https://rubygems.org'\ngem 'rails', '~> 7.0'\ngem 'rspec-rails'\n",
    );
    write('Gemfile.lock', '');
    write('app/controllers/application_controller.rb', '');
    write('spec/spec_helper.rb', '');

    const p = RepoProfiler.detect(dir);
    expect(p.language).toBe('ruby');
    expect(p.framework).toBe('rails');
    expect(p.testFramework).toBe('rspec');
    expect(p.packageManager).toBe('bundler');
  });

  it('detects Sinatra + Minitest', () => {
    write('Gemfile', "gem 'sinatra'\ngem 'minitest'\n");
    write('app.rb', '');

    const p = RepoProfiler.detect(dir);
    expect(p.framework).toBe('sinatra');
    expect(p.testFramework).toBe('minitest');
  });

  // ── Java / Kotlin ────────────────────────────────────────────────────────────

  it('detects Java + Spring Boot + JUnit via pom.xml', () => {
    write(
      'pom.xml',
      '<project><dependencies>'
        + '<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter</artifactId></dependency>'
        + '<dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId></dependency>'
        + '</dependencies></project>',
    );
    write('src/main/java/App.java', 'public class App {}');

    const p = RepoProfiler.detect(dir);
    expect(p.language).toBe('java');
    expect(p.framework).toBe('spring-boot');
    expect(p.testFramework).toBe('junit');
    expect(p.packageManager).toBe('maven');
  });

  it('detects Kotlin + Ktor via build.gradle.kts', () => {
    write(
      'build.gradle.kts',
      'implementation("io.ktor:ktor-server-core:2.3.0")\ntestImplementation("io.mockk:mockk:1.13.0")',
    );
    write('src/main/kotlin/App.kt', '');

    const p = RepoProfiler.detect(dir);
    expect(p.language).toBe('kotlin');
    expect(p.framework).toBe('ktor');
    expect(p.packageManager).toBe('gradle');
  });

  it('detects Maven multi-module as monorepo', () => {
    write('pom.xml', '<project><modules><module>service-a</module></modules></project>');
    write('service-a/src/main/java/App.java', 'public class App {}');

    const p = RepoProfiler.detect(dir);
    expect(p.isMonorepo).toBe(true);
  });

  // ── Rust ────────────────────────────────────────────────────────────────────

  it('detects Rust + Axum + rstest', () => {
    write(
      'Cargo.toml',
      '[package]\nname = "demo"\n\n[dependencies]\naxum = "0.7"\n\n[dev-dependencies]\nrstest = "0.18"\n',
    );
    write('src/main.rs', 'fn main() {}');

    const p = RepoProfiler.detect(dir);
    expect(p.language).toBe('rust');
    expect(p.framework).toBe('axum');
    expect(p.testFramework).toBe('rstest');
    expect(p.packageManager).toBe('cargo');
    expect(p.suggestedIgnoredPaths).toEqual(expect.arrayContaining(['**/target/**']));
  });

  it('detects Rust built-in test framework when no extra crate present', () => {
    write('Cargo.toml', '[package]\nname = "demo"\n\n[dependencies]\n');
    write('src/lib.rs', '#[test]\nfn it_works() {}');

    const p = RepoProfiler.detect(dir);
    expect(p.testFramework).toBe('rust-test');
  });

  it('detects Actix-web', () => {
    write('Cargo.toml', '[package]\nname = "demo"\n\n[dependencies]\nactix-web = "4"\n');
    write('src/main.rs', '');

    const p = RepoProfiler.detect(dir);
    expect(p.framework).toBe('actix-web');
  });

  // ── PHP ─────────────────────────────────────────────────────────────────────

  it('detects PHP + Laravel + PHPUnit', () => {
    write(
      'composer.json',
      JSON.stringify({
        require: { 'laravel/framework': '^11.0' },
        'require-dev': { 'phpunit/phpunit': '^10.0' },
      }),
    );
    write('composer.lock', '{}');
    write('app/Http/Controllers/Controller.php', '<?php');

    const p = RepoProfiler.detect(dir);
    expect(p.language).toBe('php');
    expect(p.framework).toBe('laravel');
    expect(p.testFramework).toBe('phpunit');
    expect(p.packageManager).toBe('composer');
  });

  it('detects Symfony + Pest', () => {
    write(
      'composer.json',
      JSON.stringify({
        require: { 'symfony/framework-bundle': '^7.0' },
        'require-dev': { 'pestphp/pest': '^2.0' },
      }),
    );
    write('src/Controller/HomeController.php', '<?php');

    const p = RepoProfiler.detect(dir);
    expect(p.framework).toBe('symfony');
    expect(p.testFramework).toBe('pest');
  });

  // ── C# / .NET ────────────────────────────────────────────────────────────────

  it('detects C# + ASP.NET Core + xUnit from .csproj', () => {
    write(
      'MyApp.csproj',
      '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>'
        + '<ItemGroup><PackageReference Include="xunit" Version="2.6.0" /></ItemGroup></Project>',
    );
    write('Program.cs', 'using Microsoft.AspNetCore.Builder;');
    write('Controllers/HomeController.cs', 'public class HomeController {}');

    const p = RepoProfiler.detect(dir);
    expect(p.language).toBe('csharp');
    expect(p.framework).toBe('aspnet-core');
    expect(p.testFramework).toBe('xunit');
    expect(p.packageManager).toBe('nuget');
  });

  // ── Swift ─────────────────────────────────────────────────────────────────────

  it('detects Swift + Vapor', () => {
    write(
      'Package.swift',
      '// swift-tools-version:5.9\nimport PackageDescription\nlet package = Package(name: "App", dependencies: [.package(url: "https://github.com/vapor/vapor.git", from: "4.0.0")])',
    );
    write('Sources/App/main.swift', 'import Vapor');

    const p = RepoProfiler.detect(dir);
    expect(p.language).toBe('swift');
    expect(p.framework).toBe('vapor');
    expect(p.packageManager).toBe('spm');
  });

  // ── Elixir ────────────────────────────────────────────────────────────────────

  it('detects Elixir + Phoenix', () => {
    write(
      'mix.exs',
      'defmodule MyApp.MixProject do\n  def deps do\n    [{:phoenix, "~> 1.7"}]\n  end\nend',
    );
    write('lib/my_app.ex', 'defmodule MyApp do end');
    write('lib/my_app_web.ex', 'defmodule MyAppWeb do end');

    const p = RepoProfiler.detect(dir);
    expect(p.language).toBe('elixir');
    expect(p.framework).toBe('phoenix');
    expect(p.packageManager).toBe('mix');
    expect(p.suggestedIgnoredPaths).toEqual(
      expect.arrayContaining(['**/_build/**', '**/deps/**']),
    );
  });

  // ── CI providers ─────────────────────────────────────────────────────────────

  it('detects CircleCI', () => {
    write('.circleci/config.yml', 'version: 2.1');
    write('src/index.ts', '');
    write('tsconfig.json', '{}');

    const p = RepoProfiler.detect(dir);
    expect(p.ciProvider).toBe('circleci');
  });

  it('detects Jenkins', () => {
    write('Jenkinsfile', 'pipeline { agent any }');
    write('src/index.ts', '');
    write('tsconfig.json', '{}');

    const p = RepoProfiler.detect(dir);
    expect(p.ciProvider).toBe('jenkins');
  });

  it('detects Travis CI', () => {
    write('.travis.yml', 'language: node_js');
    write('src/index.ts', '');
    write('tsconfig.json', '{}');

    const p = RepoProfiler.detect(dir);
    expect(p.ciProvider).toBe('travis');
  });

  it('detects Drone CI', () => {
    write('.drone.yml', 'kind: pipeline');
    write('src/index.ts', '');
    write('tsconfig.json', '{}');

    const p = RepoProfiler.detect(dir);
    expect(p.ciProvider).toBe('drone');
  });

  it('prefers GitHub over other CI when both present', () => {
    write('.github/workflows/ci.yml', 'name: CI');
    write('.travis.yml', 'language: node_js');
    write('src/index.ts', '');
    write('tsconfig.json', '{}');

    const p = RepoProfiler.detect(dir);
    expect(p.ciProvider).toBe('github');
  });

  // ── Monorepo ──────────────────────────────────────────────────────────────────

  it('detects a pnpm monorepo fixture', () => {
    write('pnpm-workspace.yaml', 'packages:\n  - "packages/*"');
    write('pnpm-lock.yaml', 'lockfileVersion: 9');
    write('package.json', JSON.stringify({ name: 'mono' }));
    write('packages/a/package.json', JSON.stringify({ name: 'a' }));
    write('packages/a/src/index.ts', 'export {};');
    write('packages/b/package.json', JSON.stringify({ name: 'b' }));
    write('packages/b/src/index.ts', 'export {};');

    const p = RepoProfiler.detect(dir);

    expect(p.language).toBe('typescript');
    expect(p.packageManager).toBe('pnpm');
    expect(p.isMonorepo).toBe(true);
  });

  it('detects Rush monorepo', () => {
    write('rush.json', '{"rushVersion": "5.0.0", "projects": []}');
    write('apps/api/src/index.ts', '');
    write('tsconfig.json', '{}');

    const p = RepoProfiler.detect(dir);
    expect(p.isMonorepo).toBe(true);
  });

  it('detects Bazel WORKSPACE as monorepo', () => {
    write('WORKSPACE', 'workspace(name = "my_repo")');
    write('src/main.py', '');
    write('requirements.txt', 'flask');

    const p = RepoProfiler.detect(dir);
    expect(p.isMonorepo).toBe(true);
  });

  // ── importantPaths ────────────────────────────────────────────────────────────

  it('collects important paths at depth 0 and depth 1', () => {
    write('packages/api/src/index.ts', '');
    write('packages/cli/src/index.ts', '');
    write('docs/README.md', '');
    write('tsconfig.json', '{}');
    write('pnpm-lock.yaml', '');
    write('package.json', JSON.stringify({ name: 'mono' }));

    const p = RepoProfiler.detect(dir);
    expect(p.importantPaths).toEqual(expect.arrayContaining(['docs', 'packages']));
    expect(p.importantPaths).toEqual(
      expect.arrayContaining(['packages/api/src', 'packages/cli/src']),
    );
  });

  // ── Edge cases ────────────────────────────────────────────────────────────────

  it('returns nullable fields without throwing on a near-empty repo', () => {
    write('README.md', '# hi');
    const p = RepoProfiler.detect(dir);
    expect(p.language).toBeNull();
    expect(p.framework).toBeNull();
    expect(p.packageManager).toBeNull();
    expect(p.testFramework).toBeNull();
    expect(p.ciProvider).toBeNull();
    expect(p.isMonorepo).toBe(false);
    expect(p.importantPaths).toEqual([]);
  });

  it('skips node_modules and .git when scanning', () => {
    write('package.json', JSON.stringify({ name: 'x' }));
    write('node_modules/junk/index.js', 'module.exports = {};');
    write('.git/config', '[core]');
    write('src/index.ts', 'export {};');
    const p = RepoProfiler.detect(dir);
    expect(p.language).toBe('typescript');
  });
});
