import { z } from 'zod';

export const RemediationOutputSchema = z.object({
  findingId: z.string().min(1),
  file: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  before: z.string(),
  after: z.string(),
  explanation: z.string().min(1),
  test: z.string().min(1),
  riskLevel: z.enum(['low', 'medium', 'high']),
  effort: z.enum(['minutes', 'hours', 'days']),
  librariesNeeded: z.array(z.string()).default([]),
  additionalFiles: z
    .array(z.object({ file: z.string(), before: z.string(), after: z.string() }))
    .default([]),
});

export type RemediationOutput = z.infer<typeof RemediationOutputSchema>;
