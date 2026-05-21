import { describe, expect, it } from 'vitest';

import { renderFunctionContext } from './prompt-utils.js';
import type { ContextEntry, FileDiff } from '@engagement-harness/core';

function makeEntry(path: string, content: string): ContextEntry {
  return { path, content, reason: 'test', priority: 100, kind: 'changed-file' };
}

function makeFileDiff(path: string, newStart: number): FileDiff {
  return {
    path,
    status: 'modified',
    hunks: [{ oldStart: newStart, oldLines: 1, newStart, newLines: 1, lines: [] }],
  } as FileDiff;
}

const SAMPLE_FILE = `
import { db } from './db';

export async function getUser(id: number) {
  const validated = parseInt(String(id), 10);
  if (isNaN(validated)) throw new Error('invalid');
  const result = await db.query('SELECT * FROM users WHERE id = ' + validated);
  return result.rows[0];
}

export function helper() {
  return 42;
}
`.trimStart();

describe('renderFunctionContext', () => {
  it('extracts function body when hunk falls inside a function', () => {
    const diff = [makeFileDiff('src/users.ts', 5)];
    const entries = [makeEntry('src/users.ts', SAMPLE_FILE)];

    const result = renderFunctionContext(diff, entries);

    expect(result).toContain('src/users.ts');
    expect(result).toContain('getUser');
    expect(result).toContain('validated');
  });

  it('returns placeholder when no entry for the changed file', () => {
    const diff = [makeFileDiff('src/missing.ts', 3)];
    const entries = [makeEntry('src/other.ts', SAMPLE_FILE)];

    const result = renderFunctionContext(diff, entries);

    expect(result).toBe('(no function context extracted)');
  });

  it('deduplicates when multiple hunks hit the same function', () => {
    const path = 'src/users.ts';
    const diff: FileDiff[] = [
      {
        path,
        status: 'modified',
        hunks: [
          { oldStart: 5, oldLines: 1, newStart: 5, newLines: 1, lines: [] },
          { oldStart: 6, oldLines: 1, newStart: 6, newLines: 1, lines: [] },
        ],
      } as FileDiff,
    ];
    const entries = [makeEntry(path, SAMPLE_FILE)];

    const result = renderFunctionContext(diff, entries);

    // Should appear only once
    const occurrences = (result.match(/getUser/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('returns placeholder when diff is empty', () => {
    const result = renderFunctionContext([], []);
    expect(result).toBe('(no function context extracted)');
  });

  it('caps function body at 80 lines for a very long function', () => {
    const lines = ['export function huge() {'];
    for (let i = 0; i < 200; i++) lines.push(`  const x${i} = ${i};`);
    lines.push('}');
    const content = lines.join('\n');

    const diff = [makeFileDiff('src/huge.ts', 50)];
    const entries = [makeEntry('src/huge.ts', content)];

    const result = renderFunctionContext(diff, entries);
    const bodyLines = result.split('\n').filter((l) => l.startsWith('  const'));
    expect(bodyLines.length).toBeLessThanOrEqual(79);
  });
});
