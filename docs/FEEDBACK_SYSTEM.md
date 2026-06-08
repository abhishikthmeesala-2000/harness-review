# Feedback System

Engagement Harness collects developer reactions to finding comments and uses them to calculate per-agent acceptance and false-positive rates. This creates a feedback loop that identifies which agents are producing actionable findings and which need tuning.

---

## How It Works

```
PR merged
    │
    ▼
feedback-on-merge.yml runs
    │
    ▼
ReactionCollector fetches all PR comments with eh-metadata tags
    │
    ▼
Maps reactions → FeedbackState per finding
    │
    ▼
FeedbackDeduplicator removes duplicate entries
    │
    ▼
MetricsCalculator computes per-agent rates
    │
    ▼
metrics.json committed to .engagement-harness/feedback/
```

---

## Reaction → Signal Mapping

Developers react to inline finding comments with standard GitHub emoji. Engagement Harness reads the highest-priority reaction on each comment.

| Emoji | GitHub reaction | `FeedbackState` | Meaning |
|---|---|---|---|
| 👎 | `-1` | `false_positive` | This finding is wrong |
| 👍 | `+1` | `accepted` | Valid finding — we will fix it |
| 🚀 | `rocket` | `fixed` | Already fixed in this PR or a follow-up |
| 🎉 | `hooray` | `fixed` | Already fixed |
| 😕 | `confused` | `dismissed` | Not actionable in this context |
| 👀 | `eyes` | `acknowledged` | Noted, tracking separately |
| (none) | — | `ignored` | No reaction recorded |

**Priority order** when multiple reactions exist on the same comment:
```
-1 > +1 > rocket > hooray > confused > eyes
```

The `-1` reaction always wins, which prevents a false positive from being counted as accepted just because someone also reacted with `+1`.

---

## Comment Metadata

Each finding comment posted by the CI workflow includes a hidden HTML metadata tag:

```html
<!-- eh-metadata: findingId=EH-0001 runId=run_abc123 sourceAgent=security dimension=security severity=high -->
```

The `ReactionCollector` uses this tag to associate a reaction with the correct finding, agent, and run. Comments without this tag are ignored.

---

## Collection Behavior

Reactions are collected from:
1. **Issue comments** (`GET /repos/{owner}/{repo}/issues/{pr}/comments`)
2. **Review comments** (`GET /repos/{owner}/{repo}/pulls/{pr}/comments?state=all`)

The `state=all` parameter ensures outdated (resolved) review threads are also collected — reactions on superseded diff positions are still valid feedback.

**Pagination:** 100 items per page. The collector continues until a page returns fewer than 100 items. Comment IDs are deduplicated across pages.

---

## Collection Commands

### Collect on merge (automatic)

The generated `feedback-on-merge.yml` workflow runs `feedback collect` automatically when a PR is closed and merged:

```yaml
on:
  pull_request:
    types: [closed]
jobs:
  collect-if-merged:
    if: github.event.pull_request.merged == true
```

### Collect manually

```bash
# Auto-detect repo from git remote (when run inside the target repo)
engagement-harness feedback collect

# Explicit repo and PR
engagement-harness feedback collect --repo owner/repo --pr 42

# All PRs from the last 30 days
engagement-harness feedback collect --repo owner/repo --days 30

# Since a specific date
engagement-harness feedback collect --repo owner/repo --since 2026-01-01

# Custom memory directory
engagement-harness feedback collect --repo owner/repo --memory-dir /path/to/.engagement-harness/feedback
```

Requires `GITHUB_TOKEN` environment variable with `pull-requests:read` permission.

### Import feedback from a file

```bash
engagement-harness feedback import feedback-export.json
```

Imports a JSON file containing `FeedbackItem[]`. Useful for bulk imports from external systems or migrating historical data.

---

## Metrics

After collection, `metrics.json` is written to `.engagement-harness/feedback/metrics.json`:

```json
{
  "lastUpdated": "2026-06-08T14:30:00Z",
  "totalEntries": 247,
  "byState": {
    "accepted": 148,
    "false_positive": 52,
    "fixed": 31,
    "dismissed": 12,
    "acknowledged": 4
  },
  "byAgent": {
    "security": {
      "totalFindings": 89,
      "feedback": {
        "accepted": 71,
        "false_positive": 9,
        "fixed": 6,
        "dismissed": 3
      },
      "acceptanceRate": 0.798,
      "falsePositiveRate": 0.101
    },
    "reviewer": {
      "totalFindings": 64,
      "feedback": { ... },
      "acceptanceRate": 0.734,
      "falsePositiveRate": 0.141
    }
  },
  "entries": [...]
}
```

### Key metrics

| Metric | Formula | Good value |
|---|---|---|
| `acceptanceRate` | `accepted / (total with feedback)` | > 0.7 |
| `falsePositiveRate` | `false_positive / (total with feedback)` | < 0.2 |

When `falsePositiveRate` exceeds 0.2 for an agent, the system recommends tightening that agent's prompt or lowering its confidence via the `CONSERVATIVE_FINDING_BLOCK`.

---

## Viewing Metrics

```bash
# Human-readable report
engagement-harness feedback report

# JSON format (for tooling)
engagement-harness feedback report --format json

# Executive summary for pilot program
engagement-harness feedback pilot-report --days 30
```

The pilot report includes:
- Total PRs reviewed
- Total findings published
- Per-agent acceptance and false-positive rates
- Agents that need tuning (FP rate > 20%)
- Trend over the specified time window

---

## Tuning Based on Feedback

If an agent has a high false-positive rate:

1. Run `engagement-harness feedback report` to identify the worst-offending agent
2. Review `entries` in `metrics.json` to find common patterns in rejected findings
3. Add a suppression rule to `CONSERVATIVE_FINDING_BLOCK` in the agent's system prompt, or add a domain rule to `.engagement-harness/rules/` that explicitly excludes the pattern
4. Lower `review.confidenceThreshold` to require stronger evidence before publishing
5. Re-review a recent PR with the updated configuration and compare results
