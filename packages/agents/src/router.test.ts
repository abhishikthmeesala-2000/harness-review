import { AnthropicProvider, MockProvider, ProviderRegistry } from '@engagement-harness/providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelRouter } from './router.js';
import { makeConfig } from './test-helpers.js';

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.OPENAI_API_KEY = 'sk-test-openai';
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  ProviderRegistry.reset();
  vi.restoreAllMocks();
});

describe('ModelRouter.route', () => {
  it('falls back to mock when no provider is configured for the agent', () => {
    const provider = ModelRouter.route('reviewer', makeConfig());
    expect(provider).toBeInstanceOf(MockProvider);
  });

  it('routes to the configured provider when registered and configured', () => {
    const config = makeConfig({
      models: { security: 'anthropic' },
      providers: { mock: {}, anthropic: { model: 'claude-test' } },
    });
    const provider = ModelRouter.route('security', config);
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.name).toBe('anthropic');
  });

  it('falls back to mock with a warning when the configured provider is unknown', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = makeConfig({ models: { reviewer: 'not-a-real-provider' } });
    const provider = ModelRouter.route('reviewer', config);
    expect(provider).toBeInstanceOf(MockProvider);
    expect(warnSpy).toHaveBeenCalledOnce();
  });
});
