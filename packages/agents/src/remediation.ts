import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { CandidateFinding, ContextBundle, ContextEntry } from '@engagement-harness/core';
import type { Provider } from '@engagement-harness/providers';

import { BaseAgent } from './base.js';
import { renderDiffSummary, renderFunctionContext } from './prompt-utils.js';
import { RemediationOutputSchema, type RemediationOutput } from './remediation-schema.js';

export { RemediationOutputSchema, type RemediationOutput } from './remediation-schema.js';

// ---------------------------------------------------------------------------
// Tech stack detection
// ---------------------------------------------------------------------------

export interface TechStack {
  language: string;
  framework: string | null;
  testRunner: string | null;
  database: 'postgresql' | 'mysql' | 'mongodb' | 'sqlite' | null;
  orm: 'prisma' | 'drizzle' | 'sequelize' | 'typeorm' | null;
  packageManager: string;
  importStyle: 'esm' | 'commonjs';
}

export function detectTechStack(context: ContextBundle): TechStack {
  const { repoProfile, entries } = context;

  const language = repoProfile.language ?? 'unknown';
  const framework = repoProfile.framework ?? null;
  const testRunner = repoProfile.testFramework ?? null;
  const packageManager = (repoProfile.packageManager as string | null) ?? 'npm';

  const pkgEntry = entries.find((e) => e.path.endsWith('package.json'));

  let database: TechStack['database'] = null;
  let orm: TechStack['orm'] = null;
  let importStyle: TechStack['importStyle'] = 'commonjs';

  if (pkgEntry) {
    let pkg: Record<string, unknown> = {};
    try {
      pkg = JSON.parse(pkgEntry.content) as Record<string, unknown>;
    } catch {
      // malformed package.json — leave all fields null/default
    }

    if (pkg['type'] === 'module') importStyle = 'esm';

    const deps: Record<string, string> = {
      ...((pkg['dependencies'] as Record<string, string> | undefined) ?? {}),
      ...((pkg['devDependencies'] as Record<string, string> | undefined) ?? {}),
    };

    // ORM (check before database so prisma can influence database too)
    if ('@prisma/client' in deps || 'prisma' in deps) orm = 'prisma';
    else if ('drizzle-orm' in deps) orm = 'drizzle';
    else if ('sequelize' in deps) orm = 'sequelize';
    else if ('typeorm' in deps) orm = 'typeorm';

    // Database
    if ('pg' in deps || '@prisma/client' in deps) database = 'postgresql';
    else if ('mysql2' in deps || 'mysql' in deps) database = 'mysql';
    else if ('mongoose' in deps || 'mongodb' in deps) database = 'mongodb';
    else if ('better-sqlite3' in deps || 'sqlite3' in deps) database = 'sqlite';
  }

  return { language, framework, testRunner, database, orm, packageManager, importStyle };
}

// ---------------------------------------------------------------------------
// Prompt helpers (private)
// ---------------------------------------------------------------------------

function getFileContent(filePath: string, entries: ContextEntry[]): string {
  const entry = entries.find((e) => e.path === filePath || e.path.endsWith(filePath));
  return entry?.content ?? '(file content not available in context)';
}

function getRelatedFiles(filePath: string, entries: ContextEntry[]): string {
  const related = entries.filter(
    (e) =>
      e.path !== filePath &&
      (e.kind === 'imports' || e.kind === 'imported-by') &&
      e.content.length > 0,
  );
  if (related.length === 0) return '(no related files in context)';
  return related
    .map((e) => `### ${e.path} [${e.kind}]\n\`\`\`\n${e.content}\n\`\`\``)
    .join('\n\n');
}

