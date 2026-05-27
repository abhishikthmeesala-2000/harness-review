import type { ContextBundle } from '@engagement-harness/core';

import { BaseAgent } from './base.js';
import { FINDING_SCHEMA_BLOCK, renderDiffSummary, renderFunctionContext } from './prompt-utils.js';

export class DomainPolicyAgent extends BaseAgent {
  readonly id = 'domain-policy';
  readonly dimension = 'domain-policy';
  readonly description =
    'Flags violations of client-specific rules drawn from .engagement-harness/rules/*.md.';

  promptTemplate(context: ContextBundle): string {
    const rules = context.entries.filter((e) => e.kind === 'rule');
    if (rules.length === 0) {
      // No rules matched the diff — there is nothing to evaluate. Returning an
      // empty prompt makes BaseAgent.run skip the provider call entirely.
      return '';
    }
    const rulesBlock = rules.map((r) => `### ${r.path}\n${r.content.trim()}`).join('\n\n');

    return [
      'You are the Domain-Policy agent for the Engagement Harness.',
      `Dimension: ${this.dimension}`,
      '',
      'ROLE',
      'Evaluate the diff against the client rules below. These rules are team requirements — be STRICT. Flag concrete violations only.',
      '',
      'RULES',
      'Each rule block may have frontmatter with a `globs` pattern. Only apply a rule if the changed file matches its glob. If no glob is specified, the rule applies to all files.',
      '',
      rulesBlock,
      '',
      'HOW TO FLAG',
      '- Quote the specific rule text being violated in `clientRuleReferences` (use the rule file path)',
      '- Only flag concrete, verifiable violations — not speculative or possible violations',
      '- Set `evidence` to the exact diff line that violates the rule',
      '- Set `falsePositiveRisk: low` for clear rule violations',
      '- Set `falsePositiveRisk: medium` if the violation depends on runtime context',
      '',
      'DO NOT REPORT',
      '- Violations in test/mock files unless the rule explicitly covers test files',
      '- Speculative violations ("might" violate the rule)',
      '- Rules that do not match the changed file paths',
      '',
      'DIFF (what changed):',
      renderDiffSummary(context.diff),
      '',
      'CHANGED FUNCTIONS (the full function body containing each diff hunk — check rule applicability in full context):',
      renderFunctionContext(context.diff, context.entries),
      '',
      FINDING_SCHEMA_BLOCK,
    ].join('\n');
  }
}
