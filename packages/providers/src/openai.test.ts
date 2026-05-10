import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderError } from './interface.js';
import { OpenAIProvider } from './openai.js';

const FAKE_KEY = 'sk-test-openai-fake';
const MODEL = 'gpt-4o-mini';

function makeProvider(): OpenAIProvider {
  process.env.OPENAI_API_KEY = FAKE_KEY;
  return new OpenAIProvider({ model: MODEL });
}

function okResponse(content: string, totalTokens = 42): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { total_tokens: totalTokens },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('OpenAIProvider', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse('["finding"]'));
    process.env.OPENAI_API_KEY = FAKE_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  it('throws ProviderError when OPENAI_API_KEY is missing', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenAIProvider({ model: MODEL })).toThrow(ProviderError);
    expect(() => new OpenAIProvider({ model: MODEL })).toThrow('OPENAI_API_KEY');
  });

  it('sends POST to correct URL with Authorization header', async () => {
    const provider = makeProvider();
    await provider.complete('hello');

    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${FAKE_KEY}`);
  });

  it('sends model and prompt in request body', async () => {
    const provider = makeProvider();
    await provider.complete('test prompt');

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body['model']).toBe(MODEL);
    expect((body['messages'] as Array<{ role: string; content: string }>)[0]?.content).toBe('test prompt');
  });

  it('returns content and tokensUsed from response', async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse('result text', 99));
    const provider = makeProvider();
    const result = await provider.complete('prompt');
    expect(result.content).toBe('result text');
    expect(result.tokensUsed).toBe(99);
  });

  it('throws ProviderError on 429 rate limit', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('rate limited', { status: 429 }));
    const provider = makeProvider();
    await expect(provider.complete('x')).rejects.toThrow('rate limit');
  });

  it('throws ProviderError on non-ok status', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('bad request', { status: 400 }));
    const provider = makeProvider();
    await expect(provider.complete('x')).rejects.toBeInstanceOf(ProviderError);
  });

  it('throws ProviderError on network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));
    const provider = makeProvider();
    await expect(provider.complete('x')).rejects.toThrow('network error');
  });

  it('throws ProviderError when response has no content', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ choices: [], usage: { total_tokens: 0 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const provider = makeProvider();
    await expect(provider.complete('x')).rejects.toThrow('no content');
  });

  it('forwards maxTokens and temperature options', async () => {
    const provider = makeProvider();
    await provider.complete('p', { maxTokens: 512, temperature: 0.5 });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body['max_tokens']).toBe(512);
    expect(body['temperature']).toBe(0.5);
  });
});
