import type { RepoProfile } from '@engagement-harness/core';

export interface RunMetadata {
  runId: string;
  timestamp: string;
  baseRef: string;
  headRef: string;
  repoProfile: RepoProfile;
  agentsRun: string[];
  providersUsed: string[];
}
