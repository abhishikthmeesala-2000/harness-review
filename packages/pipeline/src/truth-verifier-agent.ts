import type { CandidateFinding, ContextBundle } from '@engagement-harness/core';
import type { Provider } from '@engagement-harness/providers';
import { z } from 'zod';

import { detectClaimType } from './claim-types.js';
import { getClaimTypeInstructions } from './verifier-prompts.js';

const TruthVerdictDecisionSchema = z.enum(['approved', 'rejected', 'downgrade', 'needs_context']);
const TruthVerdictFailureTypeSchema = z.enum([
  'none',
  'unsupported_claim',
  'contradicted_by_evidence',
  'duplicate',
  'style_only',
  'weak_impact',
  'not_cross_file',
  'severity_too_high',
  'needs_more_context',
]);

const TruthVerdictSchema = z.object({
  findingId: z.string().min(1),
  decision: TruthVerdictDecisionSchema,
  finalSeverity: z.enum(['critical', 'high', 'medium', 'low']),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  failureType: TruthVerdictFailureTypeSchema,
  claimAddressed: z.boolean().optional().default(true),
});

const TruthVerdictsResponseSchema = z.object({
  verdicts: z.array(TruthVerdictSchema),
});

export type TruthVerdict = z.infer<typeof TruthVerdictSchema>;
export type TruthVerdictDecision = z.infer<typeof TruthVerdictDecisionSchema>;
export type TruthVerdictFailureType = z.infer<typeof TruthVerdictFailureTypeSchema>;

const SYSTEM_PROMPT = `You are a strict false-positive reduction verifier.

Your job is NOT to find new issues.
Your job is to approve only findings that are clearly proven by the supplied code context.

For each finding, verify:

1. Does the evidence actually prove the claim?
2. Is there counter-evidence showing the issue is already handled?
3. Is the impact real, specific, and not exaggerated?
4. Is this more than style, preference, or refactoring advice?
5. Is the severity correct?
6. Is the suggested fix directly related to the root cause?
7. Would a senior engineer likely agree this should be reported?

For cross-file findings (pass === "integration"), additionally verify:

1. Does this require two or more files to understand?
2. Is there a real contradiction, mismatch, or integration risk?
3. Is it not just duplicated logic?
4. Is it not already reported by a local reviewer?

Reject if:
- evidence is weak
- claim is speculative
- impact is unclear
- finding is style-only
- finding is duplicate
- evidence contradicts the claim
- confidence is below 0.75

Agent-specific rules:

For findings from agent "testing":
Reject missing-test findings unless the changed code contains business logic, branch behavior affects user-visible correctness, failure would create real bug risk, and nearby project tests show this area is normally tested.

For findings from agent "security":
Reject unless there is a realistic attack path, the changed code introduces or worsens the risk, and the vulnerability is not purely theoretical.

For cross-file findings (pass === "integration"):
Reject unless two or more files are required to understand the issue, there is an actual mismatch or integration risk (not just duplication), and the finding identifies root cause rather than a symptom.

Disprove-first rule: Before approving any finding, search the supplied context for:
- existing validation or sanitization
- existing error handling or global error middleware
- existing tests that already cover this path
- framework behavior that mitigates the issue
- configuration guarantees
- comments explaining the design intent
If you find valid counter-evidence, reject or downgrade.

Prefer missing a weak issue over publishing a false positive.

Use decision levels:
- approved: finding is real, severity is correct — publish it
- downgrade: finding is real but severity is overstated — publish at lower severity (set finalSeverity accordingly)
- rejected: finding is false, speculative, or duplicate — hide it
- needs_context: finding might be real but cannot be determined without more context — suppress from comments

Claim-type-specific rejection rules:

- BUG claims: only reject if you can PROVE the logic is correct. Test coverage does NOT disprove a bug.
- SECURITY claims: only reject if you can show mitigation exists (validation, parameterization, trusted source). Tests do NOT disprove a vulnerability.
- MISSING-TEST claims: reject if you can NAME specific test files and test cases that cover the code.
- INTENT-GAP claims: reject only if the diff clearly implements what the PR description states.

Set claimAddressed=false when your rejection reason does NOT directly address the type of claim being made.
Examples of claimAddressed=false:
  - Rejecting a BUG finding because "tests exist" (tests don't prove logic is correct)
  - Rejecting a SECURITY finding because "there are unit tests" (tests don't prove no vulnerability)
  - Rejecting a MISSING-TEST finding because "the logic looks correct" (correctness doesn't mean coverage exists)

claimAddressed=false means the finding will be published regardless of your rejection decision.

Before setting claimAddressed=true on any rejection, apply this per-claim-type checklist:
  BUG rejection: "Does my reason prove the code logic is correct for the exact scenario described?" If no → claimAddressed=false
  SECURITY rejection: "Does my reason name a specific mitigation present in the code (validation, parameterization, sanitization, trusted source)?" If no → claimAddressed=false
  MISSING-TEST rejection: "Did I name the specific test file AND specific test case that covers this code?" If no → claimAddressed=false
  INTENT-GAP rejection: "Did I cite the specific diff line(s) that implement the PR claim?" If no → claimAddressed=false
  ARCHITECTURE rejection: "Did I show the pattern is consistent with the rest of the codebase OR cite documentation for the exception?" If no → claimAddressed=false
  PERFORMANCE rejection: "Did I show the data size bound or call frequency that makes this acceptable?" If no → claimAddressed=false

Return ONLY a JSON object, no markdown fences:
{
  "verdicts": [
    {
      "findingId": "",
      "decision": "approved | rejected | downgrade | needs_context",
      "finalSeverity": "critical | high | medium | low",
      "confidence": 0.0,
      "reason": "",
      "failureType": "none | unsupported_claim | contradicted_by_evidence | duplicate | style_only | weak_impact | not_cross_file | severity_too_high | needs_more_context",
      "claimAddressed": true
    }
  ]
}`;

