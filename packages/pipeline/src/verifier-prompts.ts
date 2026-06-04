import type { CandidateFinding, ContextEntry } from '@engagement-harness/core';

import type { ClaimType } from './claim-types.js';

const VERIFIER_RESPONSE_FORMAT = `

Respond with ONLY valid JSON:
{
  "decision": "accept" | "reject",
  "reason": "specific technical reason that addresses the claim directly",
  "confidence": 0.0-1.0,
  "claimAddressed": true | false
}

claimAddressed must be true only if your reason
directly addresses the specific claim being made.
If false, the system will publish the finding anyway.
`;

export function buildVerifierPrompt(
  finding: CandidateFinding,
  claimType: ClaimType,
  fileContent: string,
  allContext: ContextEntry[],
): string {
  const base = `
Finding to verify:
  Title: ${finding.title}
  Severity: ${finding.severity}
  File: ${finding.file}
  Lines: ${finding.lineStart}-${finding.lineEnd}
  Evidence: ${finding.evidence.map((e) => e.content).join('; ')}

Full file content:
\`\`\`
${fileContent}
\`\`\`
`;

  const instructions = getClaimTypeInstructions(claimType, allContext);

  return base + instructions + VERIFIER_RESPONSE_FORMAT;
}

export function getClaimTypeInstructions(claimType: ClaimType, context: ContextEntry[]): string {
  switch (claimType) {
    case 'bug':
      return `
CLAIM TYPE: BUG
You must determine if this is a real logical error.

TO REJECT — you must show the code is correct:
  - Prove the logic handles the described scenario
  - Show the edge case cannot actually occur
  - Show the behavior is intentional

DO NOT REJECT based on:
  - Test coverage (tests do not prove correctness)
  - PR description
  - Code style

TO ACCEPT — show the bug is real:
  - Exact scenario where it triggers
  - Wrong output vs expected output
`;

    case 'security':
      return `
CLAIM TYPE: SECURITY VULNERABILITY
You must determine if this is a real vulnerability.

TO REJECT — you must show mitigation exists:
  - Show input validation BEFORE the operation
  - Show output sanitization/escaping
  - Show parameterization is used
  - Show data is from trusted internal source only

DO NOT REJECT based on:
  - Test coverage
  - "Unlikely to be exploited"
  - Low severity

TO ACCEPT — show the exploit path:
  - How attacker reaches this code
  - What malicious input looks like
  - What damage it causes
`;

    case 'missing-test': {
      const testFiles = context
        .filter((e) => e.kind === 'test')
        .map((e) => `${e.path}:\n${e.content}`)
        .join('\n\n');

      return `
CLAIM TYPE: MISSING TEST COVERAGE
You must determine if tests actually exist.

All test files in this diff:
${testFiles || '(no test files found in diff)'}

TO REJECT — you must show tests exist:
  - Name the specific test file
  - Name the specific test cases
  - Show which functions are covered

TO ACCEPT — show what is untested:
  - Which specific functions have no tests
  - Which edge cases are missing
`;
    }

    case 'intent-gap':
      return `
CLAIM TYPE: PR INTENT MISMATCH
You must determine if the code matches the PR description.

TO REJECT — show description matches code:
  - Point to specific diff sections that match claims
  - Explain how the code achieves stated intent

TO ACCEPT — show the mismatch:
  - What PR claims vs what diff actually shows
  - What is missing from the implementation
`;

    case 'architecture':
      return `
CLAIM TYPE: ARCHITECTURE VIOLATION
You must determine if this is a real design problem.

TO REJECT — show design is intentional:
  - Pattern is consistent with rest of codebase
  - Design decision is documented
  - Exception is justified

TO ACCEPT — show the violation:
  - Which principle is violated
  - What the correct pattern should be
  - Why it matters for this codebase
`;

    case 'performance':
      return `
CLAIM TYPE: PERFORMANCE ISSUE
You must determine if this is a real performance problem.

TO REJECT — show performance is acceptable:
  - Data size is always small (< 100 items)
  - Operation runs infrequently
  - Optimization would add complexity with no benefit

TO ACCEPT — show the problem is real:
  - When/how it becomes slow
  - Realistic data size that causes issues
  - How much slower (O(n) vs O(n²) etc)
`;

    default:
      return `
Determine if this finding is accurate and actionable.
Reject only if clearly wrong or irrelevant.
Accept if there is reasonable doubt.
`;
  }
}
