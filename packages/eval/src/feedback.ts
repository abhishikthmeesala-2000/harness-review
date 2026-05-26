import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { z } from 'zod';

export const FeedbackEntrySchema = z.object({
  findingId: z.string().min(1),
  runId: z.string().min(1),
  state: z.enum(['accepted', 'dismissed', 'false_positive', 'fixed', 'ignored', 'overridden']),
  note: z.string().optional(),
  timestamp: z.string().datetime(),
});

export type FeedbackEntry = z.infer<typeof FeedbackEntrySchema>;

export interface AgentMetricsSummary {
  totalFindings: number;
  feedback: Record<string, number>;
  acceptanceRate: number;
  falsePositiveRate: number;
}

export interface MetricsSummary {
  lastUpdated: string;
  totalEntries: number;
  byState: Record<string, number>;
  byAgent: Record<string, AgentMetricsSummary>;
  entries: FeedbackEntry[];
}

const METRICS_PATH = '.engagement-harness/feedback/metrics.json';

const ALL_STATES = ['accepted', 'dismissed', 'false_positive', 'fixed', 'ignored', 'overridden'];

function emptyByState(): Record<string, number> {
  return Object.fromEntries(ALL_STATES.map((s) => [s, 0]));
}

const EMPTY_METRICS: MetricsSummary = {
  lastUpdated: '',
  totalEntries: 0,
  byState: emptyByState(),
  byAgent: {},
  entries: [],
};

export class FeedbackImporter {
  async import(filePath: string, repoRoot: string): Promise<void> {
    const raw = readFileSync(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);

    const toValidate = Array.isArray(parsed) ? parsed : [parsed];
    const entries: FeedbackEntry[] = toValidate.map((item, i) => {
      const result = FeedbackEntrySchema.safeParse(item);
      if (!result.success) {
        throw new Error(`feedback entry ${i} invalid: ${result.error.message}`);
      }
      return result.data;
    });

    const metricsFile = join(repoRoot, METRICS_PATH);
    const metrics: MetricsSummary = existsSync(metricsFile)
      ? (JSON.parse(readFileSync(metricsFile, 'utf8')) as MetricsSummary)
      : { ...EMPTY_METRICS, byState: emptyByState(), byAgent: {} };

    for (const entry of entries) {
      metrics.entries.push(entry);
      metrics.totalEntries++;
      metrics.byState[entry.state] = (metrics.byState[entry.state] ?? 0) + 1;
    }
    metrics.lastUpdated = new Date().toISOString();

    const dir = dirname(metricsFile);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(metricsFile, JSON.stringify(metrics, null, 2) + '\n', 'utf8');
  }
}
