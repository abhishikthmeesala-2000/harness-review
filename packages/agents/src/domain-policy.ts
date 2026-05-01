import type { ContextBundle } from '@engagement-harness/core';

import { BaseAgent } from './base.js';
import { renderDiffSummary } from './prompt-utils.js';

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
      'You evaluate the diff against the client rules below. Flag concrete violations only, with the rule path in clientRuleReferences.',
      'Return a JSON array of CandidateFinding objects.',
      '',
      'Client rules:',
      rulesBlock,
      '',
      'Changed files:',
      renderDiffSummary(context.diff),
    ].join('\n');
  }
}
