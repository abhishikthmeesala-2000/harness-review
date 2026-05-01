export interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
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
