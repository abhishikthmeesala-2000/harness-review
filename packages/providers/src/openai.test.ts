import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderError } from './interface.js';
import { OpenAIProvider } from './openai.js';

const FAKE_KEY = 'sk-test-openai-key';

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OpenAIProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env['OPENAI_API_KEY'] = FAKE_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
  });

  it('returns content and tokensUsed on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({
        choices: [{ message: { content: 'Hello from OpenAI' } }],
        usage: { total_tokens: 42 },
      }),
    );

    const provider = new OpenAIProvider({ model: 'gpt-4o-mini' });
    const result = await provider.complete('Say hello');

    expect(result.content).toBe('Hello from OpenAI');
    expect(result.tokensUsed).toBe(42);
  });

  it('sends correct headers and body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({
        choices: [{ message: { content: 'ok' } }],
      }),
    );

    const provider = new OpenAIProvider({ model: 'gpt-4o' });
    await provider.complete('test prompt', { maxTokens: 100, temperature: 0.1 });

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${FAKE_KEY}`);

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['model']).toBe('gpt-4o');
    expect(body['max_tokens']).toBe(100);
    expect(body['temperature']).toBe(0.1);
    expect((body['messages'] as Array<{ role: string; content: string }>)[0]?.content).toBe(
      'test prompt',
    );
  });

  it('throws clear error when OPENAI_API_KEY is not set', async () => {
    delete process.env['OPENAI_API_KEY'];
    const provider = new OpenAIProvider({ model: 'gpt-4o-mini' });
    await expect(provider.complete('hello')).rejects.toThrow(
      'OPENAI_API_KEY environment variable not set',
    );
  });

  it('throws ProviderError on network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));
    const provider = new OpenAIProvider({ model: 'gpt-4o-mini' });
    const err = await provider.complete('hello').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as Error).message).toContain('OpenAI network error');
  });

  it('throws ProviderError on 429 rate limit', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 429 }));
    const provider = new OpenAIProvider({ model: 'gpt-4o-mini' });
    await expect(provider.complete('hello')).rejects.toThrow('OpenAI rate limit exceeded');
  });

  it('throws ProviderError on non-200 HTTP status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
    const provider = new OpenAIProvider({ model: 'gpt-4o-mini' });
    await expect(provider.complete('hello')).rejects.toThrow('OpenAI request failed: HTTP 401');
  });

  it('throws ProviderError on malformed JSON response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('not json', { status: 200 }));
    const provider = new OpenAIProvider({ model: 'gpt-4o-mini' });
    await expect(provider.complete('hello')).rejects.toThrow('malformed JSON');
  });

  it('throws ProviderError when choices array is missing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ choices: [] }));
    const provider = new OpenAIProvider({ model: 'gpt-4o-mini' });
    await expect(provider.complete('hello')).rejects.toThrow('choices[0].message.content');
  });
});
