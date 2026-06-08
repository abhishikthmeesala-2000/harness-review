# @engagement-harness/providers

Provider abstraction for Engagement Harness. Defines the `Provider` interface and ships three implementations: `MockProvider`, `AnthropicProvider`, and `OpenAIProvider`. Includes a `ProviderRegistry` for name-based lookup.

---

## Installation

```bash
pnpm add @engagement-harness/providers
```

---

## Provider Interface

```typescript
interface Provider {
  readonly name: string;
  readonly model?: string;
  complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult>;
}

interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
  system?: string;           // system prompt in a dedicated role
  extendedThinking?: number; // thinking budget in tokens (min 1024; forces temp=1)
}

interface CompletionResult {
  content: string;
  tokensUsed?: number;
}
```

---

## Implementations

### MockProvider

Returns deterministic fixture responses without making any API calls. Used by default when no provider is routed for an agent.

```typescript
import { MockProvider } from '@engagement-harness/providers';

const mock = new MockProvider();
const result = await mock.complete('analyze this diff');
// result.content is a predictable JSON array of CandidateFinding
```

---

### AnthropicProvider

Calls the Anthropic Messages API.

```typescript
import { AnthropicProvider } from '@engagement-harness/providers';

const anthropic = new AnthropicProvider({
  model: 'claude-sonnet-4-6',
  temperature: 0.1,
});

const result = await anthropic.complete(prompt, {
  system: 'You are a security reviewer...',
  maxTokens: 4000,
});
```

**Extended thinking:**

```typescript
const result = await anthropic.complete(prompt, {
  system: systemPrompt,
  extendedThinking: 8000, // 8000-token thinking budget
  // temperature is automatically omitted when extendedThinking is set
  // maxTokens is automatically set to max(4000, extendedThinking + 4000)
});
```

**Environment variable:** `ANTHROPIC_API_KEY`

**Beta header:** `anthropic-beta: interleaved-thinking-2025-05-14` (added automatically when `extendedThinking` is set)

**Rate limit handling:** HTTP 429 responses raise a `ProviderError` with a clear message to retry later.

---

### OpenAIProvider

Calls the OpenAI Chat Completions API.

```typescript
import { OpenAIProvider } from '@engagement-harness/providers';

const openai = new OpenAIProvider({
  model: 'gpt-4o',
  temperature: 0.1,
});
```

**Environment variable:** `OPENAI_API_KEY`

---

### ProviderRegistry

Name-based registry used by `ModelRouter` to resolve providers from config.

```typescript
import { ProviderRegistry } from '@engagement-harness/providers';

const registry = new ProviderRegistry();
registry.register('anthropic', new AnthropicProvider({ model: 'claude-sonnet-4-6' }));
registry.register('mock', new MockProvider());

const provider = registry.get('anthropic'); // → AnthropicProvider
const missing = registry.get('unknown');    // → undefined
```

---

## Adding a Custom Provider

Implement the `Provider` interface:

```typescript
import type { Provider, CompletionOptions, CompletionResult } from '@engagement-harness/providers';

class MyProvider implements Provider {
  readonly name = 'my-provider';
  readonly model = 'my-model-v1';

  async complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
    const response = await myApi.generate({ prompt, ...options });
    return { content: response.text, tokensUsed: response.usage.total };
  }
}
```

Register it in your application:
```typescript
registry.register('my-provider', new MyProvider());
```

Then route agents to it in config:
```json
{ "models": { "reviewer": "my-provider" } }
```

---

## Error Handling

```typescript
import { ProviderError } from '@engagement-harness/providers';

try {
  await provider.complete(prompt);
} catch (err) {
  if (err instanceof ProviderError) {
    console.error(`Provider '${err.providerName}' failed: ${err.message}`);
  }
}
```
