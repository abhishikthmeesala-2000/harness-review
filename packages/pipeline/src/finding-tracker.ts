import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Finding } from '@engagement-harness/core';

export interface TrackedFinding {
  fingerprint: string;
  finding: Finding;
  prNumber: number;
  firstSeenAt: string;
  runCount: number;
}

export interface DeltaResult {
  /** Never seen before this run — post inline. */
  newFindings: Finding[];
  /** Seen before on this PR, still present — remind in the summary. */
  outstandingFindings: Finding[];
  /** Seen before on this PR, now gone — celebrate as resolved. */
  resolvedFindings: TrackedFinding[];
}

/**
 * Tracks findings across multiple runs of the same PR so re-reviews can
 * distinguish new / outstanding / resolved findings instead of re-posting the
 * same comments every run. Persists to
 * `<cwd>/.engagement-harness/findings/known-findings.json`.
 *
 * Fingerprints intentionally exclude the line number — code shifts lines as it
 * grows, but the same issue (file + category + title + severity) is the "same"
 * finding for re-review purposes.
 */
export class FindingTracker {
  private readonly filePath: string;
  private known = new Map<string, TrackedFinding>();

  constructor(cwd: string) {
    this.filePath = path.join(cwd, '.engagement-harness', 'findings', 'known-findings.json');
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      this.known = new Map();
      if (Array.isArray(parsed)) {
        for (const entry of parsed as TrackedFinding[]) {
          if (entry && typeof entry.fingerprint === 'string') {
            this.known.set(entry.fingerprint, entry);
          }
        }
      }
    } catch {
      // Missing or unreadable file — start fresh.
      this.known = new Map();
    }
  }

  async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const entries = [...this.known.values()];
    await writeFile(this.filePath, JSON.stringify(entries, null, 2), 'utf8');
  }

  fingerprint(finding: Finding): string {
    const normalizedTitle = finding.title.toLowerCase().replace(/\s+/g, '-');
    return `${finding.file}::${finding.category}::${normalizedTitle}::${finding.severity}`;
  }

  filterNew(currentFindings: Finding[], prNumber: number): DeltaResult {
    const newFindings: Finding[] = [];
    const outstandingFindings: Finding[] = [];
    const currentFingerprints = new Set<string>();

    for (const finding of currentFindings) {
      const fp = this.fingerprint(finding);
      currentFingerprints.add(fp);
      const known = this.known.get(fp);
      if (!known || known.prNumber !== prNumber) {
        newFindings.push(finding);
      } else {
        outstandingFindings.push(finding);
      }
    }

    const resolvedFindings: TrackedFinding[] = [];
    for (const entry of this.known.values()) {
      if (entry.prNumber === prNumber && !currentFingerprints.has(entry.fingerprint)) {
        resolvedFindings.push(entry);
      }
    }

    return { newFindings, outstandingFindings, resolvedFindings };
  }

  async recordFindings(findings: Finding[], prNumber: number): Promise<void> {
    const now = new Date().toISOString();
    for (const finding of findings) {
      const fp = this.fingerprint(finding);
      const existing = this.known.get(fp);
      if (existing && existing.prNumber === prNumber) {
        existing.runCount += 1;
        existing.finding = finding;
      } else {
        this.known.set(fp, {
          fingerprint: fp,
          finding,
          prNumber,
          firstSeenAt: now,
          runCount: 1,
        });
      }
    }
    await this.save();
  }
}
