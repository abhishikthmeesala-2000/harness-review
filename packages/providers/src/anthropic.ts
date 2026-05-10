import { ProviderError, type CompletionOptions, type CompletionResult, type Provider } from './interface.js';

export interface AnthropicProviderConfig {
  model: string;
}

interface AnthropicMessagesResponse {
  content: Array<{ type: string; text: string }>;
  usage: { input_tokens: number; output_tokens: number };
}

export class AnthropicProvider implements Provider {
  public readonly name = 'anthropic';

  private readonly apiKey: string;
  protected readonly config: AnthropicProviderConfig;

  constructor(config: AnthropicProviderConfig) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new ProviderError('ANTHROPIC_API_KEY environment variable is not set', 'anthropic');
    this.apiKey = key;
    this.config = config;
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
    let response: Response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: options?.maxTokens ?? 4096,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderError(`Anthropic network error: ${msg}`, 'anthropic');
    }

    if (response.status === 429) {
      throw new ProviderError('Anthropic rate limit exceeded; retry after backoff', 'anthropic');
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ProviderError(`Anthropic API error ${response.status}: ${body}`, 'anthropic');
    }

    const data = (await response.json()) as AnthropicMessagesResponse;
    const block = data.content?.[0];
    if (!block || block.type !== 'text') {
      throw new ProviderError('Anthropic returned no text content', 'anthropic');
    }

    return {
      content: block.text,
      tokensUsed: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    };
  }
}
