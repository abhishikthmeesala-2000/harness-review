/**
 * Demo: run security agent via Anthropic API on sample-repo diff,
 * replicate the full pipeline (verifier + evidence scorer + confidence scorer),
 * then render every published finding as the exact inline PR comment that
 * postInlineComment() would POST to GitHub.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/demo-anthropic-comments.ts
 */

// ── Prompt constants (mirrors packages/agents/src/prompt-utils.ts) ───────────

const FINDING_SCHEMA_BLOCK = `Return ONLY a JSON array. Each element must match this exact shape (no extra fields):
[
  {
    "id": "EH-<AGENT>-<N>",
    "title": "Short description (max 120 chars)",
    "category": "<one of: correctness | security | testing | domain-policy | design | data | observability | intent-gap>",
    "dimension": "<same as the Dimension line above>",
    "severity": "<one of: low | medium | high | critical>",
    "file": "<exact filename from the diff>",
    "lineStart": <positive integer>,
    "lineEnd": <positive integer, >= lineStart>,
    "evidence": [{ "type": "<diff | context | rule>", "content": "<exact line(s) from the diff>" }],
    "whyItMatters": "Why this is a real risk",
    "suggestedFix": "Concrete fix, not generic advice",
    "clientRuleReferences": [],
    "falsePositiveRisk": "<low | medium | high>",
    "sourceAgent": "placeholder",
    "modelProvider": "placeholder",
    "remediationReadiness": "<ready | needs-context | manual-only>"
  }
]
Return [] if you find nothing worth flagging. Do NOT wrap in markdown fences.`;

// ── Simulated diff (mirrors what GitDiffParser produces for the sample repo) ──

const SIMULATED_DIFF_TEXT = `--- src/payments/charge.ts (added)
@@ -0,0 +1,12 @@
+import Stripe from 'stripe';
+
+const stripe = new Stripe(process.env['STRIPE_SECRET_KEY'] ?? '');
+
+// Missing idempotency key — intentional for domain-policy eval case
+export async function chargeCustomer(amount: number, customerId: string): Promise<string> {
+  const paymentIntent = await stripe.paymentIntents.create({
+    amount,
+    currency: 'usd',
+    customer: customerId,
+  });
+  return paymentIntent.id;
+}

--- src/routes/admin.ts (added)
@@ -0,0 +1,18 @@
+// admin routes module
+const express = require('express');
+const { db } = require('../db');
+const router = express.Router();
+
+// ============================================
+// Admin endpoints — No authentication!
+// ============================================
+
+// Delete all records endpoint (INSECURE)
+// TODO: add auth middleware
+app.post("/admin/delete", async (req, res) => {
+  const result = await db.deleteAll();
+  res.json(result);
+});
+
+module.exports = router;

--- src/utils/range.ts (added)
@@ -0,0 +1,9 @@
+// range utilities
+function range(start: number, end: number): number[] {
+  const items: number[] = [];
+for (let i = 0; i <= items.length; i++) {
+    items.push(start + i);
+  }
+  return items;
+}
+module.exports = { range };

--- src/services/user-service.ts (added)
@@ -0,0 +1,24 @@
+import type { Pool } from 'pg';
+
+export interface User {
+  id: string;
+  email: string;
+  name: string;
+}
+
+export class UserService {
+  constructor(private readonly db: Pool) {}
+
+  async findById(id: string): Promise<User | null> {
+    const result = await this.db.query<User>(
+      'SELECT id, email, name FROM users WHERE id = $1',
+      [id],
+    );
+    return result.rows[0] ?? null;
+  }
+
+  async update(id: string, patch: Partial<Pick<User, 'email' | 'name'>>): Promise<void> {
+    const fields = Object.keys(patch) as Array<keyof typeof patch>;
+    if (fields.length === 0) return;
+    const setClauses = fields.map((k, i) => \`\${k} = $\${i + 2}\`).join(', ');
+    const values = [id, ...fields.map((k) => patch[k])];
+    await this.db.query(\`UPDATE users SET \${setClauses} WHERE id = $1\`, values);
+  }
+}`;

// ── Types ─────────────────────────────────────────────────────────────────────

type EvidenceLevel = 'none' | 'weak' | 'medium' | 'strong';

interface EvidenceItem {
  type: string;
  content: string;
}

interface RawFinding {
  id: string;
  title: string;
  category: string;
  dimension: string;
  severity: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  evidence: EvidenceItem[];
  whyItMatters: string;
  suggestedFix: string;
  clientRuleReferences: string[];
  falsePositiveRisk: string;
  sourceAgent: string;
  modelProvider: string;
  remediationReadiness: string;
}

interface ProcessedFinding extends RawFinding {
  confidence: number;
  verificationStatus: 'approved' | 'rejected';
  verificationReason: string;
}