const FOCUSED_DIFF_WINDOW = 30;

function renderDiff(context: ContextBundle): string {
  if (context.diff.length === 0) return '(no diff)';
  const parts: string[] = [];
  for (const file of context.diff) {
    parts.push(`--- ${file.path}`);
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
        parts.push(`${prefix}${line.content}`);
      }
    }
  }
  return parts.join('\n');
}

function renderContextEntries(context: ContextBundle): string {
  if (context.entries.length === 0) return '(no additional context)';
  const byKind: Record<string, typeof context.entries> = {};
  for (const e of context.entries) {
    (byKind[e.kind] ??= []).push(e);
  }
  const sections: string[] = [];
  const ORDER = ['changed-file', 'test', 'imports', 'imported-by', 'rule'] as const;
  for (const kind of ORDER) {
    const entries = byKind[kind];
    if (!entries || entries.length === 0) continue;
    sections.push(`=== ${kind.toUpperCase()} FILES ===`);
    for (const e of entries) {
      sections.push(`--- ${e.path} ---`);
      sections.push(e.content.slice(0, 4000));
    }
  }
  return sections.join('\n');
}

function sliceFindingContext(
  finding: CandidateFinding,
  context: ContextBundle,
): { focusedDiff: string; relatedEntries: string } {
  // Focused diff: only hunks from finding.file that overlap with [lineStart±WINDOW]
  const fileDiff = context.diff.find((f) => f.path === finding.file);
  let focusedDiff = '(no diff for this file)';

  if (fileDiff) {
    const lines: string[] = [`--- ${fileDiff.path}`];
    for (const hunk of fileDiff.hunks) {
      const hunkEnd = hunk.newStart + hunk.newLines;
      const inWindow =
        hunkEnd >= finding.lineStart - FOCUSED_DIFF_WINDOW &&
        hunk.newStart <= finding.lineEnd + FOCUSED_DIFF_WINDOW;
      if (inWindow) {
        for (const line of hunk.lines) {
          const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
          lines.push(`${prefix}${line.content}`);
        }
      }
    }
    if (lines.length > 1) focusedDiff = lines.join('\n');
  }

  // Related context entries: those referencing this file or appearing in the evidence
  const evidenceText = finding.evidence.map((e) => e.content).join(' ');
  const findingDir = finding.file.split('/').slice(0, -1).join('/');

  const related = context.entries.filter(
    (e) =>
      e.path === finding.file ||
      evidenceText.includes(e.path) ||
      (e.kind === 'test' && findingDir !== '' && e.path.includes(findingDir)),
  );

  const relatedEntries =
    related.length > 0
      ? related.map((e) => `--- ${e.path} ---\n${e.content.slice(0, 2000)}`).join('\n')
      : '(no related context files)';

  return { focusedDiff, relatedEntries };
}

