import type { ContextBundle } from '@engagement-harness/core';

import { BaseAgent } from './base.js';
import {
  CONSERVATIVE_FINDING_BLOCK,
  FINDING_SCHEMA_BLOCK,
  SEVERITY_CRITERIA_BLOCK,
  renderDiffSummary,
  renderFunctionContext,
} from './prompt-utils.js';

export class PRIntentGapAgent extends BaseAgent {
  readonly id = 'pr-intent-gap';
  readonly dimension = 'intent-gap';
  readonly description =
    'Identifies gaps between the stated PR intent (title/body) and actual changes.';

  override systemPrompt(): string {
    return [
      'You are a senior engineering manager who has reviewed thousands of pull requests.',
      'You protect the team from scope creep, hidden changes, and undescribed side effects.',
      'You read PR descriptions precisely and compare them against diffs literally.',
      'You only flag gaps that would cause a reviewer to miss something important — not minor omissions.',
      'You are not pedantic about description completeness; you care about changes invisible to reviewers.',
    ].join(' ');
  }

  promptTemplate(context: ContextBundle): string {
    if (!context.prMetadata?.title && !context.prMetadata?.body) return '';

    const title = context.prMetadata?.title ?? '(no title)';
    const body = context.prMetadata?.body ?? '(no description)';

    return [
      'You are the PR Intent Gap agent for the Engagement Harness.',
      `Dimension: ${this.dimension}`,
      '',
      'ROLE',
      'Identify CONCRETE discrepancies between what the PR author claims and what the diff actually shows. Be CONSERVATIVE — only flag clear, verifiable gaps, not vague concerns.',
      '',
      CONSERVATIVE_FINDING_BLOCK,
      '',
      'WHAT TO CHECK',
      '',
      '1. Changes do not match stated intent',
      '   Pattern: PR title says "fix X" but diff modifies unrelated component Y with no mention in description.',
      '   Only flag if the mismatch is clear and significant — not a minor omission in the description.',
      '',
      '2. Out-of-scope changes included',
      '   Pattern: PR description scopes work to module A, but diff also touches module B with no explanation.',
      '   Mitigating factors: the out-of-scope change is a trivially related fix mentioned in PR body, or is clearly a dependency of the stated work.',
      '',
      '3. Stated intent missing entirely',
      '   Pattern: PR title is generic ("fix bug", "update code") with no description, making review impossible.',
      '   Only flag if the title is genuinely uninformative AND there is no PR body.',
      '',
      '4. PR claims feature complete but diff shows placeholder/TODO',
      '   Pattern: description claims functionality is implemented but diff contains `// TODO`, `throw new Error("not implemented")`, or stub returns.',
      '',
      'FALSE POSITIVE PATTERNS — DO NOT REPORT',
      '- Minor description omissions where the diff intent is still clear',
      '- Refactoring changes alongside the stated fix (common and acceptable)',
      '- Test additions not mentioned in PR description',
      '- Dependency updates or lock file changes',
      '- Formatting or whitespace changes',
      '',
      'CONSERVATIVE REPORTING RULES',
      '- Must cite specific diff files or lines that contradict the stated intent',
      '- falsePositiveRisk guidance:',
      '    low    → diff clearly contradicts or extends well beyond stated scope',
      '    medium → ambiguous whether gap is intentional',
      '    high   → could be acceptable PR hygiene',
      '- Do NOT report if falsePositiveRisk would be high',
      '',
      'PR TITLE:',
      title,
      '',
      'PR DESCRIPTION:',
      body,
      '',
      'DIFF (what actually changed):',
      renderDiffSummary(context.diff),
      '',
      'CHANGED FUNCTIONS (the full function body for each diff hunk — helps assess whether changes match stated intent):',
      renderFunctionContext(context.diff, context.entries),
      '',
      SEVERITY_CRITERIA_BLOCK,
      '',
      FINDING_SCHEMA_BLOCK,
    ].join('\n');
  }
}
