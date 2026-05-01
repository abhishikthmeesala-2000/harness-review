import { describe, expect, it } from 'vitest';
import { ConfigSchema, defaultConfig, DEFAULT_AGENT_IDS } from './config.js';

const validBase = {
  client: { name: 'Acme', engagement: 'Q2 Pilot' },
  review: {
    confidenceThreshold: 0.8,
    severityThreshold: 'low' as const,
    requireVerifierApproval: true,
  },
  agents: { enabled: ['reviewer'] },
  models: { reviewer: 'mock' },
  providers: { mock: {} },
  context: { ignoredPaths: [], maxFiles: 30, maxTokens: 80000 },
  ci: { blockOnPolicy: false, postComments: false, artifactsOnly: true },
  alm: { platform: 'none' as const },
  feedback: { enabled: true },
  reports: {
    formats: ['json', 'markdown', 'html'] as const,
    outputDir: '.engagement-harness/reports',
  },
};

describe('ConfigSchema', () => {
  it('accepts a fully-specified valid config', () => {
    const parsed = ConfigSchema.parse(validBase);
    expect(parsed.client.name).toBe('Acme');
    expect(parsed.review.confidenceThreshold).toBe(0.8);
  });

  it('applies defaults when optional sections are omitted', () => {
    const parsed = ConfigSchema.parse({
      client: { name: 'Acme', engagement: 'Pilot' },
    });
    expect(parsed.review.confidenceThreshold).toBe(0.8);
    expect(parsed.review.severityThreshold).toBe('low');
    expect(parsed.review.requireVerifierApproval).toBe(true);
    expect(parsed.context.maxFiles).toBe(30);
    expect(parsed.context.maxTokens).toBe(80000);
    expect(parsed.ci.blockOnPolicy).toBe(false);
    expect(parsed.ci.postComments).toBe(false);
    expect(parsed.ci.artifactsOnly).toBe(true);
    expect(parsed.alm.platform).toBe('none');
    expect(parsed.reports.formats).toEqual(['json', 'markdown', 'html']);
    expect(parsed.reports.outputDir).toBe('.engagement-harness/reports');
    expect(parsed.feedback.enabled).toBe(true);
  });

  it('rejects confidenceThreshold above 1', () => {
    const result = ConfigSchema.safeParse({
      ...validBase,
      review: { ...validBase.review, confidenceThreshold: 1.5 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.find((i) =>
        i.path.join('.') === 'review.confidenceThreshold',
      );
      expect(msg?.message).toContain('between 0 and 1');
    }
  });

  it('rejects confidenceThreshold below 0', () => {
    const result = ConfigSchema.safeParse({
      ...validBase,
      review: { ...validBase.review, confidenceThreshold: -0.1 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown severity values', () => {
    const result = ConfigSchema.safeParse({
      ...validBase,
      review: { ...validBase.review, severityThreshold: 'banana' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown alm platform', () => {
    const result = ConfigSchema.safeParse({
      ...validBase,
      alm: { platform: 'jira' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty client.name', () => {
    const result = ConfigSchema.safeParse({
      ...validBase,
      client: { name: '', engagement: 'Pilot' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.find((i) => i.path.join('.') === 'client.name');
      expect(msg?.message).toBe('client.name is required');
    }
  });

  it('rejects empty reports.formats', () => {
    const result = ConfigSchema.safeParse({
      ...validBase,
      reports: { ...validBase.reports, formats: [] },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.find((i) => i.path.join('.') === 'reports.formats');
      expect(msg?.message).toContain('at least one format');
    }
  });

  it('rejects non-positive maxFiles', () => {
    const result = ConfigSchema.safeParse({
      ...validBase,
      context: { ...validBase.context, maxFiles: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown report format', () => {
    const result = ConfigSchema.safeParse({
      ...validBase,
      reports: { ...validBase.reports, formats: ['pdf'] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects extra top-level keys (strict mode)', () => {
    const result = ConfigSchema.safeParse({ ...validBase, extra: 'not allowed' });
    expect(result.success).toBe(false);
  });
});

describe('defaultConfig', () => {
  it('produces a Config with all canonical agents enabled', () => {
    const c = defaultConfig({ name: 'Acme', engagement: 'Pilot' });
    expect(c.agents.enabled).toEqual([...DEFAULT_AGENT_IDS]);
    for (const id of DEFAULT_AGENT_IDS) {
      expect(c.models[id]).toBe('mock');
    }
  });

  it('produces a Config that re-validates cleanly', () => {
    const c = defaultConfig({ name: 'Acme', engagement: 'Pilot' });
    expect(() => ConfigSchema.parse(c)).not.toThrow();
  });
});
