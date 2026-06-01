import { z } from 'zod';

export const FindingCategorySchema = z.enum([
  'correctness',
  'security',
  'testing',
  'domain-policy',
  'design',
  'data',
  'observability',
  'intent-gap',
]);

export const FindingSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);

export const FalsePositiveRiskSchema = z.enum(['low', 'medium', 'high']);

export const RemediationReadinessSchema = z.enum(['ready', 'needs-context', 'manual-only']);

export const VerificationStatusSchema = z.enum(['approved', 'rejected', 'pending']);

export const EvidenceItemSchema = z
  .object({
    type: z.enum(['diff', 'context', 'rule']),
    content: z.string().min(1, { message: 'evidence.content must not be empty' }),
  })
  .strict();

export const VerificationSchema = z
  .object({
    status: VerificationStatusSchema,
    reason: z.string(),
  })
  .strict();

const baseFindingShape = {
  id: z.string().min(1, { message: 'id is required' }),
  title: z
    .string()
    .min(1, { message: 'title is required' })
    .max(120, { message: 'title must be at most 120 characters' }),
  category: FindingCategorySchema,
  dimension: z.string().min(1, { message: 'dimension is required' }),
  severity: FindingSeveritySchema,
  file: z.string().min(1, { message: 'file is required' }),
  lineStart: z.number().int().positive({ message: 'lineStart must be a positive integer' }),
  lineEnd: z.number().int().positive({ message: 'lineEnd must be a positive integer' }),
  evidence: z
    .array(EvidenceItemSchema)
    .min(1, { message: 'evidence must contain at least one entry' }),
  whyItMatters: z.string().min(1, { message: 'whyItMatters is required' }),
  suggestedFix: z.string().min(1, { message: 'suggestedFix is required' }),
  clientRuleReferences: z.array(z.string()).default([]),
  falsePositiveRisk: FalsePositiveRiskSchema,
  sourceAgent: z.string().min(1, { message: 'sourceAgent is required' }),
  modelProvider: z.string().min(1, { message: 'modelProvider is required' }),
  remediationReadiness: RemediationReadinessSchema,
  // Which review pass produced this finding: 'local' (per-file) or 'integration' (cross-file).
  pass: z.enum(['local', 'integration']).optional(),
  // For cross-file findings: all files involved in the issue (must have >= 2 entries).
  filesInvolved: z.array(z.string()).optional(),
  // Stable cross-run identity assigned by the FindingTracker.
  fingerprint: z.string().optional(),
  metadata: z
    .object({
      runId: z.string().optional(),
      prNumber: z.number().int().positive().optional(),
      repository: z.string().optional(),
      timestamp: z.string().optional(),
      commentId: z.number().int().positive().optional(),
    })
    .optional(),
};

export const FindingSchema = z
  .object({
    ...baseFindingShape,
    confidence: z
      .number()
      .min(0, { message: 'confidence must be between 0 and 1' })
      .max(1, { message: 'confidence must be between 0 and 1' }),
    verification: VerificationSchema,
  })
  .strict()
  .refine((f) => f.lineEnd >= f.lineStart, {
    message: 'lineEnd must be >= lineStart',
    path: ['lineEnd'],
  });

export const CandidateFindingSchema = z
  .object({
    ...baseFindingShape,
    confidence: z
      .number()
      .min(0, { message: 'confidence must be between 0 and 1' })
      .max(1, { message: 'confidence must be between 0 and 1' })
      .optional(),
    verification: VerificationSchema.default({ status: 'pending', reason: '' }),
  })
  .strict()
  .refine((f) => f.lineEnd >= f.lineStart, {
    message: 'lineEnd must be >= lineStart',
    path: ['lineEnd'],
  });

export type Finding = z.infer<typeof FindingSchema>;
export type CandidateFinding = z.infer<typeof CandidateFindingSchema>;
export type FindingCategory = z.infer<typeof FindingCategorySchema>;
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;
export type Evidence = z.infer<typeof EvidenceItemSchema>;
export type Verification = z.infer<typeof VerificationSchema>;
