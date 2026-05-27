# Agents Reference

Engagement Harness runs nine specialized agents. Each is focused on a single review dimension, which keeps findings precise and false-positive rates low.

---

## How Agents Work

All agents inherit from `BaseAgent` in `packages/agents/src/base.ts`. The base class:

1. Calls `promptTemplate(context: ContextBundle)` to build the provider prompt
2. Sends the prompt to the assigned provider (`MockProvider`, `AnthropicProvider`, or `OpenAIProvider`)
3. Extracts a JSON array from the response (tolerates prose surrounding the array)
4. Validates each item against `CandidateFindingSchema`
5. Tags every accepted candidate with `sourceAgent` and `modelProvider`

An agent returning an empty string from `promptTemplate()` signals it has no work (e.g., `domain-policy` with no matching rule files). The base class short-circuits without calling the provider.

---

## Agent Catalog

### `reviewer`

**Dimension:** `correctness`

**What it checks:**
- Logic bugs — off-by-one errors, wrong operators, inverted conditions
- Null/undefined dereference without guard
- Risky behavior changes — changed return values, dropped error handling, modified semantics of shared utilities

**False positive handling:** Checks full context before flagging — apparent boundary errors may be intentional exclusive ranges; apparent null risks may be protected by TypeScript types or caller guarantees.

**Example finding:**
```json
{
  "id": "EH-0001",
  "title": "Off-by-one: loop accesses arr[arr.length]",
  "dimension": "correctness",
  "severity": "high",
  "confidence": 0.92,
  "file": "src/processor.ts",
  "lineStart": 44,
  "lineEnd": 44,
  "whyItMatters": "Accessing arr[arr.length] returns undefined, causing a TypeError on the next property access.",
  "suggestedFix": "Change `i <= arr.length` to `i < arr.length`.",
  "falsePositiveRisk": "low"
}
```

**When to disable:** Rare. Only if the diff is exclusively configuration or documentation changes with no logic.

---

### `security`

**Dimension:** `security`

**What it checks:**
- SQL injection — user input concatenated directly into SQL strings
- Cross-site scripting (XSS) — unsanitized input rendered as HTML
- Missing authorization checks on sensitive routes
- Unsafe cryptography — weak algorithms, predictable IVs, hardcoded secrets
- Secret exposure — credentials in source code or logs
- Tenant isolation violations — cross-tenant data access

**False positive handling:** Checks for mitigating factors before flagging: `parseInt()` with `isNaN()` guard, ORM parameterized queries, strict input whitelists.

**Example finding:**
```json
{
  "id": "EH-0002",
  "title": "SQL injection via unsanitized req.body.userId",
  "dimension": "security",
  "severity": "critical",
  "confidence": 0.95,
  "file": "src/api/users.ts",
  "lineStart": 23,
  "lineEnd": 23,
  "whyItMatters": "An attacker can pass SQL syntax in userId to dump or modify any table in the database.",
  "suggestedFix": "Use a parameterized query: `db.query('SELECT * FROM users WHERE id = ?', [userId])`",
  "falsePositiveRisk": "low"
}
```

**When to disable:** Never recommended for production-facing code.

---

### `testing`

**Dimension:** `testing`

**What it checks:**
- New exported functions or classes with no corresponding test file
- Changed logic paths without updated assertions
- Missing negative-path tests (no error cases, no null input coverage)
- Weak assertions — `expect(result).toBeTruthy()` instead of precise value checks

**False positive handling:** Skips trivial getters/setters, type-only files, and functions with existing integration/E2E test coverage.

**Example finding:**
```json
{
  "id": "EH-0003",
  "title": "New exported function `calculateDiscount` has no test",
  "dimension": "testing",
  "severity": "medium",
  "confidence": 0.84,
  "file": "src/pricing.ts",
  "lineStart": 12,
  "lineEnd": 28,
  "whyItMatters": "Discount logic handles currency and rounding — edge cases (0%, 100%, fractional cents) are untested.",
  "suggestedFix": "Add unit tests covering zero discount, full discount, and rounding to nearest cent.",
  "falsePositiveRisk": "low"
}
```

**When to disable:** PRs that are purely documentation or config changes.

---

### `domain-policy`

**Dimension:** `domain-policy`

**What it checks:** Violations of client-specific rules loaded from `.engagement-harness/rules/*.md`. Each rule file can target specific paths via frontmatter `glob` or `globs` fields.

**False positive handling:** This agent is strict — rules are team requirements. If a file doesn't match a rule's glob, the rule is not applied.

**How to skip:** Returns an empty prompt (and therefore makes no provider call) when no rule files match any changed paths in the diff.

**Example rule file (`.engagement-harness/rules/payments.md`):**
```markdown
---
globs:
  - "src/payments/**"
  - "src/billing/**"
---

# Payment Processing Rules

All payment mutations must emit an audit event via `auditLogger.record()` within the same transaction.
```

**Example finding:**
```json
{
  "id": "EH-0004",
  "title": "Payment mutation missing auditLogger.record() call",
  "dimension": "domain-policy",
  "severity": "high",
  "confidence": 0.91,
  "file": "src/payments/refund.ts",
  "lineStart": 55,
  "lineEnd": 71,
  "whyItMatters": "Audit trail is required for SOC 2 compliance. Missing records will fail the next audit.",
  "suggestedFix": "Call `auditLogger.record({ type: 'REFUND', ...meta })` inside the transaction block.",
  "falsePositiveRisk": "low"
}
```

