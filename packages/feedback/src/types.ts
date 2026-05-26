export type FeedbackState =
  | 'accepted'
  | 'false_positive'
  | 'fixed'
  | 'dismissed'
  | 'acknowledged'
  | 'ignored';

export interface ReactionCounts {
  '+1': number;
  '-1': number;
  laugh: number;
  confused: number;
  heart: number;
  hooray: number;
  rocket: number;
  eyes: number;
}

export interface FeedbackItem {
  findingId: string;
  runId: string;
  state: FeedbackState;
  prNumber: number;
  repository: string;
  commentId: number;
  reactions: ReactionCounts;
  timestamp: string;
  respondent?: string;
  metadata?: {
    sourceAgent?: string;
    dimension?: string;
    severity?: string;
  };
}

export interface AgentMetrics {
  totalFindings: number;
  feedback: Partial<Record<FeedbackState, number>>;
  acceptanceRate: number;
  falsePositiveRate: number;
}

export interface FeedbackMetrics {
  lastUpdated: string;
  totalEntries: number;
  byState: Partial<Record<FeedbackState, number>>;
  byAgent: Record<string, AgentMetrics>;
  entries: FeedbackItem[];
}

export interface CollectionResult {
  collected: FeedbackItem[];
  prNumbers: number[];
}
