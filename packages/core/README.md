# @engagement-harness/core

Foundation layer for Engagement Harness. Provides Zod schemas, config loading, repo profiling, diff parsing, context building, secret redaction, and the ALM adapter interface.

---

## Installation

```bash
pnpm add @engagement-harness/core
```

This package has no dependencies on other `@engagement-harness/*` packages. All other packages depend on it.

---

## Key Exports

### Config

```typescript
import { loadConfig, ConfigSchema, defaultConfig } from '@engagement-harness/core';

// Load and validate config.json from .engagement-harness/config.json
const config = await loadConfig('/path/to/repo');

// Get the full Zod schema (for validation, type inference)
type Config = z.infer<typeof ConfigSchema>;

// Generate a default config (all 9 agents on mock, anthropic model set)
const defaults = defaultConfig();
```

**Config shape** (all fields are optional except `client.name` and `client.engagement`):

```typescript
interface Config {
  client: { name: string; engagement: string };
  review: {
    confidenceThreshold: number;         // 0–1, default: 0.8
    severityThreshold: Severity;         // default: 'low'
    requireVerifierApproval: boolean;    // default: true
  };
  agents: { enabled: string[] };
  models: Record<string, string>;
  providers: {
    mock?: {};
    anthropic?: { model: string; maxTokens?: number; temperature?: number };
    openai?: { model: string; maxTokens?: number; temperature?: number };
  };
  context: { ignoredPaths: string[]; maxFiles: number; maxTokens: number };
  ci: { blockOnPolicy: boolean; postComments: boolean; artifactsOnly: boolean };
  alm: { platform: 'github' | 'gitlab' | 'azure-devops' | 'bitbucket' | 'none' };
  feedback: { enabled: boolean; autoCollect: boolean; retentionDays?: number };
  reports: { formats: ReportFormat[]; outputDir: string };
}
```

---

### ContextEngine

Builds the `ContextBundle` passed to agents. Runs git diff, resolves imports, strips secrets.

```typescript
import { ContextEngine } from '@engagement-harness/core';

const engine = new ContextEngine({ repoPath: '/path/to/repo', config });
const bundle = await engine.build({ baseRef: 'main', headRef: 'HEAD' });
```

**`ContextBundle` shape:**

```typescript
interface ContextBundle {
  changedFiles: ChangedFile[];     // files with diff hunks
  importedContext: ImportedFile[]; // imports/exports from changed files
  testFiles: string[];             // test file paths co-located with changes
  ruleFiles: RuleFile[];           // .engagement-harness/rules/*.md content
  prMetadata?: {                   // present only in CI mode
    title: string;
    body: string;
    number: number;
  };
  repoProfile: RepoProfile;        // language, framework, test runner detection
}
```

---

### SecretRedactor

Strips secrets from context before it reaches agents or providers.

```typescript
import { SecretRedactor } from '@engagement-harness/core';

const redactor = new SecretRedactor();
const safeContent = redactor.redact(rawDiffContent);
```

Redacts: API keys, connection strings with passwords, PEM private key blocks, high-entropy strings adjacent to known key names.

---

### Finding Schemas

```typescript
import {
  CandidateFindingSchema,
  FindingSchema,
  FindingSeverity,
  FindingCategory,
} from '@engagement-harness/core';

type CandidateFinding = z.infer<typeof CandidateFindingSchema>;
type Finding = z.infer<typeof FindingSchema>;
type Severity = 'low' | 'medium' | 'high' | 'critical';
```

---

### ALM Adapter

```typescript
import { createAlmAdapter } from '@engagement-harness/core';

const alm = createAlmAdapter(config.alm.platform, {
  token: process.env.GITHUB_TOKEN,
  repo: 'owner/repo',
  prNumber: 42,
});
```

Supported platforms: `github`, `gitlab`, `azure-devops`, `bitbucket`, `none`.

---

## Source Layout

```
src/
├── schemas/          CandidateFindingSchema, FindingSchema, ConfigSchema
├── config/           loadConfig(), defaultConfig(), config-schema
├── context/          ContextEngine, ContextBundle, ChangedFile types
├── profile/          RepoProfile detection (language, framework, test runner)
├── redaction/        SecretRedactor
└── alm/              ALM adapter interface and platform implementations
```
