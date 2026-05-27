import { describe, expect, it } from 'vitest';

import { ReportGenerator } from './generator.js';
import { makeConfig, makePipelineResult, makeRunMetadata } from './test-fixtures.js';

describe('ReportGenerator.generateAll', () => {
  it('returns all three formats when all enabled', () => {
    const config = makeConfig({ reports: { formats: ['json', 'markdown', 'html'], outputDir: '.engagement-harness/reports' } });
    const result = ReportGenerator.generateAll(makePipelineResult(), makeRunMetadata(), config);
    expect(Object.keys(result).sort()).toEqual(['html', 'json', 'markdown']);
  });

  it('returns only json and markdown when html excluded', () => {
    const config = makeConfig({ reports: { formats: ['json', 'markdown'], outputDir: '.engagement-harness/reports' } });
    const result = ReportGenerator.generateAll(makePipelineResult(), makeRunMetadata(), config);
    expect(Object.keys(result).sort()).toEqual(['json', 'markdown']);
    expect(result['html']).toBeUndefined();
  });

  it('json value is valid JSON', () => {
    const config = makeConfig({ reports: { formats: ['json'], outputDir: '.engagement-harness/reports' } });
    const result = ReportGenerator.generateAll(makePipelineResult(), makeRunMetadata(), config);
    expect(() => JSON.parse(result['json']!)).not.toThrow();
  });

  it('markdown value contains h1 heading', () => {
    const config = makeConfig({ reports: { formats: ['markdown'], outputDir: '.engagement-harness/reports' } });
    const result = ReportGenerator.generateAll(makePipelineResult(), makeRunMetadata(), config);
    expect(result['markdown']).toContain('# Engagement Harness Review');
  });

  it('html value starts with DOCTYPE', () => {
    const config = makeConfig({ reports: { formats: ['html'], outputDir: '.engagement-harness/reports' } });
    const result = ReportGenerator.generateAll(makePipelineResult(), makeRunMetadata(), config);
    expect(result['html']?.trimStart()).toMatch(/^<!DOCTYPE html>/i);
  });

  it('returns empty object when formats array is empty', () => {
    // ConfigSchema enforces min(1) on formats, but generator handles the case
    const config = makeConfig({ reports: { formats: [] as unknown as ['json'], outputDir: '.engagement-harness/reports' } });
    const result = ReportGenerator.generateAll(makePipelineResult(), makeRunMetadata(), config);
    expect(Object.keys(result)).toHaveLength(0);
  });
});
