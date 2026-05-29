import { describe, expect, it } from 'vitest';

import { HtmlReport } from './html-report.js';
import { makePipelineResult, makeRunMetadata } from './test-fixtures.js';

describe('HtmlReport.generate', () => {
  it('starts with DOCTYPE', () => {
    const output = HtmlReport.generate(makePipelineResult(), makeRunMetadata());
    expect(output.trimStart()).toMatch(/^<!DOCTYPE html>/i);
  });

  it('has charset meta tag', () => {
    const output = HtmlReport.generate(makePipelineResult(), makeRunMetadata());
    expect(output).toContain('charset="UTF-8"');
  });

  it('has viewport meta tag', () => {
    const output = HtmlReport.generate(makePipelineResult(), makeRunMetadata());
    expect(output).toContain('viewport');
  });

  it('contains <details> for dimensions', () => {
    const output = HtmlReport.generate(makePipelineResult(), makeRunMetadata());
    expect(output).toContain('<details');
  });

  it('contains severity color in inline style', () => {
    const output = HtmlReport.generate(makePipelineResult(), makeRunMetadata());
    // high severity color
    expect(output).toContain('#ea580c');
  });

  it('contains inline <style> block', () => {
    const output = HtmlReport.generate(makePipelineResult(), makeRunMetadata());
    expect(output).toContain('<style>');
  });

  it('contains finding title escaped', () => {
    const output = HtmlReport.generate(makePipelineResult(), makeRunMetadata());
    expect(output).toContain('Missing authentication check');
  });

  it('contains run ID', () => {
    const output = HtmlReport.generate(
      makePipelineResult(),
      makeRunMetadata({ runId: 'test-run-42' }),
    );
    expect(output).toContain('test-run-42');
  });

  it('escapes HTML special chars in user content', () => {
    const result = makePipelineResult({
      published: [
        {
          id: 'EH-0001',
          title: 'XSS <script>alert(1)</script>',
          category: 'security',
          dimension: 'security',
          severity: 'high',
          file: 'src/auth.ts',
          lineStart: 10,
          lineEnd: 15,
          evidence: [{ type: 'diff', content: 'content' }],
          whyItMatters: 'matters',
          suggestedFix: 'fix',
          clientRuleReferences: [],
          falsePositiveRisk: 'low',
          sourceAgent: 'security',
          modelProvider: 'mock',
          remediationReadiness: 'ready',
          confidence: 0.9,
          verification: { status: 'approved', reason: '' },
        },
      ],
    });
    const output = HtmlReport.generate(result, makeRunMetadata());
    expect(output).not.toContain('<script>alert(1)</script>');
    expect(output).toContain('&lt;script&gt;');
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
    const output = HtmlReport.generate(result, makeRunMetadata());
    expect(output).toContain('No findings published');
  });
});
