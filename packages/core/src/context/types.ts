import type { FileDiff } from '../git/diff-parser.js';
import type { RepoProfile } from '../profile/profiler.js';

export type ContextEntryKind = 'changed-file' | 'imported-by' | 'imports' | 'test' | 'rule';

export interface ContextEntry {
  path: string;
  content: string;
  reason: string;
  priority: number;
  kind: ContextEntryKind;
}

export interface PrMetadata {
  title?: string;
  body?: string;
}

export interface ContextBundle {
  entries: ContextEntry[];
  diff: FileDiff[];
  repoProfile: RepoProfile;
  prMetadata?: PrMetadata;
}
