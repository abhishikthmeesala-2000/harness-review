import type { ContextBundle } from '@engagement-harness/core';

import { BaseAgent } from './base.js';
import {
  FINDING_SCHEMA_BLOCK,
  SEVERITY_CRITERIA_BLOCK,
  renderDiffSummary,
  renderFileContext,
  renderFunctionContext,
} from './prompt-utils.js';

const DATA_PATH_RE = /migration|schema|models?\/|db\/|database|prisma|drizzle|knex|sequelize|typeorm|\.sql$/i;

export class DataArchitectureAgent extends BaseAgent {
  readonly id = 'data-architecture';
  readonly dimension = 'data';
  readonly description = 'Flags risky migrations, schema changes, missing indices, and ORM misuse.';

  override systemPrompt(): string {
    return [
      'You are a senior database engineer and data architect with extensive experience in production database migrations and schema design across high-volume PostgreSQL and MySQL systems.',
      'You have seen migrations fail catastrophically — NOT NULL columns without defaults locking production tables for hours, missing foreign-key indices causing full table scans at scale, no rollback path during a failed deployment at 2am.',
      'Before flagging anything, you verify mitigating factors with the same rigor you\'d apply on-call: Does this migration include a backfill step? Is this a genuinely new table? Is there an existing index covering this column? Is the rollback path stubbed intentionally with an explanation?',
      'You only report issues that pose concrete, demonstrable risk to data integrity or availability — not hypothetical concerns about tables that might someday be large.',
    ].join(' ');
  }

  promptTemplate(context: ContextBundle): string {
    const hasDataPaths = context.diff.some((f) => DATA_PATH_RE.test(f.path));
    if (!hasDataPaths) return '';

    return [
      `Dimension: ${this.dimension}`,
      '',
      'ROLE',
      'Identify REAL data integrity and schema safety issues. Be CONSERVATIVE — only report issues that pose concrete risk of data loss, downtime, or corruption.',
      '',
      'WHAT TO CHECK',
      '',
      '1. Non-nullable column added without a DEFAULT',
      '   Pattern: `ALTER TABLE ... ADD COLUMN col NOT NULL` with no `DEFAULT` clause.',
      '   Risk: fails on existing rows if table has data.',
      '   Mitigating factors: migration includes a prior step to backfill the column, or this is a new table with no existing data.',
      '   Vulnerable: `ALTER TABLE orders ADD COLUMN status VARCHAR(20) NOT NULL;`',
      "   Safe (do NOT flag): `ALTER TABLE orders ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'pending';`",
      '',
      '2. Migration with no rollback / down path',
      '   Pattern: migration file has `up()` but no `down()`, or `down()` is empty/stubbed.',
      '   Mitigating factors: migration is explicitly marked irreversible with a comment explaining why.',
      '',
      '3. FK column without index',
      '   Pattern: foreign key column added with no corresponding `CREATE INDEX`.',
      '   Risk: full table scans on joins.',
      '   Mitigating factors: table is small (<1000 rows per team docs), index created in a separate migration.',
      '',
      '4. Unsafe ORM raw query with user input',
      '   Pattern: `sequelize.query(...)`, `knex.raw(...)`, or similar with string interpolation of user-controlled data.',
      '   Mitigating factors: parameterized binding syntax used (? placeholders, named bindings).',
      '   Vulnerable: `sequelize.query("SELECT * FROM users WHERE name = \'" + name + "\'")`',
      '   Safe (do NOT flag): `sequelize.query("SELECT * FROM users WHERE name = ?", { replacements: [name] })`',
      '',
      '5. Destructive schema change',
      '   Pattern: `DROP COLUMN`, `DROP TABLE`, `TRUNCATE`, or column type narrowing.',
      '   Mitigating factors: data confirmed already migrated, column confirmed unused.',
      '',
      'FALSE POSITIVE PATTERNS — DO NOT REPORT',
      '- Test or seed migrations (file path contains `seed`, `fixture`, `test`)',
      '- Nullable column additions (no data integrity risk)',
      '- Columns with explicit DEFAULT values',
      '- ORM parameterized queries (any ? or :named binding syntax)',
      '- New tables (no existing data to break)',
      '',
      'CONSERVATIVE REPORTING RULES',
      '- Must cite exact migration line as evidence',
      '- falsePositiveRisk guidance:',
      '    low    → clear risk on production-sized tables',
      '    medium → risk depends on table size or data state',
      '    high   → theoretical risk, context unknown',
      '- Do NOT report if falsePositiveRisk would be high',
      '',
      'DIFF (what changed):',
      renderDiffSummary(context.diff),
      '',
      'CHANGED FUNCTIONS (the full function/migration body containing each diff hunk):',
      renderFunctionContext(context.diff, context.entries),
      '',
      'FULL FILE CONTEXT (check for rollback paths, existing indices, backfill steps):',
      renderFileContext(context.entries),
      '',
      SEVERITY_CRITERIA_BLOCK,
      '',
      FINDING_SCHEMA_BLOCK,
    ].join('\n');
  }
}
