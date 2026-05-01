# Project: Engagement Harness — Master Build Prompt

You are building a production-grade, CI-native, multi-agent pull request review platform called Engagement Harness. This prompt contains everything you need. Build it phase by phase. After each phase, STOP, run the full test suite, summarize what you built, and wait for me to say "continue" before moving on.

---

## What this project is (one paragraph)

Engagement Harness is a configurable, AI-powered code review platform that installs into a client repository, learns the repo through an interactive setup, and then runs automatically in CI on every pull request. It uses focused context selection, multiple specialized agents, model routing, finding verification, confidence scoring, and policy decisions to produce trustworthy, measurable, client-specific code review intelligence. It is not a generic AI reviewer — it is the harness around the AI that makes the AI's output usable.

---

## Core principles (NON-NEGOTIABLE)

1. **Mock-first.** All agents default to `MockProvider`. Never add live OpenAI/Anthropic API calls unless explicitly routed via config. Never hardcode API keys. Never log secrets.
2. **Headless runtime.** `review --ci` MUST NEVER prompt the user. Only `init` and `doctor` may be interactive. Detect TTY and refuse to prompt in CI.
3. **Setup ≠ runtime.** Strict separation. Setup writes config; runtime reads config. Runtime fails clearly if config is missing — it does not auto-generate.
4. **Schema-validated everything.** Use zod for config, findings, and agent I/O. Reject malformed data at every boundary with helpful error messages.
5. **Evidence-required findings.** A finding without `file`, `lineStart`, `lineEnd`, and diff-grounded evidence MUST be rejected by the verifier.
6. **Safe defaults.** Don't post comments, don't block merges, don't auto-fix code, don't commit artifacts, don't call live providers, don't expand audience of sensitive data.
7. **Deterministic tests.** MockProvider returns fixture-based responses. All tests must pass without network access. No flaky tests.
8. **Test-as-you-go.** Each phase ends with passing tests. Do not move forward with broken or skipped tests.
9. **Auditable context.** Every piece of context passed to an agent carries a `reason` field explaining why it was included.
10. **Secret redaction at the boundary.** SecretRedactor runs on diff and context BEFORE any agent or provider sees the data. No exceptions.

---

## Tech stack

- TypeScript 5.x in strict mode
- Node.js 20+
- pnpm workspaces (monorepo)
- commander.js for CLI parsing
- zod for runtime schemas
- @inquirer/prompts for interactive setup
- vitest for testing (unit + integration)
- simple-git for git operations
- micromatch for glob matching
- chalk for colored CLI output
- ESLint + Prettier with sensible defaults

Do NOT add: lodash, moment, axios, jest, mocha, husky. Keep dependencies minimal.

---

## Repository structure (build this exactly)

```
engagement-harness/
├── package.json                    # workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .eslintrc.cjs
├── .prettierrc
├── .gitignore
├── vitest.config.ts                # workspace-wide test runner
├── [README.md](http://README.md)
├── [ARCHITECTURE.md](http://ARCHITECTURE.md)                 # written in phase 8
├── [CONFIG.md](http://CONFIG.md)                       # written in phase 8
├── [AGENTS.md](http://AGENTS.md)                       # written in phase 8
├── [PROVIDERS.md](http://PROVIDERS.md)                    # written in phase 8
├── [SAFETY.md](http://SAFETY.md)                       # written in phase 8
├── RELEASE_[CHECKLIST.md](http://CHECKLIST.md)            # written in phase 8
├── packages/
│   ├── cli/                        # CLI entry, command wiring
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── bin/engagement-harness.ts
│   │   └── src/
│   │       ├── commands/           # one file per command
│   │       └── index.ts
│   ├── core/                       # schemas, config, git, context, redaction, repo profile, ALM
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── schemas/            # zod schemas
│   │       ├── config/
│   │       ├── git/
│   │       ├── context/
│   │       ├── redaction/
│   │       ├── profile/
│   │       ├── alm/
│   │       └── index.ts
│   ├── agents/                     # base agent, all agents, orchestrator, model router
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── base.ts
│   │       ├── orchestrator.ts
│   │       ├── router.ts
│   │       ├── reviewer.ts
│   │       ├── security.ts
│   │       ├── domain-policy.ts
│   │       ├── testing.ts
│   │       ├── data-architecture.ts
│   │       ├── sre-observability.ts
│   │       ├── design-principles.ts
│   │       ├── pr-intent-gap.ts
│   │       ├── remediation.ts
│   │       └── index.ts
│   ├── pipeline/                   # verifier, evidence scorer, confidence, dedup, policy, gate
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── evidence-scorer.ts
│   │       ├── verifier.ts
│   │       ├── confidence-scorer.ts
│   │       ├── deduplicator.ts
│   │       ├── quality-gate.ts
│   │       ├── policy-engine.ts
│   │       ├── pipeline.ts
│   │       └── index.ts
│   ├── reports/                    # JSON/Markdown/HTML report generators
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── json-report.ts
│   │       ├── markdown-report.ts
│   │       ├── html-report.ts
│   │       ├── generator.ts
│   │       └── index.ts
│   ├── providers/                  # MockProvider, OpenAI, Anthropic, registry
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── interface.ts
│   │       ├── mock.ts
│   │       ├── openai.ts
│   │       ├── anthropic.ts
│   │       ├── registry.ts
│   │       └── index.ts
│   └── eval/                       # eval runner, feedback system
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── case-schema.ts
│           ├── runner.ts
│           ├── feedback.ts
│           └── index.ts
└── examples/
    ├── sample-repo/                # fixture repo for integration tests
    │   ├── src/
    │   ├── package.json
    │   └── .engagement-harness/
    └── eval-cases/                 # 6 starter eval cases
```

---

