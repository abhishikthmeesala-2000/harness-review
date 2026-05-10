import { ProviderError, type CompletionOptions, type CompletionResult, type Provider } from './interface.js';

export interface OpenAIProviderConfig {
  model: string;
}

interface OpenAIChatResponse {
  choices: Array<{ message: { content: string } }>;
  usage: { total_tokens: number };
}

export class OpenAIProvider implements Provider {
  public readonly name = 'openai';

  private readonly apiKey: string;
  protected readonly config: OpenAIProviderConfig;

  constructor(config: OpenAIProviderConfig) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new ProviderError('OPENAI_API_KEY environment variable is not set', 'openai');
    this.apiKey = key;
    this.config = config;
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: options?.maxTokens ?? 4096,
          temperature: options?.temperature ?? 0,
        }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderError(`OpenAI network error: ${msg}`, 'openai');
    }

    if (response.status === 429) {
      throw new ProviderError('OpenAI rate limit exceeded; retry after backoff', 'openai');
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ProviderError(`OpenAI API error ${response.status}: ${body}`, 'openai');
    }

    const data = (await response.json()) as OpenAIChatResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new ProviderError('OpenAI returned no content', 'openai');

    return { content, tokensUsed: data.usage?.total_tokens };
  }
}
