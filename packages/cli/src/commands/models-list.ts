import { ConfigLoader } from '@engagement-harness/core';
import chalk from 'chalk';

export function modelsListCommand(): void {
  const repoRoot = process.cwd();
  console.log(chalk.bold('Registered providers:\n'));

  // Print providers: mock (always available), openai (needs OPENAI_API_KEY), anthropic (needs ANTHROPIC_API_KEY)
  const providers = [
    { name: 'mock', status: 'available', note: 'Default — no API key required' },
    {
      name: 'openai',
      status: process.env['OPENAI_API_KEY'] ? 'available' : 'needs-key',
      note: 'Set OPENAI_API_KEY',
    },
    {
      name: 'anthropic',
      status: process.env['ANTHROPIC_API_KEY'] ? 'available' : 'needs-key',
      note: 'Set ANTHROPIC_API_KEY',
    },
  ];

  for (const p of providers) {
    const icon = p.status === 'available' ? chalk.green('✓') : chalk.yellow('⚠');
    console.log(`  ${icon} ${p.name.padEnd(12)} ${p.note}`);
  }

  if (ConfigLoader.exists(repoRoot)) {
    const config = ConfigLoader.load(repoRoot);
    console.log(chalk.bold('\nAgent routing:\n'));
    for (const agentId of config.agents.enabled) {
      const provider = config.models[agentId] ?? 'mock';
      console.log(`  ${agentId.padEnd(22)} → ${provider}`);
    }
  }
}
