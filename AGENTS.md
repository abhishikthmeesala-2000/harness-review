# Agents Reference

The orchestrator runs agents concurrently using `Promise.allSettled`. Each agent receives the redacted `ContextBundle` and its configured provider, builds a prompt, calls the provider, and returns zero or more `CandidateFinding` objects. Agents short-circuit (return `[]`) when their prompt template determines there is no relevant work in the current diff.

All nine agent IDs are enabled by default via `defaultConfig()`. Individual agents can be removed from `config.agents.enabled` to skip them entirely.

---

## reviewer

| Property | Value |
|---|---|
| ID | `reviewer` |
| Dimension | `correctness` |
| Finding category | `correctness` |

**Description:** Looks for logic bugs, off-by-one errors, edge cases, null handling, and risky behavior changes.

**What it checks:**
- Off-by-one errors in loop boundaries and array indexing
- Null or undefined dereferences and missing guard clauses
- Risky behavior changes where existing callers may break

**Example finding title:** "Off-by-one in loop boundary"

**When to disable:** Disable if a dedicated static analysis tool (e.g., TypeScript strict mode plus ESLint) already covers correctness and you want to reduce agent cost. Do not disable on PRs that touch business-critical calculation logic.

---

## security

| Property | Value |
|---|---|
| ID | `security` |
| Dimension | `security` |
| Finding category | `security` |

**Description:** Looks for missing authorization, injection risks, unsafe crypto, secret exposure, tenant isolation, and input validation gaps.

**What it checks:**
- Missing authorization or authentication guards on endpoints
- SQL/command injection risks and unsafe use of user-controlled input
- Hardcoded secrets, unsafe cryptographic primitives, and tenant data leaks

**Example finding title:** "Missing authorization check on admin endpoint"

**When to disable:** Never disable on PRs that touch authentication, authorization, or data access layers. Safe to disable only on pure documentation or configuration PRs with no code changes.

---

## domain-policy

| Property | Value |
|---|---|
| ID | `domain-policy` |
| Dimension | `domain-policy` |
| Finding category | `domain-policy` |

**Description:** Flags violations of client-specific rules drawn from `.engagement-harness/rules/*.md`. If no rule files match the diff, the agent returns an empty prompt and does not call the provider.

**What it checks:**
- Concrete violations of rules declared in the engagement rule files
- Each finding includes the rule file path in `clientRuleReferences`
- Only fires when rule context is present; silent otherwise

**Example finding title:** "Payment handler missing idempotency key"

**When to disable:** Disable if no rules have been authored for the engagement yet (`.engagement-harness/rules/` is empty). It will silently return no findings in that case anyway, so disabling is purely a performance optimization.

---

## testing

| Property | Value |
|---|---|
| ID | `testing` |
| Dimension | `testing` |
| Finding category | `testing` |

**Description:** Looks for missing tests, weak assertions, untested edge cases, and untested negative paths.

**What it checks:**
- New public functions or behaviors added without accompanying test coverage
- Test assertions that are too permissive to catch real regressions
- Missing negative-path and boundary-condition test cases

**Example finding title:** "New behavior added without test coverage"

**When to disable:** Disable if the repo has a separate test-coverage enforcement step (e.g., a coverage threshold check) that you trust to surface gaps, and you want to reduce duplicate findings.

---

## data-architecture

| Property | Value |
|---|---|
| ID | `data-architecture` |
| Dimension | `data` |
| Finding category | `data` |

**Description:** Flags risky migrations, schema changes, missing indices, and ORM misuse. Only fires when the diff contains paths matching `migration`, `schema`, `models/`, `db/`, or `.sql` (case-insensitive).

**What it checks:**
- Non-nullable columns added without a default value (blocks existing rows on migration)
- Schema migrations with no rollback path
- Missing indices on foreign-key columns and unsafe ORM patterns

**Example finding title:** "Schema migration missing rollback"

**When to disable:** Disable on repos with no database layer or where schema changes are managed exclusively by a dedicated migration review process outside this tool.

---

## sre-observability

| Property | Value |
|---|---|
| ID | `sre-observability` |
| Dimension | `observability` |
| Finding category | `observability` |

**Description:** Looks for missing structured logs, absent metrics, silent error swallowing, and SLO-impacting changes.

**What it checks:**
- Catch blocks that swallow errors without a structured log entry
- New code paths that emit no metrics or tracing instrumentation
- Uncaught promise rejections and SLO-impacting changes to latency-critical paths

**Example finding title:** "Error swallowed without structured log"

**When to disable:** Disable on frontend or CLI projects where server-side observability conventions do not apply.

---

## design-principles

| Property | Value |
|---|---|
| ID | `design-principles` |
| Dimension | `design` |
| Finding category | `design` |

**Description:** Checks SOLID/DRY violations, abstraction leaks, excessive coupling, and naming clarity. Evidence must cite a specific diff line; style-only observations are explicitly excluded.

**What it checks:**
- Single responsibility violations (large functions handling unrelated concerns)
- Excessive coupling between modules and abstraction leaks across layer boundaries
- Naming that obscures intent, premature abstraction, and DRY violations with concrete diff evidence

**Example finding title:** "God function violates single responsibility"

**When to disable:** Disable on PRs that are pure bug-fixes with no structural changes, or in projects that have an established architectural review process that already covers these concerns.

---

## pr-intent-gap

| Property | Value |
|---|---|
| ID | `pr-intent-gap` |
| Dimension | `intent-gap` |
| Finding category | `intent-gap` |

**Description:** Identifies gaps between the stated PR intent (title and body) and actual changes. Only fires when `context.prMetadata` contains a non-empty title or body; returns an empty prompt otherwise.

**What it checks:**
- Code changes that contradict the PR description (e.g., writes introduced in a "read-only refactor")
- Side effects or scope creep not mentioned in the PR description
- Genuine mismatches only; missing detail in the description is not flagged

**Example finding title:** "PR claims 'read-only refactor' but writes to DB"

**When to disable:** Disable when running against branches where no PR metadata is available (e.g., direct pushes to a feature branch with no associated PR). It will be silent in that case anyway.

---

## remediation

| Property | Value |
|---|---|
| ID | `remediation` |
| Dimension | `remediation` |
| Finding category | N/A — non-finding agent |

**Description:** Generates structured remediation plans for existing findings. This agent does not produce `CandidateFinding` objects and is skipped by the orchestrator's main `run()` loop. It is invoked only through the `engagement-harness remediate --finding <id>` command, which calls `RemediationAgent.remediate()` directly.

**Output schema:**
```
{
  findingId: string,
  plan: string,               // step-by-step Markdown instructions
  suggestedPatch?: string,    // optional unified diff patch
  testRecommendations: string[],
  estimatedEffort: "trivial" | "small" | "medium" | "large"
}
```

**When to disable:** Removing `remediation` from `config.agents.enabled` has no effect on review runs (it is already skipped by the orchestrator). Removing it only suppresses the agent from the `agents list` output.