## Canonical schemas (implement EXACTLY)

### Finding schema

```typescript
{
  id: string,                                      // "EH-NNNN", auto-incremented per run
  title: string,                                   // < 120 chars
  category: "correctness" | "security" | "testing"
          | "domain-policy" | "design" | "data"
          | "observability" | "intent-gap",
  dimension: string,                               // mirrors category
  severity: "low" | "medium" | "high" | "critical",
  confidence: number,                              // 0..1
  file: string,                                    // repo-relative path
  lineStart: number,                               // 1-indexed, inclusive
  lineEnd: number,                                 // 1-indexed, inclusive
  evidence: Array<{
    type: "diff" | "context" | "rule",
    content: string                                // quoted or paraphrased
  }>,                                              // MUST have >= 1 entry
  whyItMatters: string,
  suggestedFix: string,
  clientRuleReferences: string[],                  // paths into rules/
  falsePositiveRisk: "low" | "medium" | "high",
  sourceAgent: string,                             // agent ID
  modelProvider: string,                           // provider name
  verification: {
    status: "approved" | "rejected" | "pending",
    reason: string
  },
  remediationReadiness: "ready" | "needs-context" | "manual-only"
}
```

`CandidateFinding` is the same shape but `verification.status` defaults to `"pending"` and `confidence` may be unset (assigned during pipeline).

### Config schema

```typescript
{
  client: { name: string, engagement: string },
  review: {
    confidenceThreshold: number,              // default 0.8, range 0..1
    severityThreshold: "low" | "medium" | "high" | "critical",  // default "low"
    requireVerifierApproval: boolean          // default true
  },
  agents: {
    enabled: string[]                         // agent IDs (see Agent IDs below)
  },
  models: {
    [agentId: string]: string                 // provider name; default "mock"
  },
  providers: {
    mock: {},
    openai?: { model: string },
    anthropic?: { model: string }
  },
  context: {
    ignoredPaths: string[],                   // glob patterns
    maxFiles: number,                         // default 30
    maxTokens: number                         // default 80000
  },
  ci: {
    blockOnPolicy: boolean,                   // default false
    postComments: boolean,                    // default false
    artifactsOnly: boolean                    // default true
  },
  alm: {
    platform: "github" | "gitlab" | "azure-devops" | "bitbucket" | "none"
  },
  feedback: { enabled: boolean },             // default true
  reports: {
    formats: Array<"json" | "markdown" | "html">,  // default all three
    outputDir: string                         // default ".engagement-harness/reports"
  }
}
```

### Agent IDs (canonical)

```
reviewer
security
domain-policy
testing
data-architecture
sre-observability
design-principles
pr-intent-gap
remediation
verifier   (pipeline component, but registered for routing)
```

### Provider interface

```typescript
interface Provider {
  name: string;
  complete(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<{
    content: string;
    tokensUsed?: number;
  }>;
}
```

---

## Working agreement (read this carefully)

- Before writing code in each phase, **outline your plan** in 4-8 bullets covering: files you'll create, key decisions, test strategy. I'll say "go" before you implement.
- Run `pnpm test` after each significant chunk. Fix failures before moving on. Never skip tests with `it.skip` or `it.todo`.
- Use **conventional commits** per phase: `feat(phase-N): <summary>`. Make ONE commit at the end of each phase, after tests pass.
- If you discover a design issue with an earlier phase, **flag it explicitly** — don't silently rewrite. Ask me before refactoring previously committed code.
- **Never invent fields** not in the canonical schemas. If you think a field is missing, propose it in your plan and wait for approval.
- Follow the spec exactly when there's a stated default. Defaults are listed for a reason.
- If a phase's done-criteria can't be met, STOP and tell me what's blocking. Don't fudge.
- All files: 2-space indent, single quotes, no semicolons in TypeScript only where Prettier omits them, ES modules (`type: "module"` in package.json), `.js` extensions in import paths for ESM compatibility.

---

# PHASE 1 — Scaffold and CLI skeleton

**Objective:** Working monorepo with all 11 CLI commands stubbed.

**Tasks:**

1. Initialize the pnpm workspace at the root with `pnpm-workspace.yaml` listing `packages/*`. Set `"type": "module"` in the root package.json. Add scripts: `build`, `test`, `lint`, `format`, `typecheck`.

2. Create `tsconfig.base.json` with strict mode, target ES2022, module NodeNext, declaration true, sourceMap true. Each package extends it.

3. Create all 7 packages (`cli`, `core`, `agents`, `pipeline`, `reports`, `providers`, `eval`) with their own package.json, tsconfig.json, and an empty `src/index.ts`. Wire workspace dependencies (e.g., `cli` depends on `core`, `agents`, `pipeline`, `reports`, `providers`, `eval`).

4. Configure vitest at the root with a workspace-wide test runner. Tests live next to source files as `*.test.ts`.

5. Set up ESLint + Prettier with TypeScript support. Add `.eslintrc.cjs` and `.prettierrc`.

6. In `packages/cli`:
   - Create `bin/engagement-harness.ts` as the CLI entry. It must have a shebang `#!/usr/bin/env node` and call into `src/index.ts`.
   - Wire commander.js with these 11 commands. Each prints `"<command> not yet implemented"` and exits 0:
     `init`, `doctor`, `review` (with `--ci` boolean flag), `report` (with `--latest` and `--run <id>`), `config validate`, `agents list`, `models list`, `models validate`, `ci templates` (with `--platform <name>`), `eval`, `feedback import <file>`, `remediate` (with `--finding <id>`).
   - Add global `--version` and `--help`.
   - Make the package's `bin` field point to `dist/bin/engagement-harness.js`.

7. Add `.gitignore` covering: `node_modules`, `dist`, `*.log`, `.engagement-harness/reports`, `.engagement-harness/feedback`, `.DS_Store`, `coverage`.

