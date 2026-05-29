import type {
  CandidateFinding,
  Config,
  ContextBundle,
  ContextEntry,
} from '@engagement-harness/core';
import chalk from 'chalk';

import type { AgentOrchestrator } from './orchestrator.js';

/**
 * Pass 1 of the two-pass review. Wraps an existing {@link AgentOrchestrator} and
 * runs it once per changed file — each invocation sees a ContextBundle containing
 * only that single file (plus the shared rule entries), so the agents give every
 * file their full attention instead of diluting it across the whole diff.
 *
 * The 9 agents are unchanged; only the context they receive is narrowed. All
 * files run concurrently via Promise.all, and every finding is tagged
 * `pass: 'local'`.
 */
export class PerFileOrchestrator {
  constructor(private readonly orchestrator: AgentOrchestrator) {}

  async execute(context: ContextBundle, config: Config): Promise<CandidateFinding[]> {
    const files = context.diff;
    console.log(
      chalk.bold(`Pass 1: Per-file analysis (${files.length} files) — running in parallel`),
    );
    for (const file of files) {
      console.log(`  → ${file.path}`);
    }

    const ruleEntries = context.entries.filter((e) => e.kind === 'rule');

    const perFile = await Promise.all(
      files.map(async (file) => {
        const singleFileContext: ContextBundle = {
          ...context,
          diff: [file],
          entries: buildSingleFileEntries(context.entries, ruleEntries, file.path),
        };
        const candidates = await this.orchestrator.run(singleFileContext, config);
        return candidates.map((c) => ({ ...c, pass: 'local' as const }));
      }),
    );

    const findings = perFile.flat();
    console.log(chalk.dim(`Pass 1 complete: ${findings.length} candidate findings`));
    return findings;
  }
}

/**
 * Entries scoped to a single file: every shared rule entry (domain policy still
 * applies per file) plus any file-context entry whose path matches the changed
 * file (changed-file/imports/imported-by/test).
 */
function buildSingleFileEntries(
  allEntries: ContextEntry[],
  ruleEntries: ContextEntry[],
  filePath: string,
): ContextEntry[] {
  const fileEntries = allEntries.filter((e) => e.kind !== 'rule' && e.path === filePath);
  return [...ruleEntries, ...fileEntries];
}
