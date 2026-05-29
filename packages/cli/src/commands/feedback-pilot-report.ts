import { FeedbackStore, MetricsCalculator } from '@engagement-harness/feedback';
import chalk from 'chalk';

export interface FeedbackPilotReportOptions {
  days?: number;
}

const FP_TARGET = 0.2;

export async function feedbackPilotReportCommand(
  options: FeedbackPilotReportOptions,
): Promise<void> {
  const days = options.days && options.days > 0 ? options.days : 14;
  const store = new FeedbackStore();
  const all = store.loadAllFeedback();

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const items = all.filter((item) => {
    const t = Date.parse(item.timestamp);
    return Number.isFinite(t) ? t >= cutoff : true;
  });

  const calculator = new MetricsCalculator();
  const metrics = calculator.calculate(items);

  const prsReviewed = new Set(items.map((i) => i.prNumber)).size;
  const total = metrics.totalEntries;
  const accepted = metrics.byState.accepted ?? 0;
  const falsePositives = metrics.byState.false_positive ?? 0;
  const acceptanceRate = total > 0 ? accepted / total : 0;
  const fpRate = total > 0 ? falsePositives / total : 0;
  const fpFlag = fpRate <= FP_TARGET ? '✅' : '⚠️';

  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
  const pct0 = (n: number): string => `${(n * 100).toFixed(0)}%`;

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║          ENGAGEMENT HARNESS PILOT REPORT       ║');
  console.log(`║                ${String(days).padStart(2)}-Day Summary                  ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log(chalk.bold('📊 Overall Metrics:'));
  console.log(`   PRs Reviewed:        ${prsReviewed}`);
  console.log(`   Findings:            ${total}`);
  console.log(`   Acceptance Rate:     ${pct(acceptanceRate)}`);
  console.log(`   False Positive Rate: ${pct(fpRate)} ${fpFlag}`);
  console.log('');

  if (Object.keys(metrics.byAgent).length > 0) {
    console.log(chalk.bold('🤖 By Agent:'));
    for (const [agent, m] of Object.entries(metrics.byAgent)) {
      const flag = m.falsePositiveRate <= FP_TARGET ? '✅' : '⚠️';
      console.log(
        `   ${agent.padEnd(20)} Acceptance: ${pct0(m.acceptanceRate).padStart(4)}   FP: ${pct0(m.falsePositiveRate).padStart(4)} ${flag}`,
      );
    }
    console.log('');
  }

  const alert = calculator.calculateFalsePositiveAlert(metrics);
  if (alert) {
    console.log(chalk.yellow.bold('⚠️ Alert:'));
    console.log(chalk.yellow(`   FP rate ${pct0(alert.fpRate)} exceeds ${pct0(FP_TARGET)} target`));
    if (alert.worstAgent && alert.worstAgentRate !== undefined) {
      console.log(
        chalk.yellow(`   Worst agent: ${alert.worstAgent} (${pct0(alert.worstAgentRate)} FP)`),
      );
    }
    console.log(chalk.yellow(`   Action: ${alert.recommendation}`));
    console.log('');
  }
}
