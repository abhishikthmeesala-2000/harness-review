import { describe, expect, it } from 'vitest';

import { JsonReport } from './json-report.js';
import { makePipelineResult, makeRunMetadata } from './test-fixtures.js';

describe('JsonReport.generate', () => {
  it('produces valid JSON', () => {
    const meta = makeRunMetadata();
    const result = makePipelineResult();
    const output = JsonReport.generate(result, meta);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('includes runMetadata with runId', () => {
    const meta = makeRunMetadata({ runId: 'test-run-id' });
    const result = makePipelineResult();
    const output = JsonReport.generate(result, meta);
    const parsed = JSON.parse(output);
    expect(parsed.runMetadata.runId).toBe('test-run-id');
  });

  it('includes result.decision', () => {
    const meta = makeRunMetadata();
    const result = makePipelineResult({ decision: 'approved' });
    const output = JsonReport.generate(result, meta);
    const parsed = JSON.parse(output);
    expect(parsed.result.decision).toBe('approved');
  });

  it('includes result.published array', () => {
    const meta = makeRunMetadata();
    const result = makePipelineResult();
    const output = JsonReport.generate(result, meta);
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed.result.published)).toBe(true);
    expect(parsed.result.published).toHaveLength(1);
  });

  it('includes metrics', () => {
    const meta = makeRunMetadata();
    const result = makePipelineResult();
    const output = JsonReport.generate(result, meta);
    const parsed = JSON.parse(output);
    expect(parsed.result.metrics).toBeDefined();
    expect(parsed.result.metrics.totalCandidates).toBe(1);
  });

  it('pretty-prints with 2-space indent', () => {
    const meta = makeRunMetadata();
    const result = makePipelineResult();
    const output = JsonReport.generate(result, meta);
    expect(output).toContain('  "runMetadata"');
  });
});
