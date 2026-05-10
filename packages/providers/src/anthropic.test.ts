import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnthropicProvider } from './anthropic.js';
import { ProviderError } from './interface.js';

const FAKE_KEY = 'sk-ant-test-fake';
const MODEL = 'claude-haiku-4-5-20251001';

function makeProvider(): AnthropicProvider {
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;
  return new AnthropicProvider({ model: MODEL });
}

function okResponse(text: string, inputTokens = 10, outputTokens = 20): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: 'text', text }],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('AnthropicProvider', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse('["finding"]'));
    process.env.ANTHROPIC_API_KEY = FAKE_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('throws ProviderError when ANTHROPIC_API_KEY is missing', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new AnthropicProvider({ model: MODEL })).toThrow(ProviderError);
    expect(() => new AnthropicProvider({ model: MODEL })).toThrow('ANTHROPIC_API_KEY');
  });

  it('sends POST to correct URL with x-api-key header', async () => {
    const provider = makeProvider();
    await provider.complete('hello');

    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init?.headers as Record<string, string>)['x-api-key']).toBe(FAKE_KEY);
    expect((init?.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
  });

  it('sends model and prompt in request body', async () => {
    const provider = makeProvider();
    await provider.complete('test prompt');

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body['model']).toBe(MODEL);
    expect((body['messages'] as Array<{ role: string; content: string }>)[0]?.content).toBe('test prompt');
  });

  it('returns content and summed tokensUsed from response', async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse('result text', 15, 35));
    const provider = makeProvider();
    const result = await provider.complete('prompt');
    expect(result.content).toBe('result text');
    expect(result.tokensUsed).toBe(50);
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

  it('throws ProviderError when response has no text block', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: 'tool_use', id: 'x' }], usage: { input_tokens: 0, output_tokens: 0 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const provider = makeProvider();
    await expect(provider.complete('x')).rejects.toThrow('no text content');
  });

  it('forwards maxTokens option', async () => {
    const provider = makeProvider();
    await provider.complete('p', { maxTokens: 1024 });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body['max_tokens']).toBe(1024);
  });
});
