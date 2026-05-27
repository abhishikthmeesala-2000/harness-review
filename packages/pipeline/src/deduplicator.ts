import type { Finding } from '@engagement-harness/core';

import type { RejectedEntry } from './types.js';

function dedupKey(f: Finding): string {
  return `${f.file}::${f.lineStart}::${f.dimension}`;
}

export const Deduplicator = {
  dedupe(findings: Finding[]): { kept: Finding[]; dropped: (RejectedEntry & { finding: Finding })[] } {
    const best = new Map<string, Finding>();

    for (const f of findings) {
      const key = dedupKey(f);
      const existing = best.get(key);
      if (!existing || f.confidence > existing.confidence) {
        best.set(key, f);
      }
    }

    const kept: Finding[] = [];
    const dropped: (RejectedEntry & { finding: Finding })[] = [];

    for (const f of findings) {
      const winner = best.get(dedupKey(f));
      if (winner === f) {
        kept.push(f);
      } else {
        dropped.push({ finding: f, reason: 'duplicate, lower confidence', stage: 'deduplication' });
      }
    }

    return { kept, dropped };
  },
};