// ── Pipeline replicas ─────────────────────────────────────────────────────────

// Mirrors packages/pipeline/src/evidence-scorer.ts
function scoreEvidence(finding: RawFinding, diffLines: string[]): EvidenceLevel {
  if (!finding.evidence || finding.evidence.length === 0) return 'none';
  const STRONG_MIN = 10;
  let best: EvidenceLevel = 'weak';
  for (const item of finding.evidence) {
    // Strong: verbatim diff line present in evidence content
    for (const line of diffLines) {
      if (line.length >= STRONG_MIN && item.content.includes(line)) return 'strong';
    }
    // Medium: file path reference
    if (item.content.includes(finding.file)) { best = 'medium'; continue; }
    // Medium: diff keyword
    if (/diff|hunk|line /i.test(item.content)) { best = 'medium'; continue; }
    // Medium: code ident from evidence appears in a diff line
    const idents = item.content.match(/[a-zA-Z_$][a-zA-Z0-9_$.]{3,}/g) ?? [];
    for (const ident of idents) {
      if (diffLines.some(l => l.includes(ident))) { best = 'medium'; break; }
    }
  }
  return best;
}

// Mirrors packages/pipeline/src/verifier.ts
const GENERIC_FIX_PHRASES = [
  'consider refactoring', 'could be improved', 'add tests',
  'should be refactored', 'may want to', 'might want to',
];
function verify(
  finding: RawFinding,
  diffPaths: Set<string>,
  diffLines: string[],
): { status: 'approved' | 'rejected'; reason: string } {
  if (!finding.file?.trim()) return { status: 'rejected', reason: 'file is missing or empty' };
  if (!finding.evidence?.length) return { status: 'rejected', reason: 'evidence array is empty' };
  if (diffPaths.size > 0 && !diffPaths.has(finding.file))
    return { status: 'rejected', reason: `file "${finding.file}" not found in diff` };
  const diffEvidence = finding.evidence.filter(e => e.type === 'diff');
  if (diffEvidence.length > 0 && diffLines.length > 0) {
    const anchored = diffEvidence.some(e =>
      diffLines.some(l => l.length >= 10 && e.content.includes(l)),
    );
    if (!anchored) return { status: 'rejected', reason: 'diff evidence content does not appear in diff hunks' };
  }
  const fixLower = finding.suggestedFix.toLowerCase();
  if (GENERIC_FIX_PHRASES.some(p => fixLower.includes(p)))
    return { status: 'rejected', reason: 'suggestedFix uses generic phrasing' };
  return { status: 'approved', reason: 'Heuristic checks passed.' };
}

// Mirrors packages/pipeline/src/confidence-scorer.ts
const EVIDENCE_DELTA: Record<EvidenceLevel, number> = { strong: 0.2, medium: 0.1, weak: -0.2, none: -0.4 };
function scoreConfidence(
  finding: RawFinding,
  level: EvidenceLevel,
  verificationStatus: 'approved' | 'rejected',
): number {
  let score = 0.5;
  score += EVIDENCE_DELTA[level];
  if (verificationStatus === 'approved') score += 0.1;
  if (verificationStatus === 'rejected') score -= 0.3;
  if (finding.clientRuleReferences.length > 0) score += 0.1;
  if (finding.falsePositiveRisk === 'high') score -= 0.1;
  return Math.min(1, Math.max(0, Math.round(score * 10000) / 10000));
}

// ── Comment builder (mirrors packages/cli/src/commands/review.ts) ─────────────

