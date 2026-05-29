import { ConfigSchema, type Config } from '@engagement-harness/core';
import { afterEach, describe, expect, it } from 'vitest';

import { MockProvider } from './mock.js';
import { ProviderRegistry } from './registry.js';

function buildConfig(overrides: Partial<Config> = {}): Config {
  return ConfigSchema.parse({
    client: { name: 'TestCo', engagement: 'PilotEngagement' },
    ...overrides,
  });
}

afterEach(() => {
  ProviderRegistry.reset();
});

describe('ProviderRegistry', () => {
  it('pre-registers mock, openai, and anthropic', () => {
    const list = ProviderRegistry.list();
    expect(list).toContain('mock');
    expect(list).toContain('openai');
    expect(list).toContain('anthropic');
  });

  it('returns a MockProvider for "mock"', () => {
    const provider = ProviderRegistry.get('mock', buildConfig());
    expect(provider).toBeInstanceOf(MockProvider);
    expect(provider.name).toBe('mock');
  });

  it('throws on unknown provider names', () => {
    expect(() => ProviderRegistry.get('does-not-exist', buildConfig())).toThrow(/Unknown provider/);
  });

  it('returns an OpenAIProvider when configured; complete() throws when key absent', async () => {
    const saved = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    try {
      const config = buildConfig({
        providers: { mock: {}, openai: { model: 'gpt-test' } },
      });
      const provider = ProviderRegistry.get('openai', config);
      expect(provider.name).toBe('openai');
      await expect(provider.complete('hi')).rejects.toThrow(
        'OPENAI_API_KEY environment variable not set',
      );
    } finally {
      if (saved !== undefined) process.env['OPENAI_API_KEY'] = saved;
    }
  });

  it('throws a clear error when openai is requested but not configured', () => {
    expect(() => ProviderRegistry.get('openai', buildConfig())).toThrow(
      /providers\.openai\.model is not configured/,
    );
  });

  it('allows registering a custom provider factory', async () => {
    ProviderRegistry.register('custom', () => ({
      name: 'custom',
      complete: async () => ({ content: '[]' }),
    }));
    const provider = ProviderRegistry.get('custom', buildConfig());
    expect(provider.name).toBe('custom');
    expect((await provider.complete('x')).content).toBe('[]');
  });

  it('reset() restores the built-in defaults and drops custom registrations', () => {
    ProviderRegistry.register('custom', () => ({
      name: 'custom',
      complete: async () => ({ content: '[]' }),
    }));
    expect(ProviderRegistry.has('custom')).toBe(true);
    ProviderRegistry.reset();
    expect(ProviderRegistry.has('custom')).toBe(false);
    expect(ProviderRegistry.has('mock')).toBe(true);
  });
});