8. Create root `[README.md](http://README.md)` with: project description, install instructions (`pnpm install && pnpm build && cd packages/cli && pnpm link --global`), basic usage example, link to docs (placeholder).

9. **Smoke tests in `packages/cli/src/index.test.ts`:** programmatically invoke each command stub, assert exit code 0, assert expected stdout. Use `child_process.execSync` against the built binary, or directly invoke the commander program.

**Done when:**
- `pnpm install && pnpm build && pnpm test && pnpm lint && pnpm typecheck` ALL succeed
- `engagement-harness --help` lists all 11 commands
- All command stubs print their placeholder and exit 0
- All smoke tests pass
- Repo is clean: no leftover scaffolding files, no commented-out code

**STOP. Summarize files created, test count, any deviations. Wait for "continue".**

---

# PHASE 2 — Config system, repo profiler, init, doctor

**Objective:** A consultant can run `init` interactively and `doctor` to validate setup.

**Tasks:**

1. In `packages/core/src/schemas/config.ts`:
   - Define `ConfigSchema` (zod) matching the canonical schema EXACTLY. Export inferred type `Config`.
   - Add helpful error messages on each field (e.g., `confidenceThreshold` must be `.min(0).max(1)` with message `"must be between 0 and 1"`).
   - Default values per the canonical schema.

2. In `packages/core/src/config/loader.ts`:
   - `ConfigLoader.load(repoRoot: string): Config` — reads `.engagement-harness/config.json`, parses, validates, returns. Throws `ConfigNotFoundError` or `ConfigInvalidError` with paths.
   - `[ConfigLoader.save](http://ConfigLoader.save)(repoRoot: string, config: Config): void` — writes config back as pretty JSON.
   - `ConfigLoader.exists(repoRoot: string): boolean`.

3. In `packages/core/src/profile/profiler.ts`:
   - `RepoProfiler.detect(repoRoot: string): RepoProfile`
   - Detect: language (by file extension scan, top language wins), framework (parse package.json/requirements.txt/go.mod/Cargo.toml/pom.xml), package manager (lockfiles), test framework (devDependencies / config files), CI provider (`.github/workflows`, `.gitlab-ci.yml`, `azure-pipelines.yml`, `bitbucket-pipelines.yml`), monorepo (workspaces, lerna.json, nx.json, turbo.json), important folders (src/, tests/, docs/, scripts/), monorepo root paths if applicable.
   - Return shape: `{ language, framework, packageManager, testFramework, ciProvider, isMonorepo, importantPaths, suggestedIgnoredPaths }`.
   - Be defensive: missing files return null fields, never throw.

4. In `packages/cli/src/commands/init.ts`:
   - Run RepoProfiler, then use @inquirer/prompts to confirm/override.
   - Prompts: client name, engagement name, confirm language, confirm framework, ALM platform select, agents multi-select (default all enabled), confidence threshold number (default 0.8), severity threshold select, ignored paths editor (pre-filled with detected suggestions), block on policy yes/no (default no), post comments yes/no (default no).
   - Add `--yes` flag for non-interactive mode that takes all defaults and uses detection.
   - On confirm, scaffold the directory tree:
```
     .engagement-harness/
       config.json
       rules/[README.md](http://README.md)
       evals/[README.md](http://README.md)
       reports/.gitkeep
       feedback/.gitkeep
       examples/[README.md](http://README.md)
```
   - Each README explains the folder's purpose in 3-5 sentences.
   - Append `.engagement-harness/reports/` and `.engagement-harness/feedback/` to repo `.gitignore` if not already present.
   - Print success message with next steps (`run engagement-harness doctor`).

5. In `packages/cli/src/commands/doctor.ts`:
   - Load config; if missing, print clear error and exit 1.
   - Validate config; on error, print zod issues with paths and exit 1.
   - Check git is available (`git --version`); fail clearly if not.
   - Check write access to reports dir; fail clearly if not.
   - List enabled agents and the provider routed to each.
   - Print colored ✓/✗ checklist with chalk. Green = pass, red = fail, yellow = warn.
   - Exit 0 if all pass, 1 if any fail.

6. In `packages/cli/src/commands/config-validate.ts`:
   - Load and validate. Print zod errors human-friendly. Exit 0/1.

7. **Tests:**
   - Unit: ConfigSchema rejects invalid configs (out-of-range threshold, bad enum, missing required field). Each rejection asserts the specific error message.
   - Unit: RepoProfiler against fixture repos in `tests/fixtures/`: `ts-node-pnpm`, `python-pytest`, `go-modules`, `monorepo-pnpm`. Assert each detected field.
   - Integration: spawn `init --yes` non-interactively in a tmpdir; assert config file written, valid, contains expected defaults.
   - Integration: `doctor` succeeds on valid config, fails clearly with exit 1 on missing/invalid config.
   - Integration: `config validate` exits 0 on valid config, 1 on invalid with specific stderr.

**Done when:** All Phase 1 tests still pass + Phase 2 tests pass; running `init --yes` in a tmpdir produces a valid config; `doctor` reports green on a clean install.

**STOP. Summarize. Wait for "continue".**

---

# PHASE 3 — Git diff parser, context engine, secret redaction

**Objective:** Given a base/head ref, produce a redacted, budget-respecting context bundle with reasons.

**Tasks:**

1. In `packages/core/src/git/diff-parser.ts`:
   - `GitDiffParser` class wrapping `simple-git`.
   - `parseDiff(repoRoot: string, baseRef: string, headRef: string): Promise<FileDiff[]>`.
   - `FileDiff` shape:
