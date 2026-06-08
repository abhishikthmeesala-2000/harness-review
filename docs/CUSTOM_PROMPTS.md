# Custom Prompts and Client Rules

This document describes how to add client-specific rules enforced by the `domain-policy` agent and how to understand the base agent system prompts.

---

## Domain Rules (Client-Specific)

The `domain-policy` agent enforces rules specific to the client's engineering standards. Rules are written as Markdown files and placed in `.engagement-harness/rules/`. The agent applies each rule literally — it does not infer intent beyond the written rule.

### Rule File Location

```
your-repo/
└── .engagement-harness/
    └── rules/
        ├── api-conventions.md
        ├── security-requirements.md
        ├── data-access-patterns.md
        └── naming-standards.md
```

Any `.md` file in this directory is loaded and injected into the `domain-policy` agent's system prompt when it runs. You can have as many rule files as needed.

### When the Agent Short-Circuits

If no rule files exist in `.engagement-harness/rules/`, the `domain-policy` agent returns `null` from `buildPrompt()` and **no API call is made**. This means:
- Zero cost for clients with no custom rules
- No spurious findings from an agent with no instructions

### Writing Effective Rules

**Be prescriptive, not descriptive.** Write rules as requirements, not observations.

```markdown
# Bad (describes what you observe)
Functions that call the database are usually in the repository layer.

# Good (prescribes what must be true)
All database calls MUST be in files under src/repositories/. Direct database access
from controllers, services, or route handlers is not allowed.
```

**Include examples when the rule is ambiguous.**

```markdown
# Required response envelope
All API endpoints MUST return responses in one of these two shapes:
- Success: `{ "data": <payload>, "error": null }`
- Failure: `{ "data": null, "error": "<message string>" }`

Never return a raw error object, a stack trace, or a bare array as the top-level response.
```

**Scope rules to paths when applicable.**

```markdown
# Admin authorization
Every route handler in src/api/admin/ MUST include the following authorization check
before any database access:

  if (req.user?.role !== 'admin') {
    return res.status(403).json({ data: null, error: 'Forbidden' });
  }
```

### Rule File Examples

#### `api-conventions.md`

```markdown
# API Conventions

- All REST endpoints MUST return responses in the shape `{ data: T, error: null }`
  or `{ data: null, error: string }`.
- Never return raw Error objects, stack traces, or undefined as the top-level response.
- All endpoints under /api/v1/admin/ MUST check req.user.role === 'admin' before processing.
- HTTP 500 responses MUST NOT include error.stack or error.message from internal errors.
- Pagination MUST use cursor-based pagination (no offset). The response shape is:
  `{ data: T[], cursor: string | null, hasMore: boolean }`.
```

#### `security-requirements.md`

```markdown
# Security Requirements

- All user-supplied input used in database queries MUST use parameterized queries.
  Direct string interpolation in SQL is never acceptable.
- Passwords and secrets MUST NOT be logged, even at debug level.
- File upload endpoints MUST validate MIME type from file content (not filename extension)
  and limit file size to 10MB.
- JWT tokens MUST be validated with the shared validation middleware in
  src/middleware/validateToken.ts. Do not inline JWT validation logic.
```

#### `data-access-patterns.md`

```markdown
# Data Access Patterns

- The Prisma client MUST only be instantiated in src/db/client.ts. Do not create new
  PrismaClient instances in other files.
- Raw SQL queries using prisma.$queryRaw MUST use Prisma.sql template literals for
  parameter binding. String interpolation with $queryRawUnsafe is not allowed.
- Transactions MUST be used when two or more related records are created or updated
  together. Do not perform multi-table writes outside a transaction.
```

#### `naming-standards.md`

```markdown
# Naming Standards

- React component files MUST use PascalCase (UserProfile.tsx, not user-profile.tsx).
- Database migration files MUST follow the pattern: YYYYMMDD_description_snake_case.sql.
- Environment variable names MUST be SCREAMING_SNAKE_CASE and documented in .env.example.
- Test files MUST be co-located with the source file they test and named <source>.test.ts.
- Do not use abbreviations in function or variable names except for well-known ones
  (id, url, api, db).
```

---

## Understanding Base Agent Prompts

Each agent has a specialist system prompt in `packages/agents/src/<agent-name>.ts`. You cannot edit these prompts through configuration — they are part of the codebase. To customize them, fork the repository and modify the source.

Key elements in every agent prompt:

### Specialist Persona

Each agent opens with a persona statement that establishes expertise:

```
You are a senior application security engineer with 15 years of experience...
You are a staff-level software architect who cares deeply about maintainability...
```

### Conservative Finding Block

Every agent includes a block of rules that reduce false positives:

- Report only findings with direct evidence in the diff
- Do not flag issues that are already handled in the diff
- Prefer false negatives over false positives
- One finding per root cause — do not duplicate
- Do not speculate about code not shown

### Output Format Constraint

All agents are instructed to return a JSON array of findings in a specific schema. The `BaseAgent.extractJsonArray()` method handles markdown fences and surrounding prose.

---

## Adjusting Thresholds Without Editing Prompts

If an agent produces too many false positives, use configuration adjustments before modifying prompts:

**Lower confidence requirements:**
```json
{
  "review": {
    "confidenceThreshold": 0.9
  }
}
```

**Disable a noisy agent entirely:**
```json
{
  "agents": {
    "enabled": [
      "reviewer", "security", "testing", "data-architecture",
      "sre-observability", "pr-intent-gap", "remediation"
    ]
  }
}
```

**Add domain rules that explicitly exclude patterns:**
```markdown
# False Positive Suppressions

- Do NOT flag the pattern `throw new AppError(...)` as missing error handling.
  AppError is our base error class and is always caught at the middleware layer.
- Do NOT flag console.log calls in files under src/scripts/.
  Scripts are not server-side code and do not require structured logging.
```

The `domain-policy` agent will report violations of these rules, and because it runs after the other agents, its output can serve as a suppression layer when written carefully.
