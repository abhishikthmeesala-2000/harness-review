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

export class TestingAgent extends BaseAgent {
  readonly id = 'testing';
  readonly dimension = 'testing';
  readonly description =
    'Looks for missing tests, weak assertions, untested edge cases, untested negative paths.';

  override systemPrompt(): string {
    return [
      'You are a senior quality assurance engineer and test architect with deep expertise in building reliable test suites for complex TypeScript systems.',
      'You think about what would break silently in production if the code were wrong — not just which lines lack coverage, but which behavior changes would go entirely undetected.',
      'You know the difference between meaningful assertions and superficial line coverage, and you understand what unit tests, integration tests, and E2E tests each actually verify.',
      'Before claiming a test gap, you check whether coverage exists in any form — including integration tests, test entries in the context, or calls from already-tested public surfaces.',
      'You only flag missing tests when the absence would genuinely allow a production bug to reach users undetected.',
    ].join(' ');
  }

  promptTemplate(context: ContextBundle): string {
    return [
      `Dimension: ${this.dimension}`,
      '',
      'ROLE',
      'Identify REAL gaps in test coverage for code changes. Be CONSERVATIVE — only flag missing tests when coverage is genuinely absent and the code is non-trivial.',
      '',
      CONSERVATIVE_FINDING_BLOCK,
      '',
      'WHAT TO CHECK',
      '',
      '1. New exported functions/classes without any test',
      '   Pattern: `export function` or `export class` added in diff with no corresponding test file.',
      '   Mitigating factors (check BEFORE flagging):',
      '     - Any test entry (kind=test) in full file context reaches the changed behavior',
      '     - Integration or E2E test files reference the module or surface',
      '     - Function is a trivial getter/setter/type guard with no logic',
      '     - File is a type-only or config-only file',
      '',
      '2. Changed logic paths without updated test assertions',
      '   Pattern: conditional branch, return value, or algorithm changed in diff but test file unchanged.',
      '   Mitigating factors: existing assertions still cover the new behavior, change is a refactor with identical observable behavior.',
      '',
      '3. Missing error/null path tests',
      '   Pattern: function handles errors or null inputs but no test covers those paths.',
      '   Mitigating factors: error path is unreachable given type constraints, framework handles it.',
      '',
      '4. Async functions without rejection/timeout tests',
      '   Pattern: new async function with no test for the reject case.',
      '   Mitigating factors: function is a thin wrapper with rejection propagated and tested at the call site.',
      '',
      'FALSE POSITIVE PATTERNS — DO NOT REPORT',
      '- Code covered by any test entry, integration test, or neighboring fixture in the provided context',
      '- Trivial getters, setters, property accessors with no logic',
      '- Type-only files (interfaces, type aliases, enums only)',
      '- Config-only files (no executable logic)',
      '- Test files themselves',
      '- Private/internal helpers called only by already-tested public functions',
      '',
      'CONSERVATIVE REPORTING RULES',
      '- Must verify no existing test covers the code before flagging',
      '- falsePositiveRisk guidance:',
      '    low    → new public function, no test file exists at all',
      '    medium → logic changed, existing tests may or may not cover new path',
      '    high   → uncertain if coverage exists elsewhere',
      '- Do NOT report if falsePositiveRisk would be high and severity is not critical',
      '',
      'DIFF (what changed):',
      renderDiffSummary(context.diff),
      '',
      'CHANGED FUNCTIONS (the full function body containing each diff hunk — check if function has test coverage):',
      renderFunctionContext(context.diff, context.entries),
      '',
      'FULL FILE CONTEXT (includes test files — check these before claiming tests are missing):',
      renderFileContext(context.entries),
      '',
      SEVERITY_CRITERIA_BLOCK,
      '',
      FINDING_SCHEMA_BLOCK,
    ].join('\n');
  }
}