```typescript
     {
       path: string,
       oldPath?: string,                    // for renames
       status: "added" | "modified" | "deleted" | "renamed" | "binary",
       hunks: Array<{
         oldStart: number,
         oldLines: number,
         newStart: number,
         newLines: number,
         lines: Array<{
           type: "added" | "removed" | "context",
           content: string,
           lineNumber: number              // line in NEW file (or OLD for removed)
         }>
       }>
     }
```
   - Skip binaries from full parsing (mark status: "binary", empty hunks).
   - Handle: added, modified, deleted, renamed, binary. Test each.

2. In `packages/core/src/context/engine.ts`:
   - `[ContextEngine.build](http://ContextEngine.build)(diff: FileDiff[], repoRoot: string, profile: RepoProfile, config: Config): ContextBundle`
   - `ContextBundle` shape:
```typescript
     {
       entries: Array<{
         path: string,
         content: string,
         reason: string,
         priority: number,                 // higher = more important
         kind: "changed-file" | "imported-by" | "imports" | "test" | "rule"
       }>,
       diff: FileDiff[],                   // already redacted
       repoProfile: RepoProfile,
       prMetadata?: { title?: string, body?: string }
     }
```
   - Inclusion logic for each changed file:
     - The full file content (priority 100, reason: "Changed file")
     - Files that import the changed file (1-hop, priority 70, reason: "Imports changed file <path>")
     - Files imported by the changed file (1-hop, priority 60, reason: "Imported by changed file <path>")
     - Corresponding test files via heuristic: same basename with `.test.` / `.spec.` / `_test.` suffix; or in `tests/` mirror path; or in `__tests__/` sibling (priority 80, reason: "Test file for <path>")
     - Matching rules from `.engagement-harness/rules/*.md` whose path glob in their frontmatter matches the changed file (priority 90, reason: "Rule applies to <path>")
   - Respect `ignoredPaths` glob patterns using `micromatch`.
   - Respect `maxFiles` and `maxTokens` budgets — drop lowest-priority entries first when over budget. Approximate tokens as `chars / 4`.
   - Import detection: regex-based for TS/JS (`import .. from '..'`, `require('..')`), Python (`import x`, `from x import y`). Best-effort, not perfect.

3. In `packages/core/src/redaction/redactor.ts`:
   - `SecretRedactor.redact(text: string): string` — replaces matches with `[REDACTED_SECRET]`.
   - Patterns:
     - AWS access keys: `AKIA[0-9A-Z]{16}`
     - GitHub tokens: `gh[psuro]_[A-Za-z0-9]{36,}`
     - Generic API keys with `sk-` prefix: `sk-[A-Za-z0-9]{20,}`
     - JWTs: `eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`
     - PEM blocks: multi-line `-----BEGIN (RSA |EC )?PRIVATE KEY-----` … `-----END ... PRIVATE KEY-----`
     - Env-style: `(SECRET|PASSWORD|TOKEN|KEY|API_KEY|ACCESS_KEY)\s*=\s*['"]?[^\s'"]{8,}`
     - Bearer tokens: `Bearer\s+[A-Za-z0-9._-]{20,}`
   - `SecretRedactor.redactBundle(bundle: ContextBundle): ContextBundle` — applies to all entry contents AND to all diff line contents. Returns a new bundle (do not mutate).
   - Document known limitations in code comments (e.g., short tokens may slip through).

4. **Tests:**
   - Unit: GitDiffParser against fixture diffs created in tmpdir git repos. Test each status type.
   - Unit: ContextEngine includes correct files, respects budgets, attaches reasons, drops by priority when over budget.
   - Unit: SecretRedactor catches each pattern with positive cases and at least one negative case per pattern.
   - Integration: full pipeline (real tmpdir git repo with planted secrets in diff → diff parsed → context built → redacted) — assert bundle is clean.

**Done when:** Tests pass. The boundary between raw repo data and agent input is the `redactBundle` call — verified by tests that planted secrets never appear in the final bundle.

**STOP. Summarize. Wait for "continue".**

---

# PHASE 4 — Agent framework and MockProvider

**Objective:** Run all enabled agents in parallel against a context bundle, producing CandidateFindings — all with MockProvider, deterministically.

**Tasks:**

1. In `packages/providers/src/interface.ts`: define the `Provider` interface (see canonical schemas above).

2. In `packages/providers/src/mock.ts`:
   - `MockProvider` implements `Provider`.
   - Two modes: `"deterministic"` (default) and `"scripted"`.
   - Deterministic mode: inspects prompt for keywords mapped in a fixture map, returns canned JSON responses. Keywords map to specific agent dimensions (e.g., prompt containing "authorization" returns a security finding template).
   - Scripted mode: takes a fixture file path, returns responses keyed by a hash of (agent ID + first 200 chars of prompt). Used for integration test reproducibility.
   - Emits valid JSON arrays of CandidateFinding shapes — never returns invalid structures (the testing layer handles malformed inputs separately).

3. In `packages/providers/src/openai.ts` and `anthropic.ts`:
   - Stub classes implementing `Provider`. `complete()` throws `NotImplementedError("Real providers wired in Phase 8")`. Constructor accepts config.

4. In `packages/providers/src/registry.ts`:
   - `ProviderRegistry.register(name, factory)`, `ProviderRegistry.get(name, config): Provider`.
   - Pre-registered: `"mock"`, `"openai"`, `"anthropic"`.

5. In `packages/agents/src/base.ts`:
   - `BaseAgent` abstract class:
```typescript
     abstract id: string;
     abstract dimension: string;
     abstract description: string;
     abstract promptTemplate(context: ContextBundle): string;
     async run(context: ContextBundle, provider: Provider): Promise<CandidateFinding[]>
```
   - Default `run()`: builds prompt, calls provider, parses JSON, validates against `CandidateFindingSchema`, tags each with `sourceAgent: [this.id](http://this.id)`, `modelProvider: [provider.name](http://provider.name)`. Drops malformed candidates with a warning (don't throw — one bad agent shouldn't kill the run).

