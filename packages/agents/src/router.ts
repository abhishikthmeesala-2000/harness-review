import type { Config } from '@engagement-harness/core';
import { ProviderRegistry, type Provider } from '@engagement-harness/providers';
import chalk from 'chalk';

const DEFAULT_PROVIDER = 'mock';

export const ModelRouter = {
  /**
   * Resolve the provider for a given agent ID. Reads `config.models[agentId]`,
   * falls back to "mock" if unmapped or if the configured provider is unknown.
   * The fallback is logged so tests can pin the behavior.
   */
  route(agentId: string, config: Config): Provider {
    const requested = config.models[agentId] ?? DEFAULT_PROVIDER;
    const resolved = ProviderRegistry.has(requested) ? requested : DEFAULT_PROVIDER;
    if (resolved !== requested) {
      console.warn(
        chalk.yellow(
          `[router] agent "${agentId}" requested provider "${requested}" which is not registered; falling back to "${DEFAULT_PROVIDER}"`,
        ),
      );
    }
    return ProviderRegistry.get(resolved, config);
  },
};
