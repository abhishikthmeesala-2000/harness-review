# Custom Prompts and Client Rules

This document describes two ways to customize Engagement Harness for a specific client: adding client-specific rules enforced by the `domain-policy` agent, and understanding how the base agent prompts work.

---

## Approach 1: Client Rule Files (Recommended)

The simplest customization is to drop Markdown rule files into `.engagement-harness/rules/`. The `domain-policy` agent loads all rule files whose glob patterns match changed paths in the diff and enforces them.

### How It Works

1. Create `.engagement-harness/rules/<rulename>.md` in the client repository
2. Add optional frontmatter specifying which files the rule applies to
3. Write the rule body in plain Markdown — the agent reads the full content as instructions
4. The `domain-policy` agent loads rule files, groups them by matched paths, and sends them to the provider with the diff

If no rule files match any changed path, the `domain-policy` agent skips the provider call entirely (no cost).

### Rule File Format

```markdown
---
glob: "src/payments/**"
---

# Payment Processing Rules

All payment mutations must emit an audit event via `auditLogger.record()` within the
same transaction. Do not flag read-only queries.

Example compliant pattern:
```
await db.transaction(async (trx) => {
  await trx('payments').insert(payment);
  await auditLogger.record({ type: 'PAYMENT_CREATED', paymentId: payment.id }, trx);
});
```
```

### Frontmatter Fields

| Field | Description |
|---|---|
| `glob` | A single micromatch glob pattern. The rule is only injected when a changed file matches. |
| `globs` | An array of micromatch patterns. The rule is injected if any changed file matches any pattern. |

If neither `glob` nor `globs` is specified, the rule applies to all changed files.

### Multiple Rules

You can have as many rule files as needed. Each becomes a separate block in the `domain-policy` agent's prompt:

```
.engagement-harness/rules/
├── payments.md          # globs: ["src/payments/**", "src/billing/**"]
├── api-contracts.md     # globs: ["src/api/**", "src/routes/**"]
├── logging-standards.md # (no glob — applies everywhere)
└── database.md          # globs: ["src/db/**", "migrations/**"]
```

### Example: Full Rule File

```markdown
---
globs:
  - "src/api/**"
  - "src/routes/**"
---

# API Contract Rules

## Breaking Change Policy

All routes must be versioned (`/v1/`, `/v2/`, etc.) before breaking changes.
Adding required fields to request bodies is a breaking change.
Removing or renaming response fields is a breaking change.

Flag any change that:
- Adds a required field to an existing endpoint's request body
- Removes or renames a field from an existing endpoint's response
- Changes an existing route path without adding a versioned alias

Do NOT flag:
- Adding optional fields to request bodies
- Adding new fields to responses
- Adding entirely new routes

## Error Response Format

All error responses must use the standard envelope:
```
{
  "error": {
    "code": "SNAKE_CASE_CODE",
    "message": "Human-readable description",
    "requestId": "<uuid>"
  }
}
```

Flag any new error response that does not include all three fields.
```

---

## Approach 2: Understanding the Built-in Agent Prompts

If rule files are not expressive enough, you can read the agent prompt templates directly in `packages/agents/src/<agent-id>.ts`. Each agent's `promptTemplate(context: ContextBundle): string` method builds the full prompt string.

The prompts follow a consistent structure:

```
You are the <AgentName> agent for the Engagement Harness.
Dimension: <dimension>

ROLE
<conservative instructions — only flag high-confidence issues>

WHAT TO CHECK
<numbered list of patterns with mitigating factors and examples>

OUTPUT FORMAT
<JSON schema block>

CONTEXT
<rendered diff, file content, test files, rule files>
```

### Prompt Rendering Utilities

The agent prompts use three utilities from `packages/agents/src/prompt-utils.ts`:

| Function | What it renders |
|---|---|
| `renderDiffSummary(context)` | The git diff for all changed files in the ContextBundle |
| `renderFileContext(context)` | Full content of changed files, imported files, and test files |
| `renderFunctionContext(context)` | Function/class signatures extracted from context entries |
| `FINDING_SCHEMA_BLOCK` | The JSON output schema all agents include at the end of their prompt |

### Modifying Agent Prompts Directly

You can modify prompt templates in `packages/agents/src/*.ts` and rebuild to change agent behavior for a specific deployment. This is appropriate when:

- You want to add company-specific context that applies across all PRs (e.g., framework idioms)
- You want to suppress a specific pattern the base agent checks
- You want to add a new check type beyond what rule files can express

After modifying a prompt, rebuild the package:

```bash
pnpm build
```

Then run `engagement-harness eval` to verify the change does not degrade existing eval cases.

---

## Testing Your Rules

The `domain-policy` agent's behavior can be tested with a fixture-based eval case. Create a case under `packages/eval/src/cases/` with a `diff.patch` that violates your rule:

```json
{
  "name": "payment-missing-audit-log",
  "description": "Payment mutation without auditLogger.record() call",
  "fixtureRepoPath": ".",
  "baseRef": "HEAD~1",
  "headRef": "HEAD",
  "prTitle": "Add refund endpoint",
  "expectedFindings": [
    {
      "category": "domain-policy",
      "severity": "high",
      "fileGlob": "src/payments/**",
      "mustMatchPhrases": ["audit"]
    }
  ],
  "expectedDecision": "needs_manual_review"
}
```

Run the eval suite:

```bash
engagement-harness eval
```

A passing case confirms the `domain-policy` agent correctly catches the violation. An unexpected false-positive case (no matching finding when one was expected) indicates the rule wording needs refinement.
