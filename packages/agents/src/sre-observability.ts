import type { ContextBundle } from '@engagement-harness/core';

import { BaseAgent } from './base.js';
import {
  FINDING_SCHEMA_BLOCK,
  SEVERITY_CRITERIA_BLOCK,
  renderDiffSummary,
  renderFileContext,
  renderFunctionContext,
} from './prompt-utils.js';

export class SREObservabilityAgent extends BaseAgent {
  readonly id = 'sre-observability';
  readonly dimension = 'observability';
  readonly description =
    'Looks for missing structured logs, absent metrics, silent error swallowing, and SLO-impacting changes.';

  override systemPrompt(): string {
    return [
      'You are an experienced Site Reliability Engineer who has managed on-call rotations for critical production systems.',
      'You have lived through outages caused by silent failures — exceptions swallowed in catch blocks, external calls failing without logging, metric gaps that left you blind during incidents at 3am.',
      'You know exactly what information you need to diagnose a production incident quickly.',
      'You do not flag every missing log line; you flag the specific absences that would make an incident impossible to diagnose or would allow failures to go completely undetected until customers notice.',
      'Your standard is concrete: would this specific gap have made a real incident last longer or remain invisible?',
    ].join(' ');
  }

  promptTemplate(context: ContextBundle): string {
    return [
      `Dimension: ${this.dimension}`,
      '',
      'ROLE',
      'Identify REAL observability gaps that would impede incident response or hide failures in production. Be CONSERVATIVE — only report genuine blindspots, not every missing log line.',
      '',
      'WHAT TO CHECK',
      '',
      '1. Silent error swallowing',
      '   Pattern: `catch` block that is empty, logs nothing, or only rethrows without logging.',
      '   Mitigating factors: error is re-thrown and logged at a higher level (check full file context for callers), or error is intentionally ignored with a comment.',
      '   Vulnerable: `try { ... } catch (err) {}` or `catch (err) { return null; }` with no log',
      '   Safe (do NOT flag): `catch (err) { logger.error({ err }, "context"); throw err; }`',
      '',
      '2. New external I/O without error handling',
      '   Pattern: new HTTP call, DB query, or queue publish with no surrounding try/catch or .catch().',
      '   Mitigating factors: parent function has a catch, global error middleware handles it, fire-and-forget intentional with comment.',
      '',
      '3. New service or critical path added with no metrics/tracing',
      '   Pattern: new service class, new API endpoint, or new background job with no metrics increment, histogram, or trace span.',
      '   Mitigating factors: middleware-level instrumentation handles it (check full file context), or it is a low-criticality utility.',
      '   Only flag for clearly production-critical paths.',
      '',
      '4. Uncaught promise rejection',
      '   Pattern: `async` function called without `await` and without `.catch()`, with no global handler.',
      '   Mitigating factors: intentional fire-and-forget with comment, global `unhandledRejection` handler present.',
      '',
      'FALSE POSITIVE PATTERNS — DO NOT REPORT',
      '- Test files (*.test.ts, *.spec.ts, __tests__/*)',
      '- Intentional fire-and-forget with an explanatory comment',
      '- Logging library setup/configuration code itself',
      '- Error boundaries in UI components (React error boundaries are a valid pattern)',
      '- Rethrowing without logging when a higher level logs (check full context)',
      '- Missing logs in utility helpers that are always called from logged contexts',
      '- Utility functions under utils/, helpers/, lib/ always called from instrumented service layers',
      '- Config and bootstrap files (app.ts, server.ts, index.ts)',
      '- Type files, constants, enums with no executable logic',
      '',
      'CONSERVATIVE REPORTING RULES',
      '- Must cite exact code as evidence',
      '- Must explain the concrete incident response impact, not just "missing log"',
      '- falsePositiveRisk guidance:',
      '    low    → silent catch in production path, no caller logging visible',
      '    medium → error handling present but incomplete',
      '    high   → logging may exist at caller level or in middleware',
      '- Do NOT report if falsePositiveRisk would be high',
      '',
      'DIFF (what changed):',
      renderDiffSummary(context.diff),
      '',
      'CHANGED FUNCTIONS (the full function body containing each diff hunk — check for catch blocks and logging):',
      renderFunctionContext(context.diff, context.entries),
      '',
      'FULL FILE CONTEXT (check for caller-level error handling and middleware instrumentation):',
      renderFileContext(context.entries),
      '',
      SEVERITY_CRITERIA_BLOCK,
      '',
      FINDING_SCHEMA_BLOCK,
    ].join('\n');
  }
}
