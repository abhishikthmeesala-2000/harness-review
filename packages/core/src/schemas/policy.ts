import { z } from 'zod';

export const PolicyDecisionSchema = z.enum([
  'approved',
  'approved_with_warnings',
  'needs_manual_review',
  'blocked_by_policy',
]);

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