function buildClaimTypeContext(findings: CandidateFinding[], context: ContextBundle): string {
  const sections: string[] = [];
  for (const f of findings) {
    const claimType = detectClaimType(f);
    const instructions = getClaimTypeInstructions(claimType, context.entries);
    const { focusedDiff, relatedEntries } = sliceFindingContext(f, context);

    sections.push(
      [
        `=== Finding ${f.id} (${f.title}) ===`,
        `CLAIM TYPE: ${claimType}`,
        instructions,
        '',
        `FOCUSED DIFF (${f.file}, lines ${f.lineStart}-${f.lineEnd} ±${FOCUSED_DIFF_WINDOW}):`,
        focusedDiff,
        '',
        'RELATED CONTEXT (test files, imports):',
        relatedEntries,
      ].join('\n'),
    );
  }
  return sections.join('\n\n');
}

function buildPrompt(findings: CandidateFinding[], context: ContextBundle): string {
  const findingsSummary = findings.map((f) => ({
    id: f.id,
    title: f.title,
    category: f.category,
    severity: f.severity,
    file: f.file,
    lineStart: f.lineStart,
    lineEnd: f.lineEnd,
    pass: f.pass ?? 'local',
    filesInvolved: f.filesInvolved ?? [],
    sourceAgent: f.sourceAgent,
    evidence: f.evidence,
    whyItMatters: f.whyItMatters,
    suggestedFix: f.suggestedFix,
    falsePositiveRisk: f.falsePositiveRisk,
    claimType: detectClaimType(f),
  }));

  return [
    'FINDINGS TO VERIFY',
    JSON.stringify(findingsSummary, null, 2),
    '',
    'CLAIM-TYPE-SPECIFIC EVALUATION AND FOCUSED CONTEXT PER FINDING',
    buildClaimTypeContext(findings, context),
    '',
    'FULL DIFF (all changed files, for cross-file reference)',
    renderDiff(context),
    '',
    'FULL CONTEXT (all changed files, tests, imports, rules)',
    renderContextEntries(context),
  ].join('\n');
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // attempt to find the first {...} block
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

export const TruthVerifierAgent = {
  async run(
    findings: CandidateFinding[],
    context: ContextBundle,
    provider: Provider,
  ): Promise<TruthVerdict[]> {
    if (findings.length === 0) return [];

    const prompt = buildPrompt(findings, context);

    let raw: string;
    try {
      const result = await provider.complete(prompt, {
        system: SYSTEM_PROMPT,
        extendedThinking: 8000,
      });
      raw = result.content;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[truth-verifier] provider error: ${msg}`);
      return [];
    }

    const parsed = extractJson(raw);
    if (!parsed) {
      console.warn('[truth-verifier] could not parse JSON response');
      return [];
    }

    const result = TruthVerdictsResponseSchema.safeParse(parsed);
    if (!result.success) {
      console.warn(`[truth-verifier] invalid response schema: ${result.error.message}`);
      return [];
    }

    return result.data.verdicts;
  },
};
