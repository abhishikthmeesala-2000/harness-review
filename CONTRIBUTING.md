# Contributing to Engagement Harness

Thank you for contributing. This document covers development setup, how to add new agents and CLI commands, testing requirements, and the pull request process.

---

## Development Setup

**Requirements:** Node.js ≥ 20, pnpm

```bash
git clone https://github.com/abhishikthmeesala-2000/harness-review.git
cd harness-review
pnpm install       # install all workspace dependencies
pnpm build         # compile all packages (TypeScript project references)
pnpm test          # run Vitest test suite
pnpm typecheck     # type-check without emitting output
pnpm lint          # ESLint all package sources
pnpm format        # Prettier all package sources
pnpm format:check  # verify formatting without writing
```

### Watch mode

```bash
pnpm test:watch    # Vitest in watch mode — re-runs on file change
```

---

## Project Structure

```
packages/
├── core/         Schemas, config, context engine, secret redaction, ALM interface
├── providers/    Provider interface, MockProvider, AnthropicProvider, OpenAIProvider
├── agents/       BaseAgent, 9 agent implementations, orchestrator, router
├── pipeline/     7-stage FindingPipeline
├── reports/      JSON, Markdown, HTML report renderers
├── feedback/     Reaction collection, metrics storage, deduplication
├── ci/           GitHubCommenter
├── eval/         Eval runner, case schema, feedback importer
└── cli/          Commander.js entry point, all command files
```

Each package has its own `package.json`, `tsconfig.json`, and `src/` directory. TypeScript project references (`tsc -b`) compile the full workspace; individual packages are not built separately.

---

## How to Add a New Agent

### 1. Create the agent file

Create `packages/agents/src/<agent-id>.ts`. The agent ID must be kebab-case and unique.

```typescript
import type { ContextBundle } from '@engagement-harness/core';
import { BaseAgent } from './base.js';
import { FINDING_SCHEMA_BLOCK, renderDiffSummary, renderFileContext } from './prompt-utils.js';

export class MyNewAgent extends BaseAgent {
  readonly id = 'my-agent';
  readonly dimension = 'my-dimension';
  readonly description = 'One sentence description of what this agent checks.';

  promptTemplate(context: ContextBundle): string {
    return [
      'You are the MyNew agent for the Engagement Harness.',
      `Dimension: ${this.dimension}`,
      '',
      'ROLE',
      'Identify REAL issues with high confidence. Be CONSERVATIVE.',
      '',
      'WHAT TO CHECK',
      '1. Pattern to look for...',
      '   Mitigating factors: ...',
      '',
      FINDING_SCHEMA_BLOCK,
      '',
      renderDiffSummary(context),
      renderFileContext(context),
    ].join('\n');
  }
}
```

The `Dimension: <dimension>` line is required — `MockProvider`'s deterministic fixture map keys off it.

### 2. Export from the agents package

Add to `packages/agents/src/index.ts`:

```typescript
export { MyNewAgent } from './my-new-agent.js';
```

### 3. Register in the orchestrator

Add to `packages/agents/src/orchestrator.ts` — import the class and add it to the agent map.

### 4. Add the agent ID to core schemas

Add `'my-agent'` to the `DEFAULT_AGENT_IDS` array in `packages/core/src/schemas/config.ts`.

### 5. Add a MockProvider fixture

Add a fixture for `'my-dimension'` in `packages/providers/src/mock.ts` — the deterministic fixture map is keyed by the dimension string that appears in the prompt.

### 6. Add an eval case

Create a directory under `packages/eval/src/cases/my-agent-test/` with:
- `case.json` — eval case definition using `EvalCaseSchema`
- `diff.patch` — a synthetic unified diff that should trigger a finding

### 7. Write tests

Add unit tests in `packages/agents/src/__tests__/my-new-agent.test.ts` or in the same directory.

---

## How to Add a New CLI Command

### 1. Create the command file

Create `packages/cli/src/commands/my-command.ts`:

```typescript
export interface MyCommandOptions {
  flag?: boolean;
}

export async function myCommand(options: MyCommandOptions): Promise<void> {
  // implementation
}
```

### 2. Register in the CLI index

In `packages/cli/src/index.ts`, import and attach to the Commander program:

```typescript
import { myCommand, type MyCommandOptions } from './commands/my-command.js';

// inside buildProgram():
program
  .command('my-command')
  .description('What this command does')
  .option('--flag', 'Optional flag')
  .action(async (options: MyCommandOptions) => {
    await myCommand(options);
  });
```

### 3. Update the CLI README

Add the new command to `packages/cli/README.md` and to the CLI Reference section of `README.md`.

---

## Testing

Engagement Harness uses **Vitest** for all tests.

```bash
pnpm test           # run all tests once
pnpm test:watch     # watch mode
```

### Coverage targets

- All new public functions and classes should have unit tests
- New agent implementations must have at least one eval case
- Pipeline stages should have unit tests covering the rejection and pass-through paths

### Test patterns

- Unit tests live alongside source files in the same `src/` directory (e.g., `generator.test.ts` next to `generator.ts`)
- Integration tests use the eval runner — see `packages/eval/src/runner.integration.test.ts`
- Use `packages/reports/src/test-fixtures.ts` and `packages/agents/src/test-helpers.ts` for shared test data factories

---

## Pull Request Process

1. Fork the repository and create a branch from `main`
2. Make your changes following the code style requirements below
3. Run `pnpm build && pnpm test && pnpm typecheck && pnpm lint` — all must pass
4. Open a pull request against `main` with a clear description of the change
5. Add an entry to `CHANGELOG.md` under `[Unreleased]`

---

## Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

[optional body]
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`

**Examples:**

```
feat(agents): add performance-profiling agent
fix(pipeline): correct confidence rollup for zero-finding result
docs(feedback): add reaction emoji table to FEEDBACK_SYSTEM.md
test(eval): add eval case for domain-policy with no matching rules
```

---

## Code Style

- **TypeScript strict mode** — all packages use `"strict": true`
- **No `any`** — `@typescript-eslint/no-explicit-any` is set to `warn`; avoid it in new code
- **No comments that describe what code does** — use well-named identifiers; only add a comment when the WHY is non-obvious
- **No TODO comments** in committed code — open an issue instead
- **Prettier** for formatting — run `pnpm format` before committing
- **ESLint** for linting — run `pnpm lint` before committing
- **Imports** use `.js` extensions (ESM with TypeScript project references)
