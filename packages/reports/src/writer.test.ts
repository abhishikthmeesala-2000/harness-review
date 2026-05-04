import { existsSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ReportWriter } from './writer.js';

describe('ReportWriter.write', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `report-writer-test-${Date.now()}`);
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates run directory', () => {
    ReportWriter.write({ json: '{}' }, tmpDir, 'run1');
    expect(existsSync(path.join(tmpDir, 'run-run1'))).toBe(true);
  });

  it('writes json as report.json', () => {
    ReportWriter.write({ json: '{"ok":true}' }, tmpDir, 'run1');
    const content = readFileSync(path.join(tmpDir, 'run-run1', 'report.json'), 'utf8');
    expect(content).toBe('{"ok":true}');
  });

  it('writes markdown as report.md', () => {
    ReportWriter.write({ markdown: '# Hello' }, tmpDir, 'run2');
    const content = readFileSync(path.join(tmpDir, 'run-run2', 'report.md'), 'utf8');
    expect(content).toBe('# Hello');
  });

  it('writes html as report.html', () => {
    ReportWriter.write({ html: '<html></html>' }, tmpDir, 'run3');
    const content = readFileSync(path.join(tmpDir, 'run-run3', 'report.html'), 'utf8');
    expect(content).toBe('<html></html>');
  });

  it('writes multiple formats in same run dir', () => {
    ReportWriter.write({ json: '{}', markdown: '# Md', html: '<html/>' }, tmpDir, 'multi');
    expect(existsSync(path.join(tmpDir, 'run-multi', 'report.json'))).toBe(true);
    expect(existsSync(path.join(tmpDir, 'run-multi', 'report.md'))).toBe(true);
    expect(existsSync(path.join(tmpDir, 'run-multi', 'report.html'))).toBe(true);
  });

  it('creates nested outputDir when it does not exist', () => {
    const nestedDir = path.join(tmpDir, 'deep', 'nested');
    ReportWriter.write({ json: '{}' }, nestedDir, 'run4');
    expect(existsSync(path.join(nestedDir, 'run-run4', 'report.json'))).toBe(true);
  });
});
