# Providers Reference

## Provider Interface

Every provider must implement the following TypeScript interface from `packages/providers/src/interface.ts`:

```typescript
export interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResult {
  content: string;
  tokensUsed?: number;
}

export interface Provider {
  readonly name: string;
  complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult>;
}
```

The `name` property is used to tag every `CandidateFinding` with `modelProvider` and appears in report metadata. `complete()` receives the full agent prompt and must return the raw text response. `tokensUsed` is optional but recommended for cost tracking.

---

## MockProvider

**Package:** `@engagement-harness/providers`  
**Provider name:** `mock`  
**Default:** yes — all agents route to mock unless overridden in `config.models`

The `MockProvider` returns canned JSON responses without making any network calls. It is the safe default for all development, testing, and CI runs that do not have API keys configured.

### Modes

**Deterministic mode** (default) — The provider checks the prompt text (lowercased) against a keyword fixture map. The first key that is a substring of the prompt wins. The default fixture map is keyed on `dimension: <name>` strings that every agent's `BaseAgent.promptTemplate()` emits, so each agent dimension reliably maps to one pre-built finding:

| Fixture key | Returns |
|---|---|
| `dimension: security` | One security finding (`EH-MOCK-SEC-1`) |
| `dimension: correctness` | One correctness finding (`EH-MOCK-CORR-1`) |
| `dimension: testing` | One testing finding (`EH-MOCK-TEST-1`) |
| `dimension: domain-policy` | One domain-policy finding (`EH-MOCK-DP-1`) |
| `dimension: data` | One data finding (`EH-MOCK-DATA-1`) |
| `dimension: observability` | One observability finding (`EH-MOCK-OBS-1`) |
| `dimension: design` | One design finding (`EH-MOCK-DES-1`) |
| `dimension: intent-gap` | One intent-gap finding (`EH-MOCK-INT-1`) |
| `dimension: remediation` | One `RemediationPlan` JSON object |

When no key matches, the provider returns `[]` (empty candidate list). Agents handle empty results gracefully.

**Scripted mode** — The provider loads a JSON file at `scriptPath`. Each key is a 16-character hex hash computed from the first 200 characters of the prompt. When the hash matches, the stored string is returned verbatim. Use `MockProvider.scriptKey(agentId, prompt)` to compute the key when building fixture files.

```typescript
// Scripted mode — hash lookup from a fixture file
const provider = new MockProvider({
  mode: 'scripted',
  scriptPath: '.engagement-harness/fixtures/my-run.json',
});
```

### Overriding fixtures

Pass a `fixtures` map to replace the default keyword map in deterministic mode:

```typescript
const provider = new MockProvider({
  fixtures: {
    'dimension: security': JSON.stringify([{ /* custom finding */ }]),
  },
});
```

Only the keys present in the override map are used; the default fixtures are completely replaced.

---

## OpenAI Provider

**Package:** `@engagement-harness/providers`  
**Provider name:** `openai`  
**Status:** registered in `ProviderRegistry`; `complete()` implementation pending (throws `NotImplementedError` until Phase 8 wiring is complete)

**Environment variable:** `OPENAI_API_KEY`

**Config field:** `providers.openai.model` — required when any agent routes to `"openai"`.

```json
{
  "providers": {
    "openai": { "model": "gpt-4o" }
  },
  "models": {
    "reviewer": "openai",
    "security": "openai"
  }
}
```

The provider constructor will read `OPENAI_API_KEY` from the environment at call time. If the env var is absent when `complete()` is invoked, a `ProviderError` is thrown and the orchestrator logs a warning for that agent.

---

## Anthropic Provider

**Package:** `@engagement-harness/providers`  
**Provider name:** `anthropic`  
**Status:** registered in `ProviderRegistry`; `complete()` implementation pending (throws `NotImplementedError` until Phase 8 wiring is complete)

**Environment variable:** `ANTHROPIC_API_KEY`

**Config field:** `providers.anthropic.model` — required when any agent routes to `"anthropic"`.

```json
{
  "providers": {
    "anthropic": { "model": "claude-opus-4-5" }
  },
  "models": {
    "reviewer": "anthropic",
    "security": "anthropic"
  }
}
```

The provider constructor will read `ANTHROPIC_API_KEY` from the environment at call time. If the env var is absent when `complete()` is invoked, a `ProviderError` is thrown and the orchestrator logs a warning for that agent.

---

## Adding a New Provider

1. Create a class implementing the `Provider` interface from `@engagement-harness/providers`.
2. Set `readonly name` to a unique lowercase identifier.
3. Implement `complete(prompt, options?)` to call your API and return a `CompletionResult`.
4. Register the provider using `ProviderRegistry.register()`:

```typescript
import { ProviderRegistry } from '@engagement-harness/providers';

ProviderRegistry.register('my-provider', (config) => {
  return new MyProvider({ apiKey: process.env.MY_PROVIDER_KEY });
});
```

5. Users can then route agents to your provider by setting `models.<agentId>: "my-provider"` in their config.

The `ProviderRegistry.register()` call must run before the orchestrator processes any agents. The recommended place is in the CLI entry point or in an initialization module that is imported before `review` runs.

---

## Routing

The `ModelRouter` in `packages/agents/src/router.ts` resolves the provider for each agent:

1. Look up `config.models[agentId]`. If absent, use `"mock"`.
2. Check whether the resolved name is registered in `ProviderRegistry`. If not, fall back to `"mock"` and emit a warning.
3. Call `ProviderRegistry.get(resolvedName, config)` to construct the provider instance.

The fallback-to-mock behavior means that a misconfigured or unavailable provider never hard-crashes the review run; the affected agents return mock findings instead and a warning is written to stderr.

```json
{
  "models": {
    "reviewer": "anthropic",
    "security": "openai",
    "testing": "mock"
  }
}
```

Agents not listed in `models` silently default to `"mock"`. There is no error for missing entries.
