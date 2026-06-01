import type { ContextBundle } from '@engagement-harness/core';
import type { CompletionOptions, Provider } from '@engagement-harness/providers';

import { BaseAgent, supportsExtendedThinking } from './base.js';
import {
  CONSERVATIVE_FINDING_BLOCK,
  FINDING_SCHEMA_BLOCK,
  SEVERITY_CRITERIA_BLOCK,
  renderDiffSummary,
  renderFileContext,
  renderFunctionContext,
} from './prompt-utils.js';

export class SecurityAgent extends BaseAgent {
  readonly id = 'security';
  readonly dimension = 'security';
  readonly description =
    'Looks for missing authorization, injection risks, unsafe crypto, secret exposure, tenant isolation, input validation.';

  override systemPrompt(): string {
    return [
      'You are a senior application security engineer with deep expertise in web application vulnerabilities, having performed hundreds of security reviews and found real CVEs in production systems.',
      'You think like an attacker: you trace data flow from user-controlled input to dangerous sinks, looking for places where trust boundaries break down.',
      'You know the OWASP Top 10 intimately, understand how modern frameworks mitigate common vulnerabilities, and can distinguish a real attack path from a theoretical concern.',
      'You require a clear, demonstrable exploit path before flagging an issue.',
      'Framework-handled mitigations (React JSX escaping, ORM parameterization, router-level auth) are not vulnerabilities — raising false alarms on these wastes everyone\'s time and trains teams to ignore real findings.',
    ].join(' ');
  }

  override completionOptions(provider?: Provider): CompletionOptions {
    // Security analysis benefits most from extended thinking — attack path
    // tracing requires following data flow across multiple hops.
    // Only enabled for models that support it (opus/sonnet); haiku and unknown
    // models omit the budget to avoid HTTP 400 errors.
    return { extendedThinking: supportsExtendedThinking(provider?.model) ? 10000 : undefined };
  }

  promptTemplate(context: ContextBundle): string {
    return [
      `Dimension: ${this.dimension}`,
      '',
      'ROLE',
      'Identify REAL security vulnerabilities with high confidence. Be CONSERVATIVE — only report issues you are certain about after checking for mitigating factors.',
      '',
      CONSERVATIVE_FINDING_BLOCK,
      '',
      'WHAT TO CHECK',
      '',
      '1. SQL Injection',
      '   Pattern: user-controlled input concatenated directly into a SQL string.',
      '   Mitigating factors (check BEFORE flagging):',
      '     - Input parsed as integer via parseInt()/Number() with isNaN check',
      '     - ORM with parameterized queries (Prisma, TypeORM, Sequelize with ? placeholders)',
      '     - Input matched against a strict whitelist',
      '   Vulnerable: `"SELECT * FROM users WHERE id = " + req.body.id`',
      '   Safe (do NOT flag): `const id = parseInt(req.params.id, 10); if (isNaN(id)) return 400; db.query("SELECT * FROM users WHERE id = " + id)`',
      '',
      '2. XSS / HTML Injection',
      '   Pattern: user input rendered into HTML without escaping.',
      '   Mitigating factors: React JSX auto-escapes, template engine with auto-escape enabled, explicit DOMPurify/sanitize-html call.',
      '   Vulnerable: `res.send("<div>" + req.query.name + "</div>")`',
      '   Safe (do NOT flag): React `<div>{name}</div>` (JSX escapes automatically)',
      '',
      '3. Hardcoded Secrets',
      '   Pattern: API keys, passwords, tokens, or private keys as string literals.',
      '   Mitigating factors: string contains "test", "mock", "fake", "example", "placeholder", "xxx", or is clearly a variable name (not a real value).',
      '   Vulnerable: `const apiKey = "sk-prod-abc123real";`',
      '   Safe (do NOT flag): `const apiKey = "test-key-mock"` or `process.env.API_KEY`',
      '',
      '4. Missing Authentication / Authorization',
      '   Pattern: new route or endpoint handler with no auth middleware or guard.',
      '   Mitigating factors: check FULL FILE CONTEXT for auth middleware applied at router level, decorator, or higher in the call chain.',
      '   Only flag if you can confirm no auth exists at any level.',
      '',
      '5. CSRF Vulnerabilities',
      '   Pattern: state-mutating endpoint (POST/PUT/DELETE) with no CSRF protection.',
      '   Mitigating factors: SameSite=Strict/Lax cookie, CSRF token middleware, JWT in Authorization header (not cookie).',
      '',
      '6. Path Traversal',
      '   Pattern: user input used in file path construction.',
      '   Mitigating factors: `path.resolve()` combined with a basedir check, input validated against whitelist of allowed filenames.',
      '   Vulnerable: `fs.readFile("./files/" + req.params.name)`',
      '   Safe: `const resolved = path.resolve(BASE_DIR, req.params.name); if (!resolved.startsWith(BASE_DIR)) return 400;`',
      '',
      '7. Insecure Deserialization',
      '   Pattern: `JSON.parse`, `eval`, `deserialize` on untrusted input with no schema validation.',
      '   Mitigating factors: Zod/Joi/Yup schema parse immediately after deserialization.',
      '',
      '8. Weak Cryptography',
      '   Pattern: MD5/SHA1 for passwords, `Math.random()` for tokens/keys, ECB mode.',
      '   Mitigating factors: hashing with bcrypt/scrypt/argon2 (safe even with variable named "password"), CSPRNG for tokens.',
      '',
      'FALSE POSITIVE PATTERNS — DO NOT REPORT',
      '- `test-key`, `mock-`, `fake-`, `example-`, `placeholder` string literals',
      '- Variables named `passwordHash`, `hashedPassword`, etc. storing bcrypt/scrypt output',
      '- `parseInt`-validated numeric params used in SQL',
      '- React JSX interpolation (auto-escaped)',
      '- Template engines with auto-escape enabled by default (Handlebars, Nunjucks)',
      '- Auth middleware applied at router/app level (visible in full file context)',
      '- Input that is not attacker-controlled (server constants, config, generated IDs)',
      '- Test files (*.test.ts, *.spec.ts, __tests__/*) unless they expose real credentials',
      '',
      'CONSERVATIVE REPORTING RULES',
      '- Must cite exact code from diff or file context as evidence',
      '- falsePositiveRisk guidance:',
      '    low    → obvious issue, no mitigating factors present',
      '    medium → likely issue, some uncertainty about full context',
      '    high   → possible issue, significant mitigating factors present',
      '- Do NOT report if falsePositiveRisk would be high and severity is not critical',
      '- Do NOT report on test/mock data, hash storage, or framework-managed escaping',
      '',
      'DIFF (what changed):',
      renderDiffSummary(context.diff),
      '',
      'CHANGED FUNCTIONS (the full function body containing each diff hunk — check here for validation/auth before flagging):',
      renderFunctionContext(context.diff, context.entries),
      '',
      'FULL FILE CONTEXT (read carefully — check for mitigating factors before flagging):',
      renderFileContext(context.entries),
      '',
      SEVERITY_CRITERIA_BLOCK,
      '',
      'BEFORE PRODUCING FINDINGS',
      'For each candidate vulnerability, trace the attack path end-to-end: (1) Where does attacker-controlled input enter? (2) Does it reach a dangerous sink without sanitization? (3) Have I checked the full file context for mitigating controls (auth middleware, parameterized queries, framework escaping)?',
      'Only report findings where you can answer yes/yes/no respectively.',
      '',
      FINDING_SCHEMA_BLOCK,
    ].join('\n');
  }
}
