import {
  NotImplementedError,
  type CompletionOptions,
  type CompletionResult,
  type Provider,
} from './interface.js';

export interface AnthropicProviderConfig {
  model: string;
}

export class AnthropicProvider implements Provider {
  public readonly name = 'anthropic';

  protected readonly config: AnthropicProviderConfig;

  constructor(config: AnthropicProviderConfig) {
    this.config = config;
  }

  async complete(_prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    throw new NotImplementedError('Real providers wired in Phase 8');
  }
}
