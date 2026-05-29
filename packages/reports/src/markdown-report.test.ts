import { describe, expect, it } from 'vitest';

import { MarkdownReport } from './markdown-report.js';
import { makePipelineResult, makeRunMetadata } from './test-fixtures.js';

describe('MarkdownReport.generate', () => {
  it('starts with h1 heading', () => {
    const output = MarkdownReport.generate(makePipelineResult(), makeRunMetadata());
    expect(output).toContain('# Engagement Harness Review');
  });

  it('includes decision', () => {
    const output = MarkdownReport.generate(
      makePipelineResult({ decision: 'approved_with_warnings' }),
      makeRunMetadata(),
    );
    expect(output).toContain('Approved with Warnings');
  });

  it('includes overall confidence as percent', () => {
    const output = MarkdownReport.generate(
      makePipelineResult({ overallConfidence: 0.85 }),
      makeRunMetadata(),
    );
    expect(output).toContain('85%');
  });

  it('includes finding file:lineStart–lineEnd', () => {
    const output = MarkdownReport.generate(makePipelineResult(), makeRunMetadata());
    expect(output).toContain('src/auth.ts:10–15');
  });

  it('includes severity badge', () => {
    const output = MarkdownReport.generate(makePipelineResult(), makeRunMetadata());
    expect(output).toContain('HIGH');
  });

  it('includes why it matters', () => {
    const output = MarkdownReport.generate(makePipelineResult(), makeRunMetadata());
    expect(output).toContain('Unauthenticated access to sensitive endpoint.');
  });

  it('includes suggested fix', () => {
    const output = MarkdownReport.generate(makePipelineResult(), makeRunMetadata());
    expect(output).toContain('Add authentication middleware');
  });

  it('includes run metadata section', () => {
    const output = MarkdownReport.generate(
      makePipelineResult(),
      makeRunMetadata({ runId: 'run-abc' }),
    );
    expect(output).toContain('## Run Metadata');
    expect(output).toContain('run-abc');
  });

  it('includes quality summary with rejected by stage', () => {
    const output = MarkdownReport.generate(makePipelineResult(), makeRunMetadata());
    expect(output).toContain('## Quality Summary');
    expect(output).toContain('### Rejected by Stage');
  });

  it('includes evidence distribution', () => {
    const output = MarkdownReport.generate(makePipelineResult(), makeRunMetadata());
    expect(output).toContain('Evidence Distribution');
  });

  it('shows no findings message when published is empty', () => {
    const result = makePipelineResult({
      published: [],
      metrics: {
        totalCandidates: 0,
        publishedCount: 0,
        rejectedByStage: {},
        verifierApprovalRate: 1,
        evidenceDistribution: { none: 0, weak: 0, medium: 0, strong: 0 },
      },
    });
    const output = MarkdownReport.generate(result, makeRunMetadata());
    expect(output).toContain('No findings published');
  });
});
