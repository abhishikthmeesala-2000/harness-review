import {
  CandidateFindingSchema,
  type CandidateFinding,
  type ContextBundle,
} from '@engagement-harness/core';
import type { Provider } from '@engagement-harness/providers';
import chalk from 'chalk';

import {
  FINDING_SCHEMA_BLOCK,
  renderDiffSummary,
  renderFileContext,
  renderFunctionContext,
} from './prompt-utils.js';

/**
 * Pass 2 of the two-pass review. Reviews ALL changed files together in a single
 * pass, looking only for issues that require seeing more than one file at once.
 * Skips entirely when fewer than two files changed, and is told not to repeat
 * anything Pass 1 already reported. Findings are tagged `pass: 'integration'`.
 */
export class CrossFileReviewer {
  readonly dimension = 'integration';

  constructor(private readonly provider: Provider) {}

  async execute(
    context: ContextBundle,
    pass1Findings: CandidateFinding[],
  ): Promise<CandidateFinding[]> {
    if (context.diff.length <= 1) {
      console.log(chalk.bold('Pass 2: Skipped — only 1 file changed'));
      return [];
    }

    console.log(chalk.bold('Pass 2: Cross-file integration analysis'));

    const prompt = this.promptTemplate(context, pass1Findings);

    let raw: string;
    try {
      const result = await this.provider.complete(prompt);
      raw = result.content;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(chalk.yellow(`[cross-file] provider error: ${msg}`));
      return [];
    }

    const parsed = extractJsonArray(raw);
    if (!parsed) {
      console.warn(chalk.yellow('[cross-file] could not parse JSON array from response'));
      return [];
    }

    const accepted: CandidateFinding[] = [];
    let dropped = 0;
    for (const item of parsed) {
      const result = CandidateFindingSchema.safeParse(item);
      if (!result.success) {
        dropped++;
        continue;
      }
      accepted.push({
        ...result.data,
        sourceAgent: 'cross-file',
        modelProvider: this.provider.name,
        pass: 'integration',
      });
    }
    if (dropped > 0) {
      console.warn(
        chalk.yellow(`[cross-file] dropped ${dropped} malformed candidate(s) from response`),
      );
    }

    console.log(chalk.dim(`Pass 2 complete: ${accepted.length} integration findings`));
    return accepted;
  }

  promptTemplate(context: ContextBundle, pass1Findings: CandidateFinding[]): string {
    return [
      'You are the Cross-File Integration reviewer for the Engagement Harness.',
      `Dimension: ${this.dimension}`,
      '',
      'ROLE',
      'You see ALL changed files TOGETHER. Report ONLY issues that are invisible when',
      'reviewing any single file in isolation — issues that require seeing two or more',
      'files at once. Be CONSERVATIVE.',
      '',
      'CROSS-FILE PATTERNS TO LOOK FOR',
      '',
      'PATTERN 1: API CONTRACT MISMATCHES',
      '// file-a.ts calls:   processUser({ id: "123", name: "Alice" })',
      '// file-b.ts defines:  function processUser(user: { id: number, name: string })',
      '// id is string in caller, number in definition — invisible when reviewing either file alone',
      '',
      'PATTERN 2: MISSING ERROR PROPAGATION',
      '// service.ts throws:     throw new NotFoundError(`User ${id} not found`)',
      '// controller.ts calls but never catches NotFoundError:',
      '//   const user = await userService.getUser(id)',
      '//   res.json(user)   // crashes with 500 if user not found',
      '',
      'PATTERN 3: INCONSISTENT PATTERNS IN SAME PR',
      '// user-service.ts (in this PR) validates carefully:',
      "//   if (!id || typeof id !== 'string') throw new ValidationError()",
      '//   const sanitized = sanitize(id)',
      '// order-service.ts (also in this PR) skips validation:',
      '//   async getOrder(id) { return db.query(`SELECT * WHERE id = ${id}`) } // no validation',
      '',
      'PATTERN 4: ARCHITECTURAL VIOLATIONS',
      '// domain/user.ts imports infrastructure:',
      "//   import { db } from '../infrastructure/database'",
      "//   import { redis } from '../infrastructure/cache'",
      '// Domain layer should not depend on infrastructure layer',
      '',
      'PATTERN 5: SHARED STATE MUTATIONS',
      '// file-a.ts mutates global config:  config.settings.timeout = 5000',
      '// file-b.ts also mutates same global: config.settings.timeout = 3000 // overrides file-a',
      '',
      'CONSERVATIVE RULES',
      '- ONLY report if BOTH (or more) files are needed to see the issue.',
      '- Quote specific lines from EACH file involved as evidence.',
      '- Do NOT re-report anything in ALREADY-REPORTED FINDINGS below.',
      '- Choose the closest existing category: correctness | security | testing | domain-policy | design | data | observability | intent-gap.',
      '- If you find nothing that spans multiple files, return [].',
      '',
      'ALREADY-REPORTED FINDINGS (Pass 1 — do NOT repeat these):',
      renderPass1Summary(pass1Findings),
      '',
      'DIFF (what changed across all files):',
      renderDiffSummary(context.diff),
      '',
      'CHANGED FUNCTIONS (full bodies containing each diff hunk):',
      renderFunctionContext(context.diff, context.entries),
      '',
      'FULL FILE CONTEXT (all changed files and their neighbors):',
      renderFileContext(context.entries),
      '',
      FINDING_SCHEMA_BLOCK,
    ].join('\n');
  }
}

function renderPass1Summary(findings: CandidateFinding[]): string {
  if (findings.length === 0) return '(none)';
  return findings.map((f) => `- [${f.severity}] ${f.title} (${f.file}:${f.lineStart})`).join('\n');
}

function extractJsonArray(raw: string): unknown[] | null {
  const trimmed = raw.trim();
  try {
    const direct: unknown = JSON.parse(trimmed);
    if (Array.isArray(direct)) return direct;
  } catch {
    // fall through to substring extraction
  }
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
