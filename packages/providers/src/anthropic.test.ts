import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnthropicProvider } from './anthropic.js';
import { ProviderError } from './interface.js';

const FAKE_KEY = 'sk-ant-test-key';

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AnthropicProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env['ANTHROPIC_API_KEY'] = FAKE_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('returns content and tokensUsed on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({
        content: [{ type: 'text', text: 'Hello from Anthropic' }],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    );

    const provider = new AnthropicProvider({ model: 'claude-sonnet-4-20250514' });
    const result = await provider.complete('Say hello');

    expect(result.content).toBe('Hello from Anthropic');
    expect(result.tokensUsed).toBe(30);
  });

  it('sends correct headers and body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({
        content: [{ type: 'text', text: 'ok' }],
      }),
    );

    const provider = new AnthropicProvider({ model: 'claude-opus-4-7' });
    await provider.complete('test prompt', { maxTokens: 200, temperature: 0.2 });

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(FAKE_KEY);
    expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['model']).toBe('claude-opus-4-7');
    expect(body['max_tokens']).toBe(200);
    expect(body['temperature']).toBe(0.2);
    expect((body['messages'] as Array<{ role: string; content: string }>)[0]?.content).toBe(
      'test prompt',
    );
  });

  it('throws clear error when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    const provider = new AnthropicProvider({ model: 'claude-sonnet-4-20250514' });
    await expect(provider.complete('hello')).rejects.toThrow(
      'ANTHROPIC_API_KEY environment variable not set',
    );
  });

  it('throws ProviderError on network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));
    const provider = new AnthropicProvider({ model: 'claude-sonnet-4-20250514' });
    const err = await provider.complete('hello').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as Error).message).toContain('Anthropic network error');
  });

  it('throws ProviderError on 429 rate limit', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 429 }));
    const provider = new AnthropicProvider({ model: 'claude-sonnet-4-20250514' });
    await expect(provider.complete('hello')).rejects.toThrow('Anthropic rate limit exceeded');
  });

  it('throws ProviderError on non-200 HTTP status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
    const provider = new AnthropicProvider({ model: 'claude-sonnet-4-20250514' });
    await expect(provider.complete('hello')).rejects.toThrow('Anthropic request failed: HTTP 403');
  });

  it('throws ProviderError on malformed JSON response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('not json', { status: 200 }));
    const provider = new AnthropicProvider({ model: 'claude-sonnet-4-20250514' });
    await expect(provider.complete('hello')).rejects.toThrow('malformed JSON');
  });

  it('throws ProviderError when content array is empty', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ content: [] }));
    const provider = new AnthropicProvider({ model: 'claude-sonnet-4-20250514' });
    await expect(provider.complete('hello')).rejects.toThrow('no text content block');
  });

  it('omits tokensUsed when usage is absent', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ content: [{ type: 'text', text: 'hi' }] }),
    );
    const provider = new AnthropicProvider({ model: 'claude-sonnet-4-20250514' });
    const result = await provider.complete('hello');
    expect(result.tokensUsed).toBeUndefined();
  });
});
