import type { Config } from '@engagement-harness/core';

import { AnthropicProvider } from './anthropic.js';
import type { Provider } from './interface.js';
import { MockProvider } from './mock.js';
import { OpenAIProvider } from './openai.js';

export type ProviderFactory = (config: Config) => Provider;

const REGISTRY = new Map<string, ProviderFactory>();

function defaultFactories(): Map<string, ProviderFactory> {
  const m = new Map<string, ProviderFactory>();
  m.set('mock', () => new MockProvider());
  m.set('openai', (config: Config) => {
    if (!config.providers.openai) {
      throw new Error('providers.openai.model is not configured');
    }
    return new OpenAIProvider({ model: config.providers.openai.model });
  });
  m.set('anthropic', (config: Config) => {
    if (!config.providers.anthropic) {
      throw new Error('providers.anthropic.model is not configured');
    }
    return new AnthropicProvider({ model: config.providers.anthropic.model });
  });
  return m;
}

// Install defaults eagerly so a fresh import of the package has the three known providers.
for (const [name, factory] of defaultFactories()) {
  REGISTRY.set(name, factory);
}

export const ProviderRegistry = {
  register(name: string, factory: ProviderFactory): void {
    REGISTRY.set(name, factory);
  },

  has(name: string): boolean {
    return REGISTRY.has(name);
  },

  get(name: string, config: Config): Provider {
    const factory = REGISTRY.get(name);
    if (!factory) {
      throw new Error(`Unknown provider "${name}". Registered: ${[...REGISTRY.keys()].join(', ')}`);
    }
    return factory(config);
  },

  list(): string[] {
    return [...REGISTRY.keys()];
  },

  /** Restore the registry to its built-in defaults. Intended for tests. */
  reset(): void {
    REGISTRY.clear();
    for (const [name, factory] of defaultFactories()) {
      REGISTRY.set(name, factory);
    }
  },
};
