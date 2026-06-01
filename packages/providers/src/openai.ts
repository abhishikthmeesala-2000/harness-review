import type { CompletionOptions, CompletionResult, Provider } from './interface.js';
import { ProviderError } from './interface.js';

export interface OpenAIProviderConfig {
  model: string;
}

interface OpenAIChatResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: { total_tokens: number };
}

export class OpenAIProvider implements Provider {
  public readonly name = 'openai';
  public readonly model: string;
  protected readonly config: OpenAIProviderConfig;

  constructor(config: OpenAIProviderConfig) {
    this.config = config;
    this.model = config.model;
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY environment variable not set. Get one at https://platform.openai.com/api-keys',
      );
    }

    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model || 'gpt-4o-mini',
          messages: [
            ...(options?.system ? [{ role: 'system', content: options.system }] : []),
            { role: 'user', content: prompt },
          ],
          max_tokens: options?.maxTokens ?? 4000,
          temperature: options?.temperature ?? 0.1,
        }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderError(`OpenAI network error: ${msg}`, 'openai');
    }

    if (response.status === 429) {
      throw new ProviderError(
        'OpenAI rate limit exceeded. Wait and retry, or upgrade your plan.',
        'openai',
      );
    }

    if (!response.ok) {
      throw new ProviderError(
        `OpenAI request failed: HTTP ${response.status} ${response.statusText}`,
        'openai',
      );
    }

    let data: OpenAIChatResponse;
    try {
      data = (await response.json()) as OpenAIChatResponse;
    } catch {
      throw new ProviderError('OpenAI returned malformed JSON response', 'openai');
    }

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new ProviderError('OpenAI response missing choices[0].message.content', 'openai');
    }

    return { content, tokensUsed: data.usage?.total_tokens };
  }
}
