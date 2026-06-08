# @engagement-harness/feedback

Feedback collection and metrics for Engagement Harness. Polls GitHub PR comment reactions, maps emoji to feedback states, deduplicates entries, and aggregates per-agent acceptance and false-positive rates.

---

## Installation

```bash
pnpm add @engagement-harness/feedback
```

---

## Core Types

```typescript
type FeedbackState =
  | 'accepted'       // 👍 developer will fix it
  | 'false_positive' // 👎 finding is wrong
  | 'fixed'          // 🚀 🎉 already fixed
  | 'dismissed'      // 😕 not actionable here
  | 'acknowledged'   // 👀 noted, tracking separately
  | 'ignored';       // no reaction recorded

interface FeedbackItem {
  findingId: string;
  runId: string;
  state: FeedbackState;
  prNumber: number;
  repository: string;
  commentId: number;
  reactions: ReactionCounts;
  timestamp: string;            // ISO 8601
  respondent?: string;
  metadata?: {
    sourceAgent?: string;
    dimension?: string;
    severity?: string;
  };
}
```

---

## Reaction → State Mapping

| Emoji | GitHub reaction | State | Priority |
|---|---|---|---|
| 👎 | `-1` | `false_positive` | 1 (highest) |
| 👍 | `+1` | `accepted` | 2 |
| 🚀 | `rocket` | `fixed` | 3 |
| 🎉 | `hooray` | `fixed` | 4 |
| 😕 | `confused` | `dismissed` | 5 |
| 👀 | `eyes` | `acknowledged` | 6 |

When multiple reactions exist on a comment, the highest-priority one wins. `-1` always takes precedence.

---

## ReactionCollector

Fetches reactions from GitHub PR comments that have `<!-- eh-metadata: ... -->` tags.

```typescript
import { ReactionCollector } from '@engagement-harness/feedback';

const collector = new ReactionCollector({
  token: process.env.GITHUB_TOKEN,
  repo: 'owner/repo',
});

// Collect reactions for a specific PR
const items = await collector.collectPr(42);

// Collect reactions for all PRs in the last N days
const items = await collector.collectRecent({ days: 30 });
```

Collection reads from:
- Issue comments: `GET /repos/{owner}/{repo}/issues/{pr}/comments`
- Review comments: `GET /repos/{owner}/{repo}/pulls/{pr}/comments?state=all` (includes resolved threads)

Pagination: 100 items per page, continues until a page returns < 100 items. Comment IDs are deduplicated across pages.

---

## FeedbackStore

Persists `FeedbackItem[]` to disk.

```typescript
import { FeedbackStore } from '@engagement-harness/feedback';

const store = new FeedbackStore({ path: '.engagement-harness/feedback/metrics.json' });

await store.append(newItems);
const all = await store.readAll();
```

---

## MetricsCalculator

Computes per-agent acceptance and false-positive rates.

```typescript
import { MetricsCalculator } from '@engagement-harness/feedback';

const calc = new MetricsCalculator();
const metrics = calc.compute(feedbackItems);

// metrics.byAgent['security'].acceptanceRate → 0.798
// metrics.byAgent['security'].falsePositiveRate → 0.101
```

**Metrics shape:**

```typescript
interface FeedbackMetrics {
  lastUpdated: string;
  totalEntries: number;
  byState: Partial<Record<FeedbackState, number>>;
  byAgent: Record<string, AgentMetrics>;
  entries: FeedbackItem[];
}

interface AgentMetrics {
  totalFindings: number;
  feedback: Partial<Record<FeedbackState, number>>;
  acceptanceRate: number;
  falsePositiveRate: number;
}
```

---

## FeedbackDeduplicator

Prevents duplicate entries when collecting from overlapping time windows.

```typescript
import { FeedbackDeduplicator } from '@engagement-harness/feedback';

const dedup = new FeedbackDeduplicator();
const unique = dedup.deduplicate([...existingItems, ...newItems]);
```

Deduplicates by `commentId` — each PR comment produces at most one feedback entry.