**When to disable:** Repositories with no `.engagement-harness/rules/` files (agent auto-skips anyway).

---

### `data-architecture`

**Dimension:** `data`

**What it checks:**
- Non-nullable columns added without a `DEFAULT` value (fails on existing rows)
- Destructive schema changes without a migration rollback plan
- Missing indices on foreign keys or frequently-queried columns
- ORM misuse — `findAll()` without `LIMIT`, N+1 query patterns

**Auto-skip condition:** Skips entirely if no paths matching `/migration|schema|models\/|db\/|\.sql$/i` appear in the diff.

**Example finding:**
```json
{
  "id": "EH-0005",
  "title": "NOT NULL column added without DEFAULT — will fail on existing rows",
  "dimension": "data",
  "severity": "critical",
  "confidence": 0.93,
  "file": "migrations/0023_add_user_tier.sql",
  "lineStart": 8,
  "lineEnd": 8,
  "whyItMatters": "ALTER TABLE ADD COLUMN NOT NULL with no DEFAULT will fail immediately on any table with existing rows.",
  "suggestedFix": "Add `DEFAULT 'free'` to the column definition, or run a backfill migration before adding the NOT NULL constraint.",
  "falsePositiveRisk": "low"
}
```

**When to disable:** PRs with no database or ORM changes (auto-skips anyway).

---

### `sre-observability`

**Dimension:** `observability`

**What it checks:**
- Silent error swallowing — empty catch blocks or catch blocks that don't log
- New external I/O (HTTP calls, DB queries, queue publishes) without error handling
- Missing structured log entries on critical paths
- SLO-impacting changes — timeout removals, retry removals, circuit breaker bypasses

**False positive handling:** Checks whether errors are rethrown and logged at a higher level before flagging; checks for intentional fire-and-forget patterns with comments.

**Example finding:**
```json
{
  "id": "EH-0006",
  "title": "Silent error swallow in payment webhook handler",
  "dimension": "observability",
  "severity": "high",
  "confidence": 0.88,
  "file": "src/webhooks/stripe.ts",
  "lineStart": 34,
  "lineEnd": 36,
  "whyItMatters": "Webhook failures will be invisible in logs. Payment state will silently diverge from Stripe.",
  "suggestedFix": "Add `logger.error({ err, webhookId }, 'stripe webhook processing failed')` in the catch block.",
  "falsePositiveRisk": "low"
}
```

---

### `design-principles`

**Dimension:** `design`

**What it checks:**
- Single Responsibility Principle violations — class/function handling 2+ unrelated concerns
- High coupling — `new ConcreteService()` inside testable classes that need DI
- Open/Closed Principle violations — switch statements on type enums instead of polymorphism
- Naming clarity — misleading names, abbreviations that reduce readability

**False positive handling:** Only flags violations with a specific code line from the diff; avoids style preferences and minor naming quibbles.

**Example finding:**
```json
{
  "id": "EH-0007",
  "title": "UserService handles both HTTP parsing and database persistence (SRP violation)",
  "dimension": "design",
  "severity": "medium",
  "confidence": 0.81,
  "file": "src/services/user-service.ts",
  "lineStart": 1,
  "lineEnd": 120,
  "whyItMatters": "Combining request parsing with persistence makes this class untestable without an HTTP context.",
  "suggestedFix": "Extract HTTP parsing into a controller layer; let UserService focus on domain logic only.",
  "falsePositiveRisk": "medium"
}
```

---

### `pr-intent-gap`

**Dimension:** `intent-gap`

**What it checks:**
- Changes don't match the stated PR intent (title says "fix X" but diff modifies unrelated component Y)
- Undescribed risky changes — significant behavioral modifications absent from the PR description
- Scope creep — changes far outside the stated purpose with no explanation

**Auto-skip condition:** Skips entirely if there is no PR metadata (`prMetadata.title` and `prMetadata.body` are both absent).

**Example finding:**
```json
{
  "id": "EH-0008",
  "title": "PR titled 'fix button styling' but modifies authentication middleware",
  "dimension": "intent-gap",
  "severity": "high",
  "confidence": 0.87,
  "file": "src/middleware/auth.ts",
  "lineStart": 1,
  "lineEnd": 45,
  "whyItMatters": "Unannounced authentication changes are a common source of security regressions in code review.",
  "suggestedFix": "Update the PR description to explain why the auth middleware was changed, or separate into a dedicated PR.",
  "falsePositiveRisk": "low"
}
```

---

### `remediation`

**Dimension:** `remediation`

**What it checks:** This agent does not produce findings during the standard review run. Instead it generates structured remediation plans for specific findings on demand via `engagement-harness remediate --finding <id>`.

Each plan includes:
- Step-by-step instructions in Markdown
- An optional unified diff patch showing the suggested code change
- Test recommendations to verify the fix
- `estimatedEffort`: `trivial` | `small` | `medium` | `large`

**Usage:**
```bash
engagement-harness remediate --finding EH-0001
```

---

## Controlling Which Agents Run

The `agents.enabled` array in `config.json` controls which agents run:

```json
{
  "agents": {
    "enabled": ["security", "reviewer", "testing"]
  }
}
```

Run `engagement-harness agents list` to see all registered agents and their descriptions.