function buildInlineCommentBody(f: ProcessedFinding): string {
  const pct = ` · confidence: ${Math.round(f.confidence * 100)}%`;
  return [
    `### [${f.severity.toUpperCase()}] ${f.title}`,
    '',
    `**Why it matters:** ${f.whyItMatters}`,
    '',
    `**Suggested fix:**`,
    f.suggestedFix,
    '',
    `---`,
    `*Engagement Harness · agent: \`${f.sourceAgent}\`${pct}*`,
  ].join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) { console.error('ERROR: ANTHROPIC_API_KEY not set.'); process.exit(1); }

  const model = process.env['ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-20250514';
  console.log(`\nModel: ${model}`);
  console.log('Sending security agent prompt to Anthropic...\n');

  // Build prompt (mirrors SecurityAgent.promptTemplate)
  const prompt = [
    'You are the Security agent for the Engagement Harness.',
    'Dimension: security',
    'Focus: missing authorization, injection risks, unsafe crypto, secret exposure, tenant isolation, input validation.',
    '',
    'Changed files:',
    SIMULATED_DIFF_TEXT,
    '',
    FINDING_SCHEMA_BLOCK,
  ].join('\n');

  console.log('── PROMPT (first 400 chars) ────────────────────────────────────');
  console.log(prompt.slice(0, 400) + '\n…\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    console.error(`Anthropic error: HTTP ${res.status} ${res.statusText}`);
    console.error(await res.text());
    process.exit(1);
  }

  const data = await res.json() as {
    content: Array<{ type: string; text: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };
  const rawText = data.content?.[0]?.text ?? '';
  const usage = data.usage;

  console.log('── RAW LLM RESPONSE ────────────────────────────────────────────');
  console.log(rawText);
  if (usage) console.log(`\nTokens — input: ${usage.input_tokens}  output: ${usage.output_tokens}`);

  // Parse JSON array from response
  let candidates: RawFinding[] = [];
  try {
    const trimmed = rawText.trim();
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    candidates = JSON.parse(trimmed.slice(start, end + 1)) as RawFinding[];
  } catch {
    console.error('\nFailed to parse JSON.');
    process.exit(1);
  }

  console.log(`\n── RAW CANDIDATES: ${candidates.length} ────────────────────────────────────`);

  // Step 1: Override sourceAgent + modelProvider (mirrors BaseAgent.run())
  candidates = candidates.map(f => ({ ...f, sourceAgent: 'security', modelProvider: 'anthropic' }));

  // Precompute diff lines + paths for pipeline stages
  const diffLines = SIMULATED_DIFF_TEXT
    .split('\n')
    .filter(l => l.startsWith('+') && !l.startsWith('+++'))
    .map(l => l.slice(1));
  const diffPaths = new Set(['src/payments/charge.ts', 'src/routes/admin.ts', 'src/utils/range.ts', 'src/services/user-service.ts']);

  // Step 2: Run pipeline stages
  const processed: ProcessedFinding[] = [];
  const rejected: { finding: RawFinding; reason: string; stage: string }[] = [];

  for (const f of candidates) {
    const verification = verify(f, diffPaths, diffLines);
    const evidenceLevel = scoreEvidence(f, diffLines);
    const confidence = scoreConfidence(f, evidenceLevel, verification.status);

    const pf: ProcessedFinding = {
      ...f,
      confidence,
      verificationStatus: verification.status,
      verificationReason: verification.reason,
    };

    // Quality gate: confidence >= 0.6 (default threshold) and not rejected
    if (verification.status === 'rejected') {
      rejected.push({ finding: f, reason: `verifier: ${verification.reason}`, stage: 'verifier' });
      console.log(`  ✗ REJECTED [verifier]  ${f.id}: ${verification.reason}`);
    } else if (confidence < 0.6) {
      rejected.push({ finding: f, reason: `confidence ${confidence} < 0.6`, stage: 'quality-gate' });
      console.log(`  ✗ REJECTED [quality-gate]  ${f.id}: confidence ${confidence}`);
    } else {
      processed.push(pf);
      console.log(`  ✓ PUBLISHED  ${f.id}  confidence=${confidence}  evidence=${evidenceLevel}  verification=${verification.status}`);
    }
  }

  console.log(`\n── PIPELINE: ${processed.length} published / ${rejected.length} rejected ────────────────`);

  if (processed.length === 0) {
    console.log('No findings passed the pipeline. Done.');
    return;
  }

  console.log(`\n── INLINE PR COMMENTS (${processed.length}) ────────────────────────────────`);

  for (let i = 0; i < processed.length; i++) {
    const f = processed[i]!;
    const body = buildInlineCommentBody(f);

    console.log(`\n${'═'.repeat(68)}`);
    console.log(`Finding ${i + 1}/${processed.length}  [${f.severity.toUpperCase()}]`);
    console.log(`File: ${f.file}  line: ${f.lineEnd}  agent: ${f.sourceAgent}  confidence: ${Math.round(f.confidence * 100)}%`);
    console.log(`\nGitHub API payload:`);
    const payload = {
      commit_id: '<resolved HEAD sha>',
      path: f.file,
      line: f.lineEnd,
      side: 'RIGHT',
      body,
    };
    console.log(JSON.stringify(payload, null, 2).split('\n').map(l => '  ' + l).join('\n'));
    console.log(`\nRendered comment:`);
    console.log('  ' + '─'.repeat(60));
    body.split('\n').forEach(l => console.log('  ' + l));
    console.log('  ' + '─'.repeat(60));
  }

  console.log(`\n── SUMMARY ─────────────────────────────────────────────────────`);
  console.log(`${processed.length} inline comment(s)  →  POST /pulls/{n}/comments  (per finding)`);
  console.log(`1 summary comment      →  POST /issues/{n}/comments  (overall markdown report)`);
}

main().catch(err => { console.error(err); process.exit(1); });
