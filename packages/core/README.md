# @engagement-harness/core

Foundation layer for Engagement Harness. Provides Zod schemas, config loading, repo profiling, diff parsing, context building, secret redaction, and the ALM adapter interface.

---

## Key Modules

| Module | Path | Purpose |
|---|---|---|
| Schemas | `src/schemas/` | Zod definitions for `Config`, `Finding`, `CandidateFinding`, `PolicyDecision` |
| ConfigLoader | `src/config/loader.ts` | Read/validate/write `.engagement-harness/config.json` |
| RepoProfiler | `src/profile/profiler.ts` | Detect language, framework, test framework, CI provider |
| GitDiffParser | `src/git/diff-parser.ts` | Parse unified diff into `FileDiff[]` via simple-git |
| ContextEngine | `src/context/engine.ts` | Build `ContextBundle` from diff + repo file content |
| SecretRedactor | `src/redaction/redactor.ts` | Strip secrets from bundles before agent prompts |
| ALM interface | `src/alm/` | `AlmAdapter` interface + GitHub/GitLab/Azure/Bitbucket/none implementations |

---

## Key Exported Types

```typescript
// Config schema
export type Config = z.infer<typeof ConfigSchema>;
export type SeverityLevel = 'low' | 'medium' | 'high' | 'critical';
export type AlmPlatform = 'github' | 'gitlab' | 'azure-devops' | 'bitbucket' | 'none';
export const DEFAULT_AGENT_IDS: readonly string[];
export function defaultConfig(client: { name: string; engagement: string }): Config;

// Findings
export type FindingCategory = 'correctness' | 'security' | 'testing' | 'domain-policy' | 'design' | 'data' | 'observability' | 'intent-gap';
export type FindingSeverity = 'low' | 'medium' | 'high' | 'critical';
export type FalsePositiveRisk = 'low' | 'medium' | 'high';
export type VerificationStatus = 'approved' | 'rejected' | 'pending';
export interface Finding { /* ... */ }
export interface CandidateFinding { /* ... */ }

// Context
export interface ContextBundle {
  entries: ContextEntry[];
  diff: FileDiff[];
  repoProfile: RepoProfile;
  prMetadata?: PrMetadata;
  runMetadata: RunMetadata;
}
export interface ContextEntry {
  path: string;
  content: string;
  reason: string;
  priority: number;
  kind: 'changed-file' | 'imported-by' | 'imports' | 'test' | 'rule';
}

// Diff
export interface FileDiff {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'binary';
  hunks: DiffHunk[];
}

// ALM
export abstract class AlmAdapter {
  abstract postSummary(prRef: PrRef, markdown: string): Promise<void>;
  abstract postInlineComment(prRef: PrRef, commitSha: string, file: string, line: number, body: string): Promise<void>;
  abstract updateCheckStatus(prRef: PrRef, status: string, summary: string): Promise<void>;
}
```

---

## Usage

```typescript
import { ConfigLoader, ContextEngine, SecretRedactor } from '@engagement-harness/core';

// Load config
const loader = new ConfigLoader('/path/to/repo');
const config = await loader.load();

// Build context bundle
const engine = new ContextEngine('/path/to/repo');
const bundle = await engine.build(diff, config, runMetadata, prMetadata);

// Redact secrets
const redactor = new SecretRedactor();
const safeBundle = redactor.redactBundle(bundle);
```

---

## Dependencies

- `zod` — schema validation
- `simple-git` — git diff and log operations
- `micromatch` — glob pattern matching for `ignoredPaths` and rule file frontmatter