6. In `packages/agents/src/`: implement these 4 agents in this phase (specialists come in Phase 7):
   - **`reviewer.ts`** — ReviewerAgent. Dimension: correctness. Prompt focuses on logic bugs, edge cases, risky behavior changes, off-by-one errors, null handling.
   - **`security.ts`** — SecurityAgent. Dimension: security. Prompt focuses on missing authorization, injection risks, unsafe crypto, secret exposure, tenant isolation, input validation.
   - **`domain-policy.ts`** — DomainPolicyAgent. Dimension: domain-policy. Prompt includes any rules from `.engagement-harness/rules/` that matched in the context bundle and asks the model to flag violations.
   - **`testing.ts`** — TestingAgent. Dimension: testing. Prompt focuses on missing tests, weak assertions, untested edge cases, untested negative paths.

7. In `packages/agents/src/router.ts`:
   - `ModelRouter.route(agentId: string, config: Config): Provider` — looks up `config.models[agentId]`, falls back to `"mock"`, returns provider instance from registry.

8. In `packages/agents/src/orchestrator.ts`:
   - `[AgentOrchestrator.run](http://AgentOrchestrator.run)(context: ContextBundle, config: Config): Promise<CandidateFinding[]>`:
     - Loads enabled agents from config (in this phase, only the 4 above and `verifier` are valid; later phases register more)
     - Routes each through ModelRouter
     - Runs all in parallel with `Promise.allSettled`
     - Catches per-agent failures, logs with chalk warning, continues with others
     - Concatenates successful results
     - Returns CandidateFinding[]

9. In `packages/core/src/schemas/finding.ts`:
   - `FindingSchema` and `CandidateFindingSchema` (zod), exact shapes from canonical above. Export inferred TS types.

10. **Tests:**
    - Unit: each of the 4 agents against a fixture context bundle with MockProvider. Assert correct dimension, sourceAgent tag, schema-valid output.
    - Unit: ModelRouter routes correctly per config.
    - Unit: AgentOrchestrator runs all enabled agents in parallel, aggregates results, survives a failing agent.
    - Unit: malformed provider responses are dropped (not thrown).
    - Integration: real diff → context → redact → orchestrator → CandidateFinding[] on the sample-repo fixture.

**Done when:** Tests pass. No live AI calls. Orchestrator returns well-formed candidates.

**STOP. Summarize. Wait for "continue".**

---

# PHASE 5 — Quality pipeline (TDD — write tests FIRST)

**Objective:** Turn raw CandidateFindings into trustworthy published Findings via verification, scoring, deduplication, and policy decision. THIS PHASE IS WHERE MOST AI CODE REVIEW TOOLS FAIL. Write tests first.

**Tasks:**

1. **First, write all tests in `packages/pipeline/src/*.test.ts`** before any implementation:
   - EvidenceScorer:
     - Returns "none" when evidence array is empty
     - Returns "weak" when evidence exists but doesn't reference diff lines/file
     - Returns "medium" when evidence references diff but uses generic phrasing
     - Returns "strong" when evidence quotes diff content AND references specific construct/rule
   - VerifierAgent:
     - Rejects: missing file, missing lineStart/lineEnd, empty evidence, evidence not in diff, generic suggestedFix (matches phrases like "consider refactoring", "could be improved", "add tests"), file/line outside diff hunks
     - Approves: medium or strong evidence + specific fix + file/line in diff
     - Records `verification.status` and `verification.reason` on every finding
   - ConfidenceScorer:
     - Base 0.5
     - +0.2 strong evidence, +0.1 medium, -0.2 weak, -0.4 none
     - +0.1 verifier approved, -0.3 verifier rejected
     - +0.1 matches a clientRuleReference
     - -0.1 if falsePositiveRisk is "high"
     - Clamps to [0, 1]
     - Dimension confidence = avg of finding confidences in that dimension (or 1.0 if no findings)
     - Overall confidence = severity-weighted avg (critical=4, high=3, medium=2, low=1)
   - Deduplicator: same (file, lineStart, dimension) → keep highest confidence, others go to rejected with reason "duplicate, lower confidence"
   - QualityGate: drops findings below confidenceThreshold, below severityThreshold, or with `verification.status === "rejected"`
   - PolicyEngine:
     - `blocked_by_policy` if any (severity >= high) AND (confidence >= threshold) AND `ci.blockOnPolicy === true`
     - `needs_manual_review` if any high/critical finding present (regardless of blockOnPolicy)
     - `approved_with_warnings` if only medium findings present
     - `approved` if no findings or only low
   - End-to-end pipeline: 10+ fixture candidates → assert exact split into published/rejected with reasons.

2. **Then implement** in `packages/pipeline/src/`:
   - `evidence-scorer.ts` — `EvidenceScorer.score(finding, diff): "none" | "weak" | "medium" | "strong"`. Uses string matching against diff content for "strong" tier. Treats fuzzy matches as medium.
   - `verifier.ts` — `Verifier.verify(finding, context): Finding` — sets `verification.status` and reason. Uses heuristics; can later be backed by a model but defaults to deterministic checks. Pure function.
   - `confidence-scorer.ts` — `ConfidenceScorer.score(finding, evidenceLevel): number` and `ConfidenceScorer.rollup(findings): { dimension: Record<string, number>, overall: number }`.
   - `deduplicator.ts` — `Deduplicator.dedupe(findings): { kept: Finding[], dropped: Finding[] }`.
   - `quality-gate.ts` — `QualityGate.filter(findings, config): { passed: Finding[], failed: Finding[] }`.
   - `policy-engine.ts` — `PolicyEngine.decide(findings, config): "approved" | "approved_with_warnings" | "needs_manual_review" | "blocked_by_policy"`.
   - `pipeline.ts` — `FindingPipeline.process(candidates, context, config): PipelineResult`:
