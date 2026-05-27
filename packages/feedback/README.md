# @engagement-harness/feedback

Feedback collection and metrics for Engagement Harness. Polls GitHub PR comment reactions, maps emoji to feedback states, deduplicates, and aggregates per-agent acceptance and false-positive rates.

---

## Key Modules

| File | Purpose |
|---|---|
| `src/types.ts` | `FeedbackItem`, `FeedbackMetrics`, `AgentMetrics`, `ReactionCounts`, `FeedbackState` |
| `src/reaction-collector.ts` | `ReactionCollector` — polls GitHub API for reactions on EH-tagged comments |
| `src/feedback-store.ts` | `FeedbackStore` — reads/writes `.engagement-harness/feedback/metrics.json` |
| `src/metrics-calculator.ts` | `MetricsCalculator` — aggregates `FeedbackItem[]` into per-agent rates |
| `src/feedback-deduplicator.ts` | `FeedbackDeduplicator` — priority-based dedup |
| `src/claude-memory-exporter.ts` | `ClaudeMemoryExporter` — exports metrics in Claude memory format |

---

## Key Exported Types

```typescript
export type FeedbackState =
  | 'accepted'
  | 'false_positive'
  | 'fixed'
  | 'dismissed'
  | 'acknowledged'
  | 'ignored';

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

export interface FeedbackMetrics {
  lastUpdated: string;
  totalEntries: number;
  byState: Partial<Record<FeedbackState, number>>;
  byAgent: Record<string, AgentMetrics>;
  entries: FeedbackItem[];
}

export interface AgentMetrics {
  totalFindings: number;
  feedback: Partial<Record<FeedbackState, number>>;
  acceptanceRate: number;
  falsePositiveRate: number;
}

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
```

---

## Reaction to FeedbackState Mapping

| Emoji | GitHub content | FeedbackState |
|---|---|---|
| 👍 | `+1` | `accepted` |
| 👎 | `-1` | `false_positive` |
| 🚀 | `rocket` | `fixed` |
| 🎉 | `hooray` | `fixed` |
| 😕 | `confused` | `dismissed` |
| 👀 | `eyes` | `acknowledged` |

Priority order for deduplication: `false_positive > accepted > fixed > dismissed > acknowledged > ignored`

---

## Usage

```typescript
import { ReactionCollector } from '@engagement-harness/feedback';

const collector = new ReactionCollector({
  token: process.env.GITHUB_TOKEN!,
  owner: 'my-org',
  repo: 'my-repo',
});

// Collect from last 7 days
const result = await collector.collect(7);

// Collect from a specific PR
const result = await collector.collectFromSinglePR(42);

console.log(result.collected); // FeedbackItem[]
```

---

## Dependencies

This package has no workspace dependencies. It uses the native `fetch` API (Node.js ≥ 18) for GitHub API calls.