function getTestPatterns(entries: ContextEntry[]): string {
  const testEntries = entries.filter((e) => e.kind === 'test');
  if (testEntries.length === 0) return '(no existing tests in context)';
  return testEntries
    .map(
      (e) => `### ${e.path}\n\`\`\`\n${e.content.split('\n').slice(0, 30).join('\n')}\n\`\`\``,
    )
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Remediation storage helpers
// ---------------------------------------------------------------------------

const REMEDIATION_FILE = '.engagement-harness/findings/remediations.json';

export function loadRemediations(repoRoot: string): Record<string, RemediationOutput> {
  try {
    const raw = readFileSync(path.join(repoRoot, REMEDIATION_FILE), 'utf8');
    return JSON.parse(raw) as Record<string, RemediationOutput>;
  } catch {
    return {};
  }
}

export function saveRemediation(repoRoot: string, output: RemediationOutput): void {
  const filePath = path.join(repoRoot, REMEDIATION_FILE);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const existing = loadRemediations(repoRoot);
  existing[output.findingId] = output;
  writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class RemediationAgent extends BaseAgent {
  readonly id = 'remediation';
  readonly dimension = 'remediation';
  readonly description = 'Generates structured BEFORE/AFTER code patches for existing findings.';

  promptTemplate(_context: ContextBundle): string {
    // Non-finding agent — run() always yields []. Use remediate() instead.
    return '';
  }

  async remediate(
    finding: CandidateFinding,
    context: ContextBundle,
    provider: Provider,
  ): Promise<RemediationOutput> {
    const stack = detectTechStack(context);
    const fileContent = getFileContent(finding.file, context.entries);
    const relatedFiles = getRelatedFiles(finding.file, context.entries);
    const testPatterns = getTestPatterns(context.entries);

    const dbNote =
      stack.database === 'postgresql'
        ? 'DB NOTE: Use parameterized queries with $1, $2 placeholders (pg driver).'
        : stack.database === 'mysql'
          ? 'DB NOTE: Use parameterized queries with ? placeholders (mysql2 driver).'
          : stack.orm === 'prisma'
            ? 'DB NOTE: Use Prisma query builder syntax (prisma.model.findFirst({ where: {} })).'
            : stack.orm === 'drizzle'
              ? 'DB NOTE: Use Drizzle query builder syntax.'
              : '';

    const prompt = [
      `Dimension: ${this.dimension}`,
      '',
      'You are the Remediation agent for Engagement Harness.',
      'Generate a precise BEFORE/AFTER code patch for the finding below.',
      'Never generate generic advice — every fix must be specific to THIS file.',
      '',
      '## TECH STACK',
      `Language:        ${stack.language}`,
      `Framework:       ${stack.framework ?? 'none'}`,
      `Test runner:     ${stack.testRunner ?? 'none'}`,
      `Package manager: ${stack.packageManager}`,
      `Database:        ${stack.database ?? 'none'}`,
      `ORM:             ${stack.orm ?? 'none'}`,
      `Import style:    ${stack.importStyle}`,
      dbNote,
      '',
      '## FINDING',
      `ID:       ${finding.id}`,
      `Title:    ${finding.title}`,
      `Severity: ${finding.severity}`,
      `File:     ${finding.file}:${finding.lineStart}-${finding.lineEnd}`,
      `Why:      ${finding.whyItMatters}`,
      `Fix hint: ${finding.suggestedFix}`,
      '',
      '## FULL FILE CONTENT (copy exact lines into before/after)',
      `\`\`\`${stack.language}`,
      fileContent,
      '```',
      '',
      '## CHANGED FUNCTIONS',
      renderFunctionContext(context.diff, context.entries),
      '',
      '## DIFF SUMMARY',
      renderDiffSummary(context.diff),
      '',
      '## RELATED FILES',
      relatedFiles,
      '',
      '## EXISTING TEST PATTERNS',
      testPatterns,
      '',
      '## INSTRUCTIONS',
      '1. `before`: copy the EXACT lines from the file above — character-for-character, including indentation.',
      '2. `after`: minimal working replacement. MUST compile. MUST use same imports already in the file.',
      '3. `test`: a single complete, runnable test function body using the detected test runner.',
      `   Test runner syntax: ${stack.testRunner ?? 'the project test runner'}.`,
      '4. `librariesNeeded`: only list NEW packages not already present. Prefer zero new dependencies.',
      '5. `additionalFiles`: only when the fix REQUIRES changing another file.',
      '6. `riskLevel`: low=safe for valid inputs, medium=small behavior change, high=significant refactor.',
      '7. `effort`: minutes=1-5 lines, hours=moderate complexity, days=architectural change.',
      '',
      'Return a single JSON object — no markdown fences, no extra text:',
      '{',
      '  "findingId": "<string>",',
      '  "file": "<path>",',
      '  "lineStart": <number>,',
      '  "lineEnd": <number>,',
      '  "before": "<exact verbatim lines from file>",',
      '  "after": "<complete working replacement>",',
      '  "explanation": "<one clear paragraph>",',
      '  "test": "<complete runnable test function>",',
      '  "riskLevel": "low" | "medium" | "high",',
      '  "effort": "minutes" | "hours" | "days",',
      '  "librariesNeeded": [],',
      '  "additionalFiles": []',
      '}',
    ]
      .filter((line) => line !== null)
      .join('\n');

    const { content } = await provider.complete(prompt);

    const match = /\{[\s\S]*\}/.exec(content);
    if (!match) {
      throw new Error(`[remediation] could not extract JSON object from provider response`);
    }

    const parsed: unknown = JSON.parse(match[0]);
    return RemediationOutputSchema.parse(parsed);
  }
}
