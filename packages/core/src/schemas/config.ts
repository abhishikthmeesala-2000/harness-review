import { z } from 'zod';

const SeverityLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

const ReportFormatSchema = z.enum(['json', 'markdown', 'html']);

const AlmPlatformSchema = z.enum(['github', 'gitlab', 'azure-devops', 'bitbucket', 'none']);

export const ConfigSchema = z
  .object({
    client: z.object({
      name: z.string().min(1, { message: 'client.name is required' }),
      engagement: z.string().min(1, { message: 'client.engagement is required' }),
    }),
    review: z
      .object({
        confidenceThreshold: z
          .number()
          .min(0, { message: 'review.confidenceThreshold must be between 0 and 1' })
          .max(1, { message: 'review.confidenceThreshold must be between 0 and 1' })
          .default(0.8),
        severityThreshold: SeverityLevelSchema.default('low'),
        requireVerifierApproval: z.boolean().default(true),
      })
      .default({
        confidenceThreshold: 0.8,
        severityThreshold: 'low',
        requireVerifierApproval: true,
      }),
    agents: z
      .object({
        enabled: z.array(z.string().min(1)).default([]),
      })
      .default({ enabled: [] }),
    models: z.record(z.string(), z.string()).default({}),
    providers: z
      .object({
        mock: z.object({}).default({}),
        openai: z.object({ model: z.string().min(1) }).optional(),
        anthropic: z.object({ model: z.string().min(1) }).optional(),
      })
      .default({ mock: {} }),
    context: z
      .object({
        ignoredPaths: z.array(z.string()).default([]),
        maxFiles: z
          .number()
          .int({ message: 'context.maxFiles must be an integer' })
          .positive({ message: 'context.maxFiles must be a positive integer' })
          .default(30),
        maxTokens: z
          .number()
          .int({ message: 'context.maxTokens must be an integer' })
          .positive({ message: 'context.maxTokens must be a positive integer' })
          .default(80000),
      })
      .default({ ignoredPaths: [], maxFiles: 30, maxTokens: 80000 }),
    ci: z
      .object({
        blockOnPolicy: z.boolean().default(false),
        postComments: z.boolean().default(true),
        artifactsOnly: z.boolean().default(true),
      })
      .default({ blockOnPolicy: false, postComments: true, artifactsOnly: true }),
    alm: z
      .object({
        platform: AlmPlatformSchema.default('none'),
      })
      .default({ platform: 'none' }),
    feedback: z
      .object({
        enabled: z.boolean().default(true),
        autoCollect: z.boolean().default(false),
        collectionSchedule: z.string().optional(),
        retentionDays: z.number().int().positive().optional(),
      })
      .default({ enabled: true, autoCollect: false }),
    reports: z
      .object({
        formats: z
          .array(ReportFormatSchema)
          .min(1, { message: 'reports.formats must include at least one format' })
          .default(['json', 'markdown', 'html']),
        outputDir: z
          .string()
          .min(1, { message: 'reports.outputDir is required' })
          .default('.engagement-harness/reports'),
      })
      .default({
        formats: ['json', 'markdown', 'html'],
        outputDir: '.engagement-harness/reports',
      }),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;
export type SeverityLevel = z.infer<typeof SeverityLevelSchema>;
export type ReportFormat = z.infer<typeof ReportFormatSchema>;
export type AlmPlatform = z.infer<typeof AlmPlatformSchema>;

export const DEFAULT_AGENT_IDS = [
  'reviewer',
  'security',
  'domain-policy',
  'testing',
  'data-architecture',
  'sre-observability',
  'design-principles',
  'pr-intent-gap',
  'remediation',
] as const;

export function defaultConfig(client: { name: string; engagement: string }): Config {
  return ConfigSchema.parse({
    client,
    agents: { enabled: [...DEFAULT_AGENT_IDS] },
    models: Object.fromEntries(DEFAULT_AGENT_IDS.map((id) => [id, 'anthropic'])),
    providers: {
      mock: {},
      anthropic: { model: 'claude-sonnet-4-6' },
    },
  });
}
