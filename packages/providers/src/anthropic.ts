import type { CompletionOptions, CompletionResult, Provider } from './interface.js';
import { ProviderError } from './interface.js';

export interface AnthropicProviderConfig {
  model: string;
}

interface AnthropicMessagesResponse {
  content: Array<{ type: string; text: string }>;
  usage?: { input_tokens: number; output_tokens: number };
}

export class AnthropicProvider implements Provider {
  public readonly name = 'anthropic';
  protected readonly config: AnthropicProviderConfig;

  constructor(config: AnthropicProviderConfig) {
    this.config = config;
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable not set. Get one at https://console.anthropic.com/settings/keys',
      );
    }

    let response: Response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model || 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: options?.maxTokens ?? 4000,
          temperature: options?.temperature ?? 0.7,
        }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderError(`Anthropic network error: ${msg}`, 'anthropic');
    }

    if (response.status === 429) {
      throw new ProviderError(
        'Anthropic rate limit exceeded. Wait and retry, or upgrade your plan.',
        'anthropic',
      );
    }

    if (!response.ok) {
      throw new ProviderError(
        `Anthropic request failed: HTTP ${response.status} ${response.statusText}`,
        'anthropic',
      );
    }

    let data: AnthropicMessagesResponse;
    try {
      data = (await response.json()) as AnthropicMessagesResponse;
    } catch {
      throw new ProviderError('Anthropic returned malformed JSON response', 'anthropic');
    }

    const block = data.content?.[0];
    if (!block || block.type !== 'text' || typeof block.text !== 'string') {
      throw new ProviderError('Anthropic response missing content[0].text', 'anthropic');
    }

    const tokensUsed =
      data.usage !== undefined
        ? (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0)
        : undefined;

    return { content: block.text, tokensUsed };
  }
}
