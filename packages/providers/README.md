# @engagement-harness/providers

Provider abstraction for Engagement Harness. Defines the `Provider` interface and ships three implementations: `MockProvider`, `AnthropicProvider`, and `OpenAIProvider`.

---

## Key Modules

| File | Purpose |
|---|---|
| `src/interface.ts` | `Provider` interface, `CompletionOptions`, `CompletionResult`, error classes |
| `src/mock.ts` | `MockProvider` — deterministic or scripted responses, no API key required |
| `src/anthropic.ts` | `AnthropicProvider` — calls Anthropic `/v1/messages` |
| `src/openai.ts` | `OpenAIProvider` — calls OpenAI `/v1/chat/completions` |
| `src/registry.ts` | `ProviderRegistry` — register, resolve, and list providers |

---

## Key Exported Types and Classes

```typescript
// Provider interface
export interface Provider {
  readonly name: string;
  complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult>;
}

export interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResult {
  content: string;
  tokensUsed?: number;
}

// Registry
export class ProviderRegistry {
  register(name: string, factory: () => Provider): void;
  has(name: string): boolean;
  get(name: string): Provider;
  list(): string[];
  reset(): void;
}

// Error classes
export class NotImplementedError extends Error {}
export class ProviderError extends Error {}
```

---

## MockProvider Behavior

`MockProvider` ships two modes:

**Deterministic mode** (default): Matches the `Dimension: <value>` line in the prompt against a fixture map and returns canned `CandidateFinding[]`. Patches fixture file/line references to match actual diff paths when possible.

**Scripted mode**: Looks up a response by SHA256 hash of the first 200 characters of the prompt. Used for reproducible testing of specific prompt content.

```typescript
// Deterministic — returns fixtures for the matched dimension
const mock = new MockProvider();

// Scripted — matches exact prompt hashes
const mock = new MockProvider({ scripts: { [hash]: jsonArrayString } });
```

---

## Usage

```typescript
import { ProviderRegistry, AnthropicProvider, MockProvider } from '@engagement-harness/providers';

const registry = new ProviderRegistry();
// Built-in providers are pre-registered: 'mock', 'anthropic', 'openai'

const provider = registry.get('anthropic');
const result = await provider.complete('Your prompt here', { maxTokens: 4096 });
console.log(result.content);
```

**Environment variables:**

| Provider | Variable |
|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` |
| `openai` | `OPENAI_API_KEY` |

---

## Registering a Custom Provider

```typescript
import { ProviderRegistry } from '@engagement-harness/providers';
import type { Provider, CompletionResult } from '@engagement-harness/providers';

class MyProvider implements Provider {
  readonly name = 'my-provider';
  async complete(prompt: string): Promise<CompletionResult> {
    // call your API
    return { content: '[]', tokensUsed: 0 };
  }
}

const registry = new ProviderRegistry();
registry.register('my-provider', () => new MyProvider());
```

Then reference it in `config.json`:
```json
{ "models": { "security": "my-provider" } }
```

---

## Dependencies

- `@engagement-harness/core` — `CandidateFindingSchema` for fixture validation
