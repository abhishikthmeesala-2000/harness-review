import { PolicyDecisionSchema } from '@engagement-harness/core';
import { z } from 'zod';

export const ExpectedFindingSchema = z.object({
  dimension: z.string().min(1),
  file: z.string().optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});

export const ContextRuleSchema = z.object({
  path: z.string().min(1),
  content: z.string().min(1),
});

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  expectedFindings: z.array(ExpectedFindingSchema).optional(),
  expectedDecision: PolicyDecisionSchema.optional(),
  maxFalsePositives: z.number().int().min(0).optional(),
  contextRules: z.array(ContextRuleSchema).optional(),
  fileGlob: z.string().optional(),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type ExpectedFinding = z.infer<typeof ExpectedFindingSchema>;
export type ContextRule = z.infer<typeof ContextRuleSchema>;