```typescript
     {
       published: Finding[],
       rejected: Array<{ finding: CandidateFinding, reason: string, stage: string }>,
       decision: PolicyDecision,
       dimensionConfidence: Record<string, number>,
       overallConfidence: number,
       metrics: {
         totalCandidates: number,
         publishedCount: number,
         rejectedByStage: Record<string, number>,
         verifierApprovalRate: number,
         evidenceDistribution: Record<"none"|"weak"|"medium"|"strong", number>
       }
     }
```
   - Pipeline order: schema validate → evidence score → verifier → confidence calibrate → dedupe → quality gate → policy decide.

**Done when:** All tests pass first try after implementation. Pipeline is fully deterministic given a fixed input. Coverage on `packages/pipeline` is at least 85%.

**STOP. Summarize. Wait for "continue".**

---

# PHASE 6 — Reports and the wired-up `review --ci`

**Objective:** End-to-end working `review --ci` command that produces all three report formats from a real diff.

**Tasks:**

1. In `packages/reports/src/`:
   - `json-report.ts` — `JsonReport.generate(result, runMetadata): string`. Pretty-printed JSON with run metadata (timestamp, baseRef, headRef, repoProfile, agents run, providers used), pipeline result, metrics.
   - `markdown-report.ts` — `MarkdownReport.generate(result, runMetadata): string`. Sections: Summary (decision, confidence, counts), Findings by Dimension (sorted by severity desc), Quality Summary (rejected counts by stage, evidence distribution), Run Metadata. Each finding shows file:lineStart-lineEnd, severity badge, confidence, evidence (collapsed), why it matters, suggested fix.
   - `html-report.ts` — `HtmlReport.generate(result, runMetadata): string`. Standalone HTML with inline CSS. Collapsible `<details>` sections per dimension. Severity color coding. No external assets, no JS frameworks — works offline. Use `<pre>` for code/diff snippets.
   - `generator.ts` — `ReportGenerator.generateAll(result, runMetadata, config): Record<string, string>` — returns map of format → content for each enabled format.
   - `ReportWriter.write(reports, outputDir, runId): void` — writes each format to `<outputDir>/run-<runId>/<format>.{json|md|html}`.

2. In `packages/cli/src/commands/review.ts`:
   - Wire `review --ci`:
     - Detect TTY: if `process.stdout.isTTY === false || [flags.ci](http://flags.ci)`, run in CI mode (no prompts ever).
     - Load config via ConfigLoader. If missing, print warning and exit 0 (do NOT fail the build).
     - Determine refs: `process.env.GITHUB_BASE_REF` and `process.env.GITHUB_SHA` if set; else `git merge-base origin/main HEAD` and `HEAD`. Allow override via `--base <ref>` and `--head <ref>` flags.
     - Read PR metadata if available (env vars like `GITHUB_PR_TITLE`, `GITHUB_PR_BODY`, or fallback to empty).
     - Run RepoProfiler.
     - Parse diff → build context → redact secrets → run AgentOrchestrator → run FindingPipeline → generate reports → write reports.
     - Print summary to stdout (chalk-colored): decision, overall confidence, counts (published / rejected), top 3 findings (file:line, severity, title).
     - Exit code: 0 always, EXCEPT when `[config.ci](http://config.ci).blockOnPolicy === true` AND `decision === "blocked_by_policy"`, exit 1.

3. In `packages/cli/src/commands/report.ts`:
   - `report --latest` — finds most recent run dir, prints markdown report to stdout.
   - `report --run <id>` — prints specified run's markdown report.
   - `report list` — lists all run IDs with timestamps and decisions.

4. **Tests:**
   - Unit: each ReportGenerator produces valid output (parse JSON, validate Markdown structure, parse HTML with cheerio or basic regex assertions).
   - Integration: full `review --ci` run against `examples/sample-repo` fixture — assert reports written to expected paths, decision matches expectation, exit code 0.
   - Integration: TTY detection — when run with mocked TTY=true and no `--ci` flag, must still NOT prompt (since we're not in init/doctor). Defensive.
   - Integration: `blockOnPolicy: false` + critical finding → exit 0. `blockOnPolicy: true` + critical high-confidence finding → exit 1.
   - Integration: missing config → warning printed, exit 0.

**Done when:** Tests pass. Running `engagement-harness review --ci` against the sample-repo produces all three report formats and a passing CI exit code.

**STOP. Summarize. Wait for "continue".**

---

# PHASE 7 — Specialist agents, eval system, feedback system

**Objective:** Add the specialist agents and the measurement loop.

**Tasks:**

1. In `packages/agents/src/`, add and register:
   - **`data-architecture.ts`** — DataArchitectureAgent. Dimension: data. Looks at schema migrations, data contracts, backward compatibility, ownership. Triggers on file paths containing `migration`, `schema`, `models/`, `db/`, `*.sql`.
   - **`sre-observability.ts`** — SREObservabilityAgent. Dimension: observability. Looks for missing logs, metrics, tracing, error handling on new code paths.
   - **`design-principles.ts`** — DesignPrinciplesAgent. Dimension: design. Looks for SOLID violations, layering issues, dependency direction problems. Stricter evidence requirements (more likely to be generic, so verifier rejects more often).
   - **`pr-intent-gap.ts`** — PRIntentGapAgent. Dimension: intent-gap. Receives PR title and body in context. Compares stated intent to actual diff. Produces findings when there's a clear gap (e.g., PR says "adds X" but diff doesn't include X).
   - **`remediation.ts`** — RemediationAgent. NOT a finding-producer. After the pipeline publishes findings, this agent generates `RemediationPlan` objects attached to high-severity findings:
