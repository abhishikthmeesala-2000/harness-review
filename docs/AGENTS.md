# Agents Reference

Engagement Harness runs nine specialized AI agents. Each focuses on a single review dimension, which keeps system prompts sharp and false-positive rates low. This document describes what each agent checks, when it short-circuits, and how it is tuned.

---

## Overview

| Agent ID | Dimension | Short-Circuits When |
|---|---|---|
| `reviewer` | `correctness` | Never (always runs if enabled) |
| `security` | `security` | Never (always runs if enabled) |
| `testing` | `testing` | Never (always runs if enabled) |
| `domain-policy` | `domain-policy` | No rule files match diff paths |
| `data-architecture` | `data` | Diff has no migration/schema/ORM/SQL paths |
| `sre-observability` | `observability` | Never (always runs if enabled) |
| `design-principles` | `design` | Changed lines < 20 |
| `pr-intent-gap` | `intent-gap` | No PR metadata (title/body) supplied |
| `remediation` | `remediation` | — (non-finding agent, separate invocation) |

Short-circuit means `buildPrompt()` returns `null` — no API call is made, no cost incurred, no findings emitted.

---

## `reviewer` — Correctness

**Dimension:** `correctness`

**What it checks:**
- Logic bugs and off-by-one errors
- Null/undefined dereferences
- Edge cases not handled by the diff
- Risky behavior changes that could break callers
- Incorrect conditional logic, wrong comparison operators

**System prompt style:** "15+ years of experience. Trace the logic path in the changed code before forming a conclusion. Report only defensible findings. Prefer false negatives over false positives."

**Extended thinking:** 8,000 token budget. Enables deep logic tracing on complex diffs.

**Example finding:**
```json
{
  "dimension": "correctness",
  "severity": "high",
  "title": "Off-by-one in page calculation",
  "file": "src/pagination.ts",
  "lineStart": 42,
  "evidence": "return Math.ceil(total / pageSize) - 1",
  "reasoning": "The -1 causes the last page to be excluded when total is exactly divisible by pageSize."
}
```

---

## `security` — Security

**Dimension:** `security`

**What it checks:**
- SQL injection, NoSQL injection
- XSS and output encoding gaps
- Missing or incorrect authorization checks
- Unsafe cryptography (weak algorithms, hardcoded keys, insufficient entropy)
- Hardcoded secrets and tokens
- Path traversal
- Missing input validation at trust boundaries
- Tenant isolation failures

**System prompt style:** "Senior application security engineer. Trace attack paths, not just code patterns. Know OWASP Top 10. Requires a credible attack vector — do not flag theoretical risks without a realistic exploit path."

**Extended thinking:** 10,000 token budget. Enables multi-hop attack path tracing.

**Example finding:**
```json
{
  "dimension": "security",
  "severity": "critical",
  "title": "SQL injection via unsanitized user input",
  "file": "src/api/search.ts",
  "lineStart": 88,
  "evidence": "db.query(`SELECT * FROM items WHERE name = '${req.query.name}'`)",
  "reasoning": "req.query.name is directly interpolated into the SQL string without parameterization."
}
```

---

## `testing` — Testing Coverage

**Dimension:** `testing`

**What it checks:**
- New exported functions with no corresponding test file additions
- Assertions that cannot fail (e.g., `expect(true).toBe(true)`)
- Untested error paths (`catch` blocks never covered)
- Untested negative cases (invalid inputs, boundary values)
- Tests that test implementation details instead of behavior

**System prompt style:** "Senior QA engineer. Think about what would break silently in production. Focus on real gaps, not coverage numbers."

**Example finding:**
```json
{
  "dimension": "testing",
  "severity": "medium",
  "title": "processPayment() has no test for network timeout path",
  "file": "src/payments.ts",
  "lineStart": 55,
  "evidence": "} catch (e) { logger.error(e) }",
  "reasoning": "The catch block silently swallows network errors. No test exercises this path."
}
```

---

## `domain-policy` — Client Rules

**Dimension:** `domain-policy`

**What it checks:**
- Violations of client-specific rules defined in `.engagement-harness/rules/*.md`
- Rules can cover: API naming conventions, banned patterns, required error handling patterns, data access restrictions, architectural boundaries

**Short-circuits:** When no rule files match the diff paths. No API call is made.

**How it works:** Rule file content is injected directly into the agent's system prompt. The agent applies each rule literally — it does not infer intent beyond the written rule.

**Example rule file** (`.engagement-harness/rules/api-conventions.md`):
```markdown
# API Conventions

- All REST endpoints must return responses in the shape `{ data: T, error: null }` or `{ data: null, error: string }`.
- Never return raw Error objects or stack traces in API responses.
- All endpoints under /api/v1/admin/ must check req.user.role === 'admin' before processing.
```

**Example finding:**
```json
{
  "dimension": "domain-policy",
  "severity": "high",
  "title": "Admin endpoint missing role check",
  "file": "src/api/admin/users.ts",
  "lineStart": 12,
  "evidence": "router.get('/api/v1/admin/users', async (req, res) => {",
  "reasoning": "Rule 'api-conventions.md' requires admin role check. No req.user.role check found."
}
```

See [docs/CUSTOM_PROMPTS.md](CUSTOM_PROMPTS.md) for how to write effective rule files.

---

## `data-architecture` — Database and Schema

**Dimension:** `data`

**What it checks:**
- Risky migrations: adding NOT NULL columns without a DEFAULT, dropping columns, renaming columns without a rename plan
- Missing indices on foreign key columns
- Unsafe ORM raw queries bypassing parameter binding
- Schema changes without corresponding data migrations
- N+1 query patterns introduced by ORM misuse

