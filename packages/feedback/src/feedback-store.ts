import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { FeedbackItem, FeedbackMetrics } from './types.js';

export class FeedbackStore {
  private readonly rawDataPath: string;
  private readonly metricsPath: string;

  constructor(repoRoot: string = process.cwd()) {
    this.rawDataPath = join(repoRoot, '.engagement-harness/feedback/feedback-data.json');
    this.metricsPath = join(repoRoot, '.engagement-harness/feedback/metrics.json');
  }

  loadAllFeedback(): FeedbackItem[] {
    if (!existsSync(this.rawDataPath)) return [];
    const raw = readFileSync(this.rawDataPath, 'utf8');
    return JSON.parse(raw) as FeedbackItem[];
  }

  saveFeedback(items: FeedbackItem[]): void {
    this.ensureDir(this.rawDataPath);
    writeFileSync(this.rawDataPath, JSON.stringify(items, null, 2) + '\n', 'utf8');
  }

  loadMetrics(): FeedbackMetrics | null {
    if (!existsSync(this.metricsPath)) return null;
    const raw = readFileSync(this.metricsPath, 'utf8');
    return JSON.parse(raw) as FeedbackMetrics;
  }

  saveMetrics(metrics: FeedbackMetrics): void {
    this.ensureDir(this.metricsPath);
    writeFileSync(this.metricsPath, JSON.stringify(metrics, null, 2) + '\n', 'utf8');
  }

  private ensureDir(filePath: string): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}
