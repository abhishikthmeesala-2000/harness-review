import { ConfigInvalidError, ConfigLoader, ConfigNotFoundError } from '@engagement-harness/core';
import chalk from 'chalk';
import { CliError } from '../utils/errors.js';

export interface ConfigValidateOptions {
  cwd?: string;
}

export function configValidateCommand(options: ConfigValidateOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  try {
    const config = ConfigLoader.load(cwd);
    console.log(chalk.green('✓') + ' Config is valid.');
    console.log(`  client: ${config.client.name} / ${config.client.engagement}`);
    console.log(`  agents enabled: ${config.agents.enabled.length}`);
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
}
