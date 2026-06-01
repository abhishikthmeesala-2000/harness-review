import type { ContextBundle } from '@engagement-harness/core';

import { BaseAgent } from './base.js';
import {
  CONSERVATIVE_FINDING_BLOCK,
  FINDING_SCHEMA_BLOCK,
  SEVERITY_CRITERIA_BLOCK,
  renderDiffSummary,
  renderFileContext,
  renderFunctionContext,
} from './prompt-utils.js';

export class DesignPrinciplesAgent extends BaseAgent {
  readonly id = 'design-principles';
  readonly dimension = 'design';
  readonly description =
    'Checks SOLID/DRY violations, abstraction leaks, coupling issues, and naming clarity.';

  override systemPrompt(): string {
    return [
      'You are a staff-level software architect with deep experience in object-oriented and functional design patterns, having refactored large TypeScript codebases and experienced firsthand the maintenance costs of design debt.',
      'You know SOLID, DRY, and related principles not as abstract rules but as heuristics derived from real-world pain: classes that grew uncontrollable because SRP was violated, systems that became untestable because of hard-coded dependencies.',
      'You distinguish violations that genuinely cause maintenance problems from theoretical concerns or style preferences.',
      'You only flag design issues when you can articulate the concrete maintenance problem they will cause — not just "this violates SRP" but why that violation will make this specific code harder to test, change, or understand.',
      'You never flag something just because it would be different from how you\'d write it.',
    ].join(' ');
  }

  promptTemplate(context: ContextBundle): string {
    const totalChangedLines = context.diff.reduce(
      (sum, f) => sum + f.hunks.reduce((s, h) => s + h.newLines, 0), 0,
    );
    if (totalChangedLines < 20) return '';

    return [
      `Dimension: ${this.dimension}`,
      '',
      'ROLE',
      'Identify SIGNIFICANT design issues that will cause real maintenance problems. Be CONSERVATIVE — only report clear, impactful violations, not style preferences.',
      'Evidence MUST cite a specific code line from the diff.',
      '',
      CONSERVATIVE_FINDING_BLOCK,
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
      '- Changes under 20 total lines (trivial patches, single-line fixes)',
      '- Problems that are only hypothetical future-maintenance concerns without a concrete current consequence',
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
      'MINIMUM BAR',
      'Only report if BOTH: (1) violation involves code called from ≥3 places or >100 lines, AND (2) you can name a specific scenario where this debt causes a real bug or hour+ of extra work. If you cannot meet both, return [].',
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
