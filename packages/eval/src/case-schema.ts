import { FindingCategorySchema, FindingSeveritySchema, PolicyDecisionSchema } from '@engagement-harness/core';
import { z } from 'zod';

export const ExpectedFindingSchema = z.object({
  /** Maps to Finding.category (same value as dimension). */
  category: FindingCategorySchema,
  severity: FindingSeveritySchema.optional(),
  /** micromatch glob pattern matched against Finding.file. Use "**" to match any file. */
  fileGlob: z.string().min(1),
  /** Case-insensitive substrings that must appear in the finding title or evidence content. */
  mustMatchPhrases: z.array(z.string()),
});

/**
 * Optional extension: inject rule content into the context bundle for eval cases
 * that test domain-policy agents without a full fixture repo containing rules files.
 * Not in the canonical master-prompt spec but needed for diff.patch-based eval cases.
 */
export const ContextRuleSchema = z.object({
  path: z.string().min(1),
  content: z.string().min(1),
});

export const EvalCaseSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  /**
   * Path to the fixture repo (or case dir containing diff.patch), relative to the
   * eval-cases directory. Use "." for cases where diff.patch lives in the same dir.
   */
  fixtureRepoPath: z.string().min(1),
  /** Git ref used as base for diff (informational when diff.patch is present). */
  baseRef: z.string().min(1),
  /** Git ref used as head for diff (informational when diff.patch is present). */
  headRef: z.string().min(1),
  prTitle: z.string(),
  prBody: z.string(),
  expectedFindings: z.array(ExpectedFindingSchema),
  expectedDecision: PolicyDecisionSchema,
  maxFalsePositives: z.number().int().min(0).default(1),
  /** Extension: inject rule entries into context bundle. */
  contextRules: z.array(ContextRuleSchema).optional(),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type ExpectedFinding = z.infer<typeof ExpectedFindingSchema>;
export type ContextRule = z.infer<typeof ContextRuleSchema>;
