# Contributing to Engagement Harness

Thank you for contributing. This document covers development setup, how to add agents and CLI commands, testing requirements, and the pull request process.

---

## Development Setup

### Prerequisites

- Node.js ≥ 20
- pnpm (`npm install -g pnpm`)
- An Anthropic or OpenAI API key (optional — mock provider works for most development)

### Clone and Build

```bash
git clone https://github.com/abhishikthmeesala-2000/harness-review.git
cd harness-review
pnpm install
pnpm build
```

### Link the CLI Globally

```bash
cd packages/cli
npm link
cd ../..
```

> **Note:** `pnpm link --global` (no-argument form) was removed in pnpm v11. Use `npm link` from the CLI package directory instead.

Verify the link:

```bash
engagement-harness --help
```

### Development Scripts

```bash
pnpm build         # compile all packages (TypeScript project references)
pnpm build:clean   # clean and recompile from scratch
pnpm test          # run all Vitest tests
pnpm test:watch    # run tests in watch mode
pnpm typecheck     # type-check without emitting
pnpm lint          # ESLint all package sources
pnpm format        # Prettier all package sources
pnpm format:check  # check formatting without writing
```

---

## Repository Structure

```
packages/
├── core/       Zod schemas, config loader, ContextEngine, SecretRedactor, ALM adapters
├── providers/  MockProvider, AnthropicProvider, OpenAIProvider, ProviderRegistry
├── agents/     BaseAgent, 9 specialist agents, AgentOrchestrator, ModelRouter
├── pipeline/   FindingPipeline (7 stages), EvidenceScorer, TruthVerifierAgent,
│               ConfidenceScorer, Deduplicator, QualityGate, PolicyEngine, FindingTracker
├── reports/    ReportGenerator, JSON/Markdown/HTML renderers
├── feedback/   ReactionCollector, FeedbackStore, MetricsCalculator
├── eval/       EvalRunner, EvalCase schema, FeedbackImporter
├── ci/         GitHubCommenter (inline diff + summary comments)
└── cli/        Commander.js entry point, all command implementations
```

Each package is a TypeScript project reference target (`tsconfig.json` extends `../../tsconfig.base.json`). Tests live alongside source files with `.test.ts` suffix.

---

## Adding a New Agent

### Step 1: Create the agent file

```
packages/agents/src/my-agent.ts
```

Extend `BaseAgent` and implement `buildPrompt()` and `getAgentDimension()`:

```typescript
import { BaseAgent } from './base-agent.js';
import type { ContextBundle } from '@engagement-harness/core';

export class MyAgent extends BaseAgent {
  getAgentDimension(): string {
    return 'my-dimension';
  }

  buildPrompt(context: ContextBundle): string | null {
    // return null to short-circuit (no API call made)
    if (context.changedFiles.length === 0) return null;
    return `...your system prompt...`;
  }
}
```

### Step 2: Register in the orchestrator

In `packages/agents/src/orchestrator.ts`, add to `AGENT_FACTORIES`:

```typescript
'my-agent': (config) => new MyAgent(config),
```

And add to `DEFAULT_AGENT_IDS`:

```typescript
export const DEFAULT_AGENT_IDS = [
  'reviewer', 'security', /* ... */ 'my-agent',
];
```

### Step 3: Add tests

Create `packages/agents/src/my-agent.test.ts`. Tests must cover:
- Normal finding output (valid JSON array)
- Short-circuit condition (returns `null` when applicable)
- Extended thinking configuration (if used)

### Agent short-circuit patterns

Return `null` from `buildPrompt()` to skip the provider call entirely:
- No relevant files: `if (!hasMigrationFiles(context)) return null`
- Insufficient diff: `if (context.changedLines < 20) return null`
- Missing metadata: `if (!context.prMetadata) return null`
- No rule files: `if (context.ruleFiles.length === 0) return null`

---

## Adding a New CLI Command

### Create the command file

```
packages/cli/src/commands/my-command.ts
```

```typescript
import { Command } from 'commander';

export function createMyCommand(): Command {
  return new Command('my-command')
    .description('What it does')
    .option('--flag <value>', 'Flag description')
    .action(async (options) => {
      // implementation
    });
}
```

### Register in the program

In `packages/cli/src/index.ts`, import and add:

```typescript
import { createMyCommand } from './commands/my-command.js';
program.addCommand(createMyCommand());
```

### Add tests

Create `packages/cli/src/commands/my-command.test.ts` using Vitest. Mock external dependencies with `vi.mock()`. See existing command tests for patterns.

---

## Adding a Pipeline Stage

The pipeline is defined in `packages/pipeline/src/pipeline.ts`. Stages run sequentially; each receives the output of the previous stage.

To add a stage:
1. Create `packages/pipeline/src/my-stage.ts` with a class that has a `run(findings, context)` method
2. Add it to the pipeline sequence in `pipeline.ts`
3. Add any new metrics fields to `PipelineMetrics` in `packages/pipeline/src/types.ts`
4. Write tests covering pass-through, rejection, and edge cases

---

## Testing

All code contributions must include Vitest tests. The project uses Vitest 2.x with coverage via `@vitest/coverage-v8`.

```bash
pnpm test              # run all tests once
pnpm test:watch        # watch mode during development
```

**Test conventions:**
- Test files: `src/**/*.test.ts` (co-located with source)
- Use `vi.mock()` for external dependencies (file system, network, providers)
- Agent tests: verify both normal output and short-circuit conditions
- Pipeline tests: test each stage in isolation and as part of the full pipeline
- CLI tests: mock provider calls; test command parsing and output

**Do not mock the database or real provider responses when the behavior under test depends on them.** Use `MockProvider` from `packages/providers/src/` for provider interactions in agent and pipeline tests.

---

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

feat(agents): add specialist personas with extended thinking
fix(ci): upsert summary comment instead of posting new each run
docs(readme): update test count badge to 566
test(cli): fix review.test.ts mock to serve [] for issue-comments GET
chore: apply prettier formatting repo-wide
```

Types: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `perf`

Scopes: `agents`, `pipeline`, `providers`, `ci`, `cli`, `core`, `feedback`, `eval`, `reports`

---

## Pull Request Process

1. **Branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```

2. **Make changes** with tests. Run the full suite before pushing:
   ```bash
   pnpm test && pnpm typecheck && pnpm lint
   ```

3. **Open a PR** against `main`. The PR description should explain *why* the change is needed, not just what changed.

4. **CI must pass**: all 58 test files, TypeScript compilation, and ESLint.

5. **One approval required** from a maintainer before merge.

---

## Code Style

- **TypeScript strict mode** — no `any`, no `// @ts-ignore`
- **No comments on obvious code** — well-named identifiers document themselves
- **Comment only the WHY** — hidden constraints, subtle invariants, workarounds for specific bugs
- **No placeholder TODOs** — if something is incomplete, don't merge it
- Formatting is enforced by Prettier; run `pnpm format` before committing

---

## Questions

Open a [GitHub Discussion](https://github.com/abhishikthmeesala-2000/harness-review/discussions) or file an issue with the `question` label.
