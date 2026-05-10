import { ConfigSchema, type Config } from '@engagement-harness/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderError } from './interface.js';
import { MockProvider } from './mock.js';
import { ProviderRegistry } from './registry.js';

function buildConfig(overrides: Partial<Config> = {}): Config {
  return ConfigSchema.parse({
    client: { name: 'TestCo', engagement: 'PilotEngagement' },
    ...overrides,
  });
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  process.env.OPENAI_API_KEY = 'sk-test-openai';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
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

  it('returns an OpenAIProvider when configured with key set', () => {
    const config = buildConfig({
      providers: { mock: {}, openai: { model: 'gpt-test' } },
    });
    const provider = ProviderRegistry.get('openai', config);
    expect(provider.name).toBe('openai');
  });

  it('throws ProviderError when openai requested but OPENAI_API_KEY missing', () => {
    delete process.env.OPENAI_API_KEY;
    const config = buildConfig({ providers: { mock: {}, openai: { model: 'gpt-test' } } });
    expect(() => ProviderRegistry.get('openai', config)).toThrow(ProviderError);
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
