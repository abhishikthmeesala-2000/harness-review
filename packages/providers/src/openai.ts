import {
  NotImplementedError,
  type CompletionOptions,
  type CompletionResult,
  type Provider,
} from './interface.js';

export interface OpenAIProviderConfig {
  model: string;
}

export class OpenAIProvider implements Provider {
  public readonly name = 'openai';

  // Stored for use in Phase 8 once the real implementation lands.
  protected readonly config: OpenAIProviderConfig;

  constructor(config: OpenAIProviderConfig) {
    this.config = config;
  }

  async complete(_prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    throw new NotImplementedError('Real providers wired in Phase 8');
  }
}