```typescript
     {
       findingId: string,
       plan: string,                    // step-by-step in markdown
       suggestedPatch?: string,         // unified diff format, optional
       testRecommendations: string[],
       estimatedEffort: "trivial" | "small" | "medium" | "large"
     }
```
   - Update default config template in Phase 2's `init` to include all specialist agents enabled.

2. In `packages/eval/src/`:
   - `case-schema.ts` — `EvalCaseSchema` (zod):
```typescript
     {
       name: string,
       description: string,
       fixtureRepoPath: string,         // relative to evals dir
       baseRef: string,
       headRef: string,
       prTitle: string,
       prBody: string,
       expectedFindings: Array<{
         category: Finding["category"],
         severity?: Finding["severity"],
         fileGlob: string,               // micromatch pattern
         mustMatchPhrases: string[]      // case-insensitive substrings in title or evidence
       }>,
       expectedDecision: PolicyDecision,
       maxFalsePositives: number        // default 1
     }
```
   - `runner.ts` — `EvalRunner.runAll(casesDir, config): EvalReport`. For each case: set up tmp git repo, apply diff, run full review pipeline, score against expected. Compute precision, recall, false positives, false negatives, verifier rejection rate.
   - `EvalReport` includes per-case results and aggregate metrics. Writes JSON to `.engagement-harness/reports/eval-<timestamp>.json`.

3. In `packages/cli/src/commands/eval.ts`:
   - Wire `engagement-harness eval`. Looks for cases in `.engagement-harness/evals/cases/`. Runs all, prints aggregate metrics (chalk-colored), writes JSON report.

4. Provide 6 starter eval cases in `examples/eval-cases/`:
   - **`security-missing-auth/`** — diff adds endpoint without authorization. Expects security finding.
   - **`correctness-off-by-one/`** — diff with classic off-by-one. Expects correctness finding.
   - **`testing-no-coverage/`** — diff modifies behavior with no test changes. Expects testing finding.
   - **`clean-pr/`** — diff is well-tested, well-documented refactor. Expects 0 findings, decision: approved.
   - **`false-positive-trap/`** — code that LOOKS like SQL injection but uses parameterized queries. Expects 0 security findings.
   - **`domain-policy-violation/`** — payment code without idempotency, with a rule file present. Expects domain-policy finding.

5. In `packages/eval/src/feedback.ts`:
   - `FeedbackSchema`:
```typescript
     {
       findingId: string,
       runId: string,
       state: "accepted" | "dismissed" | "false_positive" | "fixed" | "ignored" | "overridden",
       note?: string,
       timestamp: string                // ISO 8601
     }
```
   - `FeedbackImporter.import(filePath, repoRoot)` — validates each entry, merges into `.engagement-harness/feedback/feedback-<timestamp>.json`, updates `feedback/metrics.json` rolling summary (acceptance rate, false-positive rate per dimension, per agent).

6. In `packages/cli/src/commands/feedback-import.ts` — wire it.
7. In `packages/cli/src/commands/remediate.ts` — wire `--finding <id>`. Loads the latest run's findings, finds the ID, runs RemediationAgent, prints the plan. NEVER modifies code.
8. In `packages/cli/src/commands/agents-list.ts` — prints all registered agents with id, dimension, description.

9. **Tests:**
   - Unit: each new agent against fixture bundles.
   - Integration: EvalRunner against the 6 starter cases — assert each case produces expected findings with deterministic MockProvider. Assert aggregate precision >= 0.8, recall >= 0.8 (tune MockProvider fixtures so this is reproducible).
   - Unit: FeedbackImporter — validates schema, rejects malformed, merges correctly, updates metrics.
   - Integration: remediate --finding produces a RemediationPlan, never touches the codebase.

**Done when:** Tests pass. `engagement-harness eval` runs and reports metrics on the 6 starter cases. Specialist agents are enabled by default in new configs.

**STOP. Summarize. Wait for "continue".**

---

# PHASE 8 — CI templates, real providers, ALM stubs, full documentation

**Objective:** Pilot-ready system. Anyone can install, configure, and run on a real repo.

**Tasks:**

1. CI templates in `packages/cli/src/commands/ci-templates.ts`:
   - `ci templates --platform github` writes `.github/workflows/engagement-harness.yml`:
     - Trigger: `pull_request` on opened, synchronize, reopened, ready_for_review
     - Jobs: checkout (with `fetch-depth: 0` for diff), setup-node 20, setup pnpm, install global engagement-harness CLI, run `engagement-harness review --ci`, upload `.engagement-harness/reports/` as artifact named `engagement-harness-report-${{ [github.run](http://github.run)_id }}`
     - DO NOT include any secrets or write permissions by default
   - `ci templates --platform gitlab` writes `.gitlab-ci.yml` snippet (job definition only).
   - `ci templates --platform azure-devops` writes `azure-pipelines.yml` snippet.
   - `ci templates --platform bitbucket` writes `bitbucket-pipelines.yml` snippet (basic).
   - Each template prints to stdout if `--print` flag set, else writes file (asks for confirmation before overwriting existing).

2. Real providers (still off by default — only used if config routes to them):
   - `packages/providers/src/openai.ts`:
     - Implements Provider interface. Uses native `fetch` (no SDK).
     - Reads `OPENAI_API_KEY` from env. Throws clear error if missing.
     - Calls `https://api.openai.com/v1/chat/completions` with model from config.
     - Handles errors gracefully (rate limits, network errors, malformed responses).
     - Never logs the API key or full request body.
   - `packages/providers/src/anthropic.ts`:
     - Same pattern. Reads `ANTHROPIC_API_KEY`. Calls `https://api.anthropic.com/v1/messages`.
   - These can be exercised in tests via mocked fetch — DO NOT make real network calls in tests.

