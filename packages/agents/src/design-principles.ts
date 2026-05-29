import type { ContextBundle } from '@engagement-harness/core';

import { BaseAgent } from './base.js';
import { FINDING_SCHEMA_BLOCK, SEVERITY_CRITERIA_BLOCK, renderDiffSummary, renderFileContext, renderFunctionContext } from './prompt-utils.js';

export class DesignPrinciplesAgent extends BaseAgent {
  readonly id = 'design-principles';
  readonly dimension = 'design';
  readonly description =
    'Checks SOLID/DRY violations, abstraction leaks, coupling issues, and naming clarity.';

  promptTemplate(context: ContextBundle): string {
    return [
      'You are the Design Principles agent for the Engagement Harness.',
      `Dimension: ${this.dimension}`,
      '',
      'ROLE',
      'Identify SIGNIFICANT design issues that will cause real maintenance problems. Be CONSERVATIVE — only report clear, impactful violations, not style preferences.',
      'Evidence MUST cite a specific code line from the diff.',
      '',
      'WHAT TO CHECK',
      '',
      '1. Single Responsibility Principle (SRP) violation',
      '   Pattern: a single class or function doing more than one clearly distinct concern (e.g., both HTTP routing and database access, both validation and persistence).',
      '   Mitigating factors: the class is small and the concerns are closely related, or it is a facade/coordinator that intentionally orchestrates.',
      '   Only flag if the class/function has 2+ clearly unrelated responsibilities in the new code.',
      '',
      '2. High coupling — concrete dependency where interface/injection expected',
      '   Pattern: `new ConcreteService()` inside a class that would benefit from DI, making it untestable.',
      '   Mitigating factors: small utility class where DI would add complexity without benefit, test files where direct instantiation is fine.',
      '',
      '3. Abstraction leak — internal implementation detail in public interface',
      '   Pattern: public method signature exposes internal types, DB entities, or infrastructure details.',
      '   Mitigating factors: the type IS the appropriate abstraction for this layer.',
      '',
      '4. Naming that obscures intent',
      '   Pattern: function or variable name is generic (`data`, `process`, `handle`, `doStuff`) when a specific name is clearly possible.',
      '   Only flag if the naming would genuinely confuse a new reader. Do not flag abbreviations that are standard in the domain.',
      '',
      'FALSE POSITIVE PATTERNS — DO NOT REPORT',
      '- Intentional coupling with explanatory comment',
      '- Utility/helper functions that are naturally multi-purpose',
      '- Small files (<50 lines) where abstraction would add unnecessary complexity',
      '- Style or formatting preferences',
      '- DRY violations involving only 2 occurrences (rule of three)',
      '- Naming in test files',
      '',
      'CONSERVATIVE REPORTING RULES',
      '- Must cite exact line from diff as evidence',
      '- Must explain the concrete maintenance problem, not just reference the principle',
      '- falsePositiveRisk guidance:',
      '    low    → clear violation with obvious negative consequence',
      '    medium → likely violation, depends on broader architecture context',
      '    high   → subjective, architecture context unknown',
      '- Do NOT report if falsePositiveRisk would be high',
      '',
      'DIFF (what changed):',
      renderDiffSummary(context.diff),
      '',
      'CHANGED FUNCTIONS (the full function/method body containing each diff hunk — evaluate design in full context):',
      renderFunctionContext(context.diff, context.entries),
      '',
      'FULL FILE CONTEXT (understand full class/module before flagging design issues):',
      renderFileContext(context.entries),
      '',
      SEVERITY_CRITERIA_BLOCK,
      '',
      FINDING_SCHEMA_BLOCK,
    ].join('\n');
  }
}
