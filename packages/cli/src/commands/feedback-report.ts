import { FeedbackStore } from '@engagement-harness/feedback';
import chalk from 'chalk';

export interface FeedbackReportOptions {
  format?: string;
}

export async function feedbackReportCommand(options: FeedbackReportOptions): Promise<void> {
  const store = new FeedbackStore();
  const metrics = store.loadMetrics();

  if (!metrics) {
    console.log(chalk.yellow('No feedback metrics found. Run `feedback collect` first.'));
    return;
  }

  if (options.format === 'json') {
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }

  console.log(chalk.bold('Feedback Report'));
  console.log(`Last updated: ${metrics.lastUpdated}`);
  console.log(`Total entries: ${metrics.totalEntries}`);
  console.log('');

  console.log(chalk.bold('By state:'));
  for (const [state, count] of Object.entries(metrics.byState)) {
    if ((count ?? 0) > 0) {
      console.log(`  ${state}: ${count}`);
    }
  }

  if (Object.keys(metrics.byAgent).length > 0) {
    console.log('');
    console.log(chalk.bold('By agent:'));
    for (const [agent, m] of Object.entries(metrics.byAgent)) {
      const acc = (m.acceptanceRate * 100).toFixed(0);
      const fp = (m.falsePositiveRate * 100).toFixed(0);
      console.log(`  ${agent}: ${m.totalFindings} findings — acceptance: ${acc}%, false_positive: ${fp}%`);
    }
  }
}
