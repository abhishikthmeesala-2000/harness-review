import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { z } from 'zod';

export const FeedbackEntrySchema = z.object({
  findingId: z.string().min(1),
  rating: z.enum(['correct', 'false_positive', 'low_priority']),
  agent: z.string().optional(),
  comment: z.string().optional(),
  timestamp: z.string().datetime().optional(),
});

export type FeedbackEntry = z.infer<typeof FeedbackEntrySchema>;

export interface MetricsSummary {
  lastUpdated: string;
  totalEntries: number;
  byRating: Record<string, number>;
  byAgent: Record<string, number>;
  entries: FeedbackEntry[];
}

const METRICS_PATH = '.engagement-harness/metrics.json';

const EMPTY_METRICS: MetricsSummary = {
  lastUpdated: '',
  totalEntries: 0,
  byRating: { correct: 0, false_positive: 0, low_priority: 0 },
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
      : { ...EMPTY_METRICS, byRating: { correct: 0, false_positive: 0, low_priority: 0 }, byAgent: {} };

    for (const entry of entries) {
      metrics.entries.push(entry);
      metrics.totalEntries++;
      metrics.byRating[entry.rating] = (metrics.byRating[entry.rating] ?? 0) + 1;
      if (entry.agent) {
        metrics.byAgent[entry.agent] = (metrics.byAgent[entry.agent] ?? 0) + 1;
      }
    }
    metrics.lastUpdated = new Date().toISOString();

    const dir = dirname(metricsFile);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(metricsFile, JSON.stringify(metrics, null, 2) + '\n', 'utf8');
  }
}
