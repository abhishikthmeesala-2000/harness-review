import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FeedbackImporter, type MetricsSummary } from './feedback.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `feedback-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function readMetrics(): MetricsSummary {
  return JSON.parse(
    readFileSync(join(tmpDir, '.engagement-harness/feedback/metrics.json'), 'utf8'),
  ) as MetricsSummary;
}

function writeFeedbackFile(data: unknown): string {
  const p = join(tmpDir, 'feedback.json');
  writeFileSync(p, JSON.stringify(data), 'utf8');
  return p;
}

describe('FeedbackImporter', () => {
  it('imports a single valid feedback entry and updates metrics', async () => {
    const importer = new FeedbackImporter();
    const file = writeFeedbackFile({
      findingId: 'EH-0001',
      runId: 'run-2026-01-01T00-00-00Z',
      state: 'accepted',
      timestamp: '2026-01-01T00:00:00Z',
    });
    await importer.import(file, tmpDir);
    const metrics = readMetrics();
    expect(metrics.totalEntries).toBe(1);
    expect(metrics.byState['accepted']).toBe(1);
    expect(metrics.entries[0]?.findingId).toBe('EH-0001');
  });

  it('imports an array of feedback entries', async () => {
    const importer = new FeedbackImporter();
    const file = writeFeedbackFile([
      {
        findingId: 'EH-0001',
        runId: 'run-1',
        state: 'accepted',
        timestamp: '2026-01-01T00:00:00Z',
      },
      {
        findingId: 'EH-0002',
        runId: 'run-1',
        state: 'false_positive',
        timestamp: '2026-01-01T00:00:00Z',
      },
    ]);
    await importer.import(file, tmpDir);
    const metrics = readMetrics();
    expect(metrics.totalEntries).toBe(2);
    expect(metrics.byState['accepted']).toBe(1);
    expect(metrics.byState['false_positive']).toBe(1);
  });

  it('accumulates across multiple imports', async () => {
    const importer = new FeedbackImporter();
    const file1 = writeFeedbackFile({
      findingId: 'EH-0001',
      runId: 'run-1',
      state: 'accepted',
      timestamp: '2026-01-01T00:00:00Z',
    });
    const file2 = writeFeedbackFile({
      findingId: 'EH-0002',
      runId: 'run-1',
      state: 'accepted',
      timestamp: '2026-01-01T00:00:00Z',
    });
    await importer.import(file1, tmpDir);
    await importer.import(file2, tmpDir);
    const metrics = readMetrics();
    expect(metrics.totalEntries).toBe(2);
    expect(metrics.byState['accepted']).toBe(2);
  });

  it('throws on invalid feedback entry', async () => {
    const importer = new FeedbackImporter();
    const file = writeFeedbackFile({ findingId: '', state: 'not-a-valid-state' });
    await expect(importer.import(file, tmpDir)).rejects.toThrow();
  });
});
