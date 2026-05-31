export interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
  /** System prompt sent in the API's dedicated system role (not as user content). */
  system?: string;
  /**
   * Enable extended thinking for Anthropic models. Value is the thinking
   * budget in tokens (minimum 1024). When set, temperature is forced to 1
   * as required by the API.
   */
  extendedThinking?: number;
}

export interface CompletionResult {
  content: string;
  tokensUsed?: number;
}

export interface Provider {
  readonly name: string;
  complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult>;
}

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerName: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