**Short-circuits:** When no changed files match the path pattern:
```
/migration|schema|models?\/|db\/|database|prisma|drizzle|knex|sequelize|typeorm|\.sql$/i
```

**System prompt style:** "Senior database engineer with PostgreSQL and MySQL migration expertise. Lived through schema disasters. Knows that adding NOT NULL without DEFAULT locks the table."

**Example finding:**
```json
{
  "dimension": "data",
  "severity": "critical",
  "title": "NOT NULL column added without DEFAULT will fail on existing rows",
  "file": "migrations/20260101_add_user_tier.sql",
  "lineStart": 4,
  "evidence": "ALTER TABLE users ADD COLUMN tier VARCHAR(20) NOT NULL;",
  "reasoning": "Existing rows have no value for 'tier'. Migration will fail unless DEFAULT is added or a data migration runs first."
}
```

---

## `sre-observability` — Observability and Reliability

**Dimension:** `observability`

**What it checks:**
- Error swallowing without logging (`catch (e) {}` or `catch (e) { return null }`)
- Missing structured log entries at important decision points
- Unhandled promise rejections
- Operations that affect SLOs with no observable signal (no metric increment, no log)
- Missing health check coverage for new service dependencies

**System prompt style:** "Experienced SRE who has been on-call and lived through outages caused by silent failures. Flags concrete blindspots, not hypothetical ones."

**Example finding:**
```json
{
  "dimension": "observability",
  "severity": "medium",
  "title": "Cache miss handled silently with no log or metric",
  "file": "src/cache.ts",
  "lineStart": 34,
  "evidence": "} catch (e) { return await fetchFromDB(key); }",
  "reasoning": "Cache errors silently fall through to DB. No log or metric records cache miss rate, making it impossible to detect cache degradation in production."
}
```

---

## `design-principles` — Design and Architecture

**Dimension:** `design`

**What it checks:**
- Single Responsibility Principle violations (class/function doing too many things)
- DRY violations (identical logic duplicated in three or more places)
- Abstraction leaks (implementation details exposed in public interfaces)
- High coupling between modules that should be independent
- Misleading names (function named `getUser` that also modifies state)

**Short-circuits:** When the diff has fewer than 20 changed lines. Trivial patches don't warrant design review.

**System prompt style:** "Staff-level software architect. Distinguishes real maintenance problems from theoretical purity. Does not flag design issues in test code."

**Example finding:**
```json
{
  "dimension": "design",
  "severity": "low",
  "title": "UserService handles authentication, authorization, and profile updates",
  "file": "src/services/UserService.ts",
  "lineStart": 1,
  "evidence": "class UserService { login() { ... } checkPermission() { ... } updateProfile() { ... } }",
  "reasoning": "Three distinct responsibilities. Authentication changes will risk regression in profile update logic."
}
```

---

## `pr-intent-gap` — Intent vs. Changes

**Dimension:** `intent-gap`

**What it checks:**
- Unannounced changes: code modified that isn't mentioned in the PR title or body
- Scope creep: refactors, dependency bumps, or config changes bundled with a feature PR
- Incomplete implementation: title promises X, diff implements X partially
- TODO comments added but not tracked
- Feature flags added but not connected

**Short-circuits:** When no PR metadata (title/body) is provided to the context engine.

**System prompt style:** "Senior engineering manager who reads PRs carefully. Protects the team from hidden changes and scope creep."

**Example finding:**
```json
{
  "dimension": "intent-gap",
  "severity": "medium",
  "title": "PR modifies auth middleware not mentioned in description",
  "file": "src/middleware/auth.ts",
  "lineStart": 8,
  "evidence": "PR title: 'Add user profile picture upload'",
  "reasoning": "The diff touches auth middleware but the PR description mentions only profile picture upload. The auth change is unannounced."
}
```

---

## `remediation` — Fix Generation

**Dimension:** `remediation`

**What it does:** Generates structured BEFORE/AFTER code patches for an existing finding. Not a finding agent — it does not identify issues, it fixes them.

**Invocation:** Via CLI, not part of the finding pipeline:
```bash
engagement-harness remediate --finding EH-0001
```

**Output:** A structured patch with:
- The exact BEFORE code block
- The corrected AFTER code block
- Estimated effort (trivial/low/medium/high)
- Test recommendations
- Tech-stack-aware advice (detected from the repository: language, framework, ORM, test runner)

**`detectTechStack()` detection:** The remediation agent detects: language, framework, testRunner, database, ORM, packageManager, importStyle from the repository context and adapts its patches accordingly.

**Example output:**
```json
{
  "findingId": "EH-0001",
  "before": "db.query(`SELECT * FROM items WHERE name = '${name}'`)",
  "after": "db.query('SELECT * FROM items WHERE name = $1', [name])",
  "effort": "trivial",
  "testRecommendation": "Add a test that passes a name containing a SQL injection payload and verifies the query is parameterized.",
  "notes": "Using PostgreSQL parameterized query syntax ($1). Adjust to ? placeholder for MySQL."
}
```

---

## Conservative Reporting

All agents embed a `CONSERVATIVE_FINDING_BLOCK` in their system prompts. Key rules:

- **Do not report** findings based on code not present in the diff
- **Do not report** issues that are already handled elsewhere in the diff
- **Do not flag** missing tests for code that is clearly not exported or public-facing
- **Prefer false negatives** — if unsure, stay silent
- **One finding per issue** — do not re-report the same root cause in multiple findings
