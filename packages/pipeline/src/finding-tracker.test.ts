import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Finding } from '@engagement-harness/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FindingTracker } from './finding-tracker.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F-001',
    title: 'SQL injection in deleteUser',
    category: 'security',
    dimension: 'security',
    severity: 'high',
    confidence: 0.9,
    file: 'auth.ts',
    lineStart: 10,
    lineEnd: 12,
    evidence: [{ type: 'diff', content: 'some evidence content here' }],
    whyItMatters: 'It matters.',
    suggestedFix: 'Use parameterized queries.',
    clientRuleReferences: [],
    falsePositiveRisk: 'low',
    sourceAgent: 'security',
    modelProvider: 'mock',
    remediationReadiness: 'ready',
    verification: { status: 'approved', reason: 'ok' },
    ...overrides,
  } as Finding;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'eh-tracker-'));
});

describe('FindingTracker.fingerprint', () => {
  it('is stable across line-number changes', () => {
    const tracker = new FindingTracker(dir);
    const a = makeFinding({ lineStart: 10, lineEnd: 12 });
    const b = makeFinding({ lineStart: 40, lineEnd: 42 });
    expect(tracker.fingerprint(a)).toBe(tracker.fingerprint(b));
  });

  it('normalizes the title (lowercase, spaces to hyphens) and omits the line number', () => {
    const tracker = new FindingTracker(dir);
    const fp = tracker.fingerprint(makeFinding());
    expect(fp).toBe('auth.ts::security::sql-injection-in-deleteuser::high');
  });

  it('differs when severity or category differ', () => {
    const tracker = new FindingTracker(dir);
    const high = tracker.fingerprint(makeFinding({ severity: 'high' }));
    const low = tracker.fingerprint(makeFinding({ severity: 'low' }));
    expect(high).not.toBe(low);
  });
});

describe('FindingTracker.filterNew', () => {
  it('classifies a never-seen finding as new', async () => {
    const tracker = new FindingTracker(dir);
    await tracker.load();
    const delta = tracker.filterNew([makeFinding()], 1);
    expect(delta.newFindings).toHaveLength(1);
    expect(delta.outstandingFindings).toHaveLength(0);
    expect(delta.resolvedFindings).toHaveLength(0);
  });

  it('classifies a previously recorded finding on the same PR as outstanding', async () => {
    const tracker = new FindingTracker(dir);
    await tracker.load();
    await tracker.recordFindings([makeFinding()], 1);
    const delta = tracker.filterNew([makeFinding()], 1);
    expect(delta.newFindings).toHaveLength(0);
    expect(delta.outstandingFindings).toHaveLength(1);
  });

  it('classifies a recorded finding that is now absent as resolved', async () => {
    const tracker = new FindingTracker(dir);
    await tracker.load();
    await tracker.recordFindings([makeFinding()], 1);
    const delta = tracker.filterNew([], 1);
    expect(delta.resolvedFindings).toHaveLength(1);
    expect(delta.resolvedFindings[0]!.finding.title).toBe('SQL injection in deleteUser');
  });

  it('treats the same fingerprint on a different PR as new', async () => {
    const tracker = new FindingTracker(dir);
    await tracker.load();
    await tracker.recordFindings([makeFinding()], 1);
    const delta = tracker.filterNew([makeFinding()], 2);
    expect(delta.newFindings).toHaveLength(1);
    expect(delta.outstandingFindings).toHaveLength(0);
  });
});

describe('FindingTracker persistence', () => {
  it('round-trips known findings across load/save', async () => {
    const a = new FindingTracker(dir);
    await a.load();
    await a.recordFindings([makeFinding()], 7);

    const b = new FindingTracker(dir);
    await b.load();
    const delta = b.filterNew([makeFinding()], 7);
    expect(delta.outstandingFindings).toHaveLength(1);
  });

  it('writes known-findings.json under .engagement-harness/findings', async () => {
    const tracker = new FindingTracker(dir);
    await tracker.load();
    await tracker.recordFindings([makeFinding()], 1);
    const file = path.join(dir, '.engagement-harness', 'findings', 'known-findings.json');
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].runCount).toBe(1);
    expect(parsed[0].prNumber).toBe(1);
  });

  it('increments runCount when the same finding is recorded again', async () => {
    const tracker = new FindingTracker(dir);
    await tracker.load();
    await tracker.recordFindings([makeFinding()], 1);
    await tracker.recordFindings([makeFinding()], 1);
    const file = path.join(dir, '.engagement-harness', 'findings', 'known-findings.json');
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    expect(parsed[0].runCount).toBe(2);
  });

  it('starts empty when no file exists', async () => {
    const tracker = new FindingTracker(dir);
    await tracker.load();
    const delta = tracker.filterNew([makeFinding()], 1);
    expect(delta.newFindings).toHaveLength(1);
  });
});

afterEach(() => {
  // tmp dirs are cleaned by the OS; nothing to do.
});
