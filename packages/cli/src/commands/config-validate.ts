import {
  ConfigInvalidError,
  ConfigLoader,
  ConfigNotFoundError,
  DEFAULT_AGENT_IDS,
} from '@engagement-harness/core';
import chalk from 'chalk';
import { CliError } from '../utils/errors.js';

export interface ConfigValidateOptions {
  cwd?: string;
}

const VALID_PROVIDERS = ['anthropic', 'openai', 'mock'];

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // flat row buffer — previous row and current row
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i, ...Array<number>(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? (prev[j - 1] ?? 0)
          : 1 + Math.min(prev[j] ?? 0, curr[j - 1] ?? 0, prev[j - 1] ?? 0);
    }
    prev = curr;
  }
  return prev[n] ?? 0;
}

function didYouMean(input: string, candidates: string[]): string | null {
  const best = candidates
    .map((c) => ({ c, d: levenshtein(input.toLowerCase(), c.toLowerCase()) }))
    .filter((x) => x.d <= 3)
    .sort((a, b) => a.d - b.d)[0];
  return best?.c ?? null;
}

export function configValidateCommand(options: ConfigValidateOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  let hasErrors = false;

  try {
    const config = ConfigLoader.load(cwd);
    console.log(chalk.green('✓') + ' Config is valid.');
    console.log(`  client: ${config.client.name} / ${config.client.engagement}`);
    console.log(`  agents enabled: ${config.agents.enabled.length}`);

    // Semantic checks (warnings — don't throw)
    const agentIds = [...DEFAULT_AGENT_IDS] as readonly string[];

    for (const id of config.agents.enabled) {
      if (!agentIds.includes(id)) {
        const suggestion = didYouMean(id, [...agentIds]);
        console.warn(chalk.yellow('⚠') + ` agents.enabled contains "${id}" — unknown agent`);
        if (suggestion) {
          console.warn(chalk.dim(`    Did you mean "${suggestion}"?`));
        }
        console.warn(chalk.dim(`    Known agents: ${agentIds.join(' · ')}`));
      }
    }

    for (const [agent, provider] of Object.entries(config.models)) {
      if (!agentIds.includes(agent)) {
        const suggestion = didYouMean(agent, [...agentIds]);
        console.warn(chalk.yellow('⚠') + ` models."${agent}" is not a known agent ID`);
        if (suggestion) console.warn(chalk.dim(`    Did you mean "${suggestion}"?`));
      }
      if (!VALID_PROVIDERS.includes(provider)) {
        const suggestion = didYouMean(provider, VALID_PROVIDERS);
        console.error(chalk.red('✗') + ` models.${agent} is "${provider}" — not a valid provider`);
        if (suggestion) {
          console.error(chalk.dim(`    Did you mean "${suggestion}"?`));
        }
        console.error(chalk.dim(`    Valid values: ${VALID_PROVIDERS.join(' · ')}`));
        hasErrors = true;
      }
    }
  } catch (err) {
    if (err instanceof ConfigNotFoundError) {
      console.error(chalk.red('✗') + ` Config not found at ${err.configPath}`);
      console.error('  Run `engagement-harness init` to create one.');
      throw new CliError('config not found', 1);
    }
    if (err instanceof ConfigInvalidError) {
      console.error(chalk.red('✗') + ` Config invalid at ${err.configPath}:`);
      for (const issue of err.issues) {
        console.error(`  - ${issue.path || '(root)'}: ${issue.message}`);
      }
      throw new CliError('config invalid', 1);
    }
    throw err;
  }

  if (hasErrors) {
    throw new CliError('config has invalid values', 1);
  }
}
