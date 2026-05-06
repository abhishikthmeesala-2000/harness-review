import { AgentOrchestrator } from '@engagement-harness/agents';
import chalk from 'chalk';

export function agentsListCommand(): void {
  const agents = new AgentOrchestrator().listAgents().sort((a, b) => a.id.localeCompare(b.id));
  console.log(chalk.bold(`Registered agents (${agents.length}):\n`));
  for (const a of agents) {
    console.log(
      `  ${chalk.cyan(a.id.padEnd(22))}${chalk.dim(a.dimension.padEnd(16))}${a.description}`,
    );
  }
}