3. In `packages/cli/src/commands/models-validate.ts`:
   - Walks `config.models`, ensures each provider is registered.
   - For mock: no-op success.
   - For live providers: makes a tiny test call (e.g., 1-token completion) to verify reachability. Skip with warning if API key not set in env. Never log secrets.
   - Prints colored ✓/✗ per agent → provider mapping.

4. In `packages/cli/src/commands/models-list.ts`:
   - Lists registered providers with status (available/needs-key/not-configured).
   - Lists agent → provider routing.

5. ALM adapters in `packages/core/src/alm/`:
   - `interface.ts`:
```typescript
     interface AlmAdapter {
       platform: string;
       postSummary(prRef, markdown): Promise<void>;
       postInlineComment(prRef, file, line, body): Promise<void>;
       updateCheckStatus(prRef, status, summary): Promise<void>;
     }
```
   - `github.ts` — `GitHubAlm` implementing the interface. ALL methods are NO-OPs by default. Only execute when `[config.ci](http://config.ci).postComments === true` AND the action is explicitly enabled. Uses `GITHUB_TOKEN` env var. Calls GitHub API via fetch.
   - `gitlab.ts`, `azure-devops.ts`, `bitbucket.ts`, `none.ts` — interface-only stubs. `none.ts` is the default and all methods log "ALM disabled" at debug level.
   - In `review --ci`: after report generation, if `[config.ci](http://config.ci).postComments === true`, call `alm.postSummary(prRef, markdownReport)`. Wrap in try/catch — never fail the build because of ALM errors.

6. Full documentation:
   - **`[README.md](http://README.md)`** — replace the placeholder. Sections: What is Engagement Harness, Quickstart (install, init, doctor, review), Architecture diagram (ASCII), Command reference (all 11), Configuration overview, Safety guarantees, Links to other docs.
   - **`[ARCHITECTURE.md](http://ARCHITECTURE.md)`** — Layer-by-layer walkthrough (CLI, Config, Git/Diff, Context, Redaction, Agents, Pipeline, Reports, ALM, CI). Data flow diagram (ASCII). Extensibility points (how to add an agent, provider, ALM platform).
   - **`[CONFIG.md](http://CONFIG.md)`** — Every config field documented with type, default, range/enum, example, notes.
   - **`[AGENTS.md](http://AGENTS.md)`** — Every agent: ID, dimension, description, what it checks, example finding, when to disable.
   - **`[PROVIDERS.md](http://PROVIDERS.md)`** — Provider interface, how to add a new provider, MockProvider modes, env vars for OpenAI and Anthropic.
   - **`[SAFETY.md](http://SAFETY.md)`** — Explicit list of what the system NEVER does: execute changed code, expose secrets, auto-fix code, post comments without opt-in, block merges without opt-in, call live providers without config, commit artifacts, modify access controls. Plus the secret redaction patterns and known limitations.
   - **`RELEASE_[CHECKLIST.md](http://CHECKLIST.md)`** — Pre-pilot checklist: config validates on real client repo, doctor green, eval precision >= 0.8 / recall >= 0.8, no live providers in default config, redaction tested on real diffs, CI template runs on a fork, all docs reviewed.

7. Sample repo for integration tests in `examples/sample-repo/`:
   - Small TS project with 2-3 fixture PRs as separate branches.
   - Each PR exercises different dimensions (security, correctness, testing).
   - `.engagement-harness/config.json` pre-configured.
   - At least one `.engagement-harness/rules/[payments.md](http://payments.md)` rule file with frontmatter glob.

8. Final integration test:
   - End-to-end: clone sample-repo, run `init --yes`, run `doctor`, run `review --ci` for each fixture PR, run `eval`, run `feedback import` with sample feedback. Assert each step succeeds, reports are written, expected findings appear, no secrets leak into reports.

9. Final polish:
   - `pnpm build` produces clean dist for all packages with no TS errors.
   - `pnpm test` runs full suite with coverage. Coverage targets: pipeline 85%, agents 70%, core 75%.
   - `pnpm lint` clean.
   - `engagement-harness --version` reports the version from package.json.
   - Verify: no stray `console.log`, no committed `.engagement-harness/reports/`, no test API keys in any file, no `it.skip` or `it.todo`, no `any` types in non-test code (use `unknown` if truly unknown).
   - Errors: in user-facing flows, catch at command boundaries and print clean messages with chalk. Stack traces only with `--debug` flag.
   - Run `engagement-harness ci templates --platform github --print` and verify the YAML is syntactically valid.

**Done when:**
- All tests pass with target coverage met
- All 6 docs are complete and accurate
- `engagement-harness ci templates --platform github` produces a working workflow
- A new user can: clone repo → install → init → doctor → review --ci → see reports, ALL without configuring an API key
- Sample-repo integration test passes end-to-end

**STOP. Print final summary:**
- File count and line count per package
- Test count and coverage percentage per package
- Checklist of every item from `RELEASE_[CHECKLIST.md](http://CHECKLIST.md)` with ✓/✗
- Known limitations and follow-up items for real-world pilot validation

---

## Recovery instructions

If at any point I tell you a phase is broken or needs to be redone:

- "Revert Phase N and retry" → use git to roll back to the last commit before Phase N, then re-plan that phase incorporating my new constraint.
- "Fix the failing test in <file>" → fix only that test and the minimum code to make it pass. Don't refactor unrelated code.
- "This file is too long, split it" → propose a split first, wait for confirmation.
- "Don't add <feature>" → respect the constraint; remove the feature if already added.

---

Begin Phase 1. Outline your plan first (4-8 bullets). Wait for me to say "go" before implementing.
