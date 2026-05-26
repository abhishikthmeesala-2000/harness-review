import type { AgentMetrics, FeedbackItem, FeedbackMetrics, FeedbackState } from './types.js';

const ALL_STATES: FeedbackState[] = [
  'accepted',
  'false_positive',
  'fixed',
  'dismissed',
  'acknowledged',
  'ignored',
];

export class MetricsCalculator {
  calculate(items: FeedbackItem[]): FeedbackMetrics {
    const byState: Partial<Record<FeedbackState, number>> = {};
    for (const state of ALL_STATES) {
      byState[state] = 0;
    }

    const byAgent: Record<string, AgentMetrics> = {};

    for (const item of items) {
      byState[item.state] = (byState[item.state] ?? 0) + 1;

      const agentName = item.metadata?.sourceAgent ?? 'unknown';
      if (!byAgent[agentName]) {
        byAgent[agentName] = {
          totalFindings: 0,
          feedback: {},
          acceptanceRate: 0,
          falsePositiveRate: 0,
        };
      }
      const agent = byAgent[agentName]!;
      agent.totalFindings++;
      agent.feedback[item.state] = (agent.feedback[item.state] ?? 0) + 1;
    }

    for (const agent of Object.values(byAgent)) {
      const total = agent.totalFindings;
      if (total > 0) {
        agent.acceptanceRate = (agent.feedback.accepted ?? 0) / total;
        agent.falsePositiveRate = (agent.feedback.false_positive ?? 0) / total;
      }
    }

    return {
      lastUpdated: new Date().toISOString(),
      totalEntries: items.length,
      byState,
      byAgent,
      entries: items,
    };
  }
}
