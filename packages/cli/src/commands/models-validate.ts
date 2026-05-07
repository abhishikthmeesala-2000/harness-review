import { ConfigLoader } from '@engagement-harness/core';
import chalk from 'chalk';

const KNOWN_PROVIDERS: Record<string, () => boolean> = {
  mock: () => true,
  openai: () => Boolean(process.env['OPENAI_API_KEY']),
  anthropic: () => Boolean(process.env['ANTHROPIC_API_KEY']),
};

export function modelsValidateCommand(): void {
  const repoRoot = process.cwd();

  if (!ConfigLoader.exists(repoRoot)) {
    console.error(chalk.red('No config found. Run `engagement-harness init` first.'));
    process.exit(1);
    return;
  }

  const config = ConfigLoader.load(repoRoot);
  const enabledAgents = config.agents.enabled;

  if (enabledAgents.length === 0) {
    console.log(chalk.yellow('No agents enabled in config.'));
    return;
  }

  console.log(chalk.bold('Provider routing validation:\n'));

  let hasErrors = false;

  for (const agentId of enabledAgents) {
    const provider = config.models[agentId] ?? 'mock';
    const checkFn = KNOWN_PROVIDERS[provider];

    if (!checkFn) {
      // Unknown provider — error
      console.log(
        `  ${chalk.red('✗')} ${agentId.padEnd(22)} → ${provider}  ${chalk.red('(unknown provider)')}`,
      );
      hasErrors = true;
    } else if (checkFn()) {
      // Provider available
      console.log(
        `  ${chalk.green('✓')} ${agentId.padEnd(22)} → ${provider}`,
      );
    } else {
      // Provider needs key — warn, don't fail
      const envVar = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
      console.log(
        `  ${chalk.yellow('⚠')} ${agentId.padEnd(22)} → ${provider}  ${chalk.yellow(`(set ${envVar} to activate)`)}`,
      );
    }
  }

  if (hasErrors) {
    console.log('');
    console.log(chalk.red('Validation failed: unknown providers detected.'));
    process.exit(1);
  } else {
    console.log('');
    console.log(chalk.green('All agent provider routes validated.'));
  }
}
