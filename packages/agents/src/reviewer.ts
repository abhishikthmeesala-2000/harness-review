import type { ContextBundle } from '@engagement-harness/core';
import type { CompletionOptions } from '@engagement-harness/providers';

import { BaseAgent } from './base.js';
import {
  FINDING_SCHEMA_BLOCK,
  SEVERITY_CRITERIA_BLOCK,
  renderDiffSummary,
  renderFileContext,
  renderFunctionContext,
} from './prompt-utils.js';

export class ReviewerAgent extends BaseAgent {
  readonly id = 'reviewer';
  readonly dimension = 'correctness';
  readonly description =
    'Looks for logic bugs, off-by-one errors, edge cases, null handling, and risky behavior changes.';

  override systemPrompt(): string {
    return [
      'You are a principal software engineer with 15+ years of experience reviewing production TypeScript and JavaScript codebases at high-traffic companies.',
      'You have caught hundreds of real bugs in code review — subtle logic errors, off-by-one mistakes, race conditions, null dereferences — and have equally learned to recognize intentional patterns that look wrong but are not.',
      'You are methodical: before flagging anything you mentally trace execution paths, consider edge inputs, and ask whether the apparent bug is actually correct-by-design.',
      'You report only findings you could defend in a code review discussion with the author.',
      'You prefer false negatives over false positives — staying silent when uncertain is the right call.',
    ].join(' ');
  }

  override completionOptions(): CompletionOptions {
    // Extended thinking gives the reviewer a scratchpad to trace logic paths
    // before committing to a finding — dramatically reduces false positives.
    return { extendedThinking: 8000 };
  }

  promptTemplate(context: ContextBundle): string {
    return [
      `Dimension: ${this.dimension}`,
      '',
      'ROLE',
      'Identify REAL logic bugs and correctness issues with high confidence. Be CONSERVATIVE — only report issues you can demonstrate with specific evidence from the code.',
      '',
      'WHAT TO CHECK',
      '',
      '1. Logic bugs — off-by-one, wrong operator, inverted condition',
      '   Pattern: boundary check uses `<` instead of `<=`, array index goes out of bounds, condition is negated when it should not be.',
      '   Mitigating factors: look at full context — the apparent bug may be intentional (e.g., exclusive upper bound is correct for slicing).',
      '   Vulnerable: `for (let i = 0; i <= arr.length; i++)` — accesses arr[arr.length] which is undefined',
      '   Safe (do NOT flag): `for (let i = 0; i < arr.length; i++)`',
      '',
      '2. Null/undefined dereference without guard',
      '   Pattern: property access or method call on a value that could be null/undefined.',
      '   Mitigating factors: TypeScript type shows the value is non-nullable, caller guarantees non-null, optional chaining used.',
      '   Vulnerable: `user.profile.name` where `user.profile` can be null',
      '   Safe (do NOT flag): `user.profile?.name`, or TypeScript type is `Profile` (not `Profile | null`)',
      '',
      '3. Risky behavior change to existing public API',
      '   Pattern: function signature, return type, or observable behavior changed in a way that breaks callers.',
      '   Mitigating factors: check full file context for all callers — if all callers updated, not a risk.',
      '',
      '4. Unhandled async rejection',
      '   Pattern: `Promise` or `async` call with no `.catch()` or `try/catch` and no `await`.',
      '   Mitigating factors: global unhandledRejection handler present, fire-and-forget intentional (look for comment).',
      '',
      'FALSE POSITIVE PATTERNS — DO NOT REPORT',
      '- Intentional design patterns explained in comments',
      '- Framework-guaranteed non-null values (e.g., Express `req.params` after route match)',
      '- Exclusive bounds that are correct (e.g., `slice(0, n)` is correct, not off-by-one)',
      '- Test files (unless the bug is in test logic that will cause false test passes)',
      '- Minor style issues (variable naming, formatting)',
      '',
      'CONSERVATIVE REPORTING RULES',
      '- Must cite the exact buggy line(s) as evidence',
      '- Must explain specifically why the code is wrong, not just that it could be wrong',
      '- falsePositiveRisk guidance:',
      '    low    → definite bug, no plausible correct interpretation',
      '    medium → likely bug, but context could make it correct',
      '    high   → possible issue, requires knowledge of surrounding system',
      '- Do NOT report if falsePositiveRisk would be high and severity is not critical',
      '',
      'DIFF (what changed):',
      renderDiffSummary(context.diff),
      '',
      'CHANGED FUNCTIONS (the full function body containing each diff hunk — check full logic before flagging a bug):',
      renderFunctionContext(context.diff, context.entries),
      '',
      'FULL FILE CONTEXT (check surrounding code before concluding something is a bug):',
      renderFileContext(context.entries),
      '',
      SEVERITY_CRITERIA_BLOCK,
      '',
      'BEFORE PRODUCING FINDINGS',
      'For each candidate issue, confirm all three: (1) I can point to the exact line where the bug manifests, (2) I can explain specifically why the code is wrong — not just "could be wrong" — given the full context, (3) I have checked for mitigating factors and none apply.',
      'Only include findings that pass all three checks.',
      '',
      FINDING_SCHEMA_BLOCK,
    ].join('\n');
  }
}
