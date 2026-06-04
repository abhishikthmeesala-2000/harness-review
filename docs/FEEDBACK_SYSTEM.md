# Feedback System

Engagement Harness collects developer reactions to finding comments and uses them to calculate per-agent acceptance and false-positive rates. This creates a feedback loop that helps you identify which agents are producing actionable findings and which need tuning.

---

## How It Works End-to-End

```
1. engagement-harness review posts finding as a GitHub PR comment
   Comment body contains a hidden metadata tag:
   <!-- eh-metadata: findingId=EH-0001 runId=run-1748304000 sourceAgent=security dimension=security severity=critical -->

2. Developer reacts to the comment with an emoji
   (👍 👎 🚀 😕 👀)

3. On PR merge, the feedback-on-merge workflow runs:
   engagement-harness feedback collect --repo owner/repo --pr <PR_NUMBER>

4. ReactionCollector calls the GitHub API:
   - GET /repos/{owner}/{repo}/issues/{pr_number}/comments
   - Filters comments containing <!-- eh-metadata: ...
   - Extracts findingId, runId, sourceAgent from each tag
   - GET /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions
   - Maps reaction content to FeedbackState

5. Collected FeedbackItem[] is deduplicated and merged into
   .engagement-harness/feedback/metrics.json

6. MetricsCalculator aggregates per-agent acceptance and FP rates
```

---

## Reaction Emoji Mapping

| Emoji | GitHub `content` value | `FeedbackState` | Meaning |
|---|---|---|---|
| 👍 | `+1` | `accepted` | Finding is valid; developer will fix it |
| 👎 | `-1` | `false_positive` | Finding is incorrect; should not have been raised |
| 🚀 | `rocket` | `fixed` | Finding was already addressed |
| 😕 | `confused` | `dismissed` | Finding is technically valid but not a priority |
| *(none)* | — | `ignored` | No reaction; not included in metrics |

**Priority order for deduplication:** When a comment has multiple reactions, the state with the highest priority wins: `false_positive` > `accepted` > `fixed` > `dismissed` > `acknowledged` > `ignored`.

---

## Collection Triggers

### On PR Merge (`feedback-on-merge.yml`)

Runs automatically when a pull request is closed and merged:

```yaml
on:
  pull_request:
    types: [closed]
```

Collects reactions from the specific merged PR. This is the primary collection path — reactions are most meaningful when the PR is complete and the team has had time to react.

### Weekly Scheduled Sweep (`collect-feedback.yml`)

Runs on a configurable schedule (default: Mondays at 9 AM UTC) to sweep the last 7 days of PRs. This catches reactions added after merge.

Set the schedule in `config.json`:
```json
{
  "feedback": {
    "collectionSchedule": "0 9 * * 1"
  }
}
```

---

## CLI Commands

### Collect reactions manually

```bash
# Collect reactions from the last 7 days of PRs
engagement-harness feedback collect --repo owner/repo

# Collect reactions from a specific PR
engagement-harness feedback collect --repo owner/repo --pr 42

# Collect reactions from the last 30 days
engagement-harness feedback collect --repo owner/repo --days 30

# Collect and write a Claude memory file
engagement-harness feedback collect --repo owner/repo --memory-dir ~/.claude/memory
```

Requires `GITHUB_TOKEN` environment variable with `read:discussion` permission on the repository.

### Print a feedback report

```bash
# Human-readable text report
engagement-harness feedback report

# JSON output for scripting
engagement-harness feedback report --format json
```

### Import feedback from a file

```bash
engagement-harness feedback import /path/to/feedback.json
```

The import file should contain a `FeedbackEntry` or array of `FeedbackEntry` objects:

```json
[
  {
    "findingId": "EH-0001",
    "runId": "run-1748304000",
    "state": "accepted",
    "timestamp": "2025-09-01T10:00:00.000Z"
  }
]
```

Valid `state` values: `accepted`, `false_positive`, `fixed`, `dismissed`, `acknowledged`, `ignored`.

---

## `metrics.json` Structure

Stored at `.engagement-harness/feedback/metrics.json`:

```json
{
  "lastUpdated": "2025-09-01T10:00:00.000Z",
  "totalEntries": 47,
  "byState": {
    "accepted": 28,
    "false_positive": 6,
    "fixed": 8,
    "dismissed": 5
  },
  "byAgent": {
    "security": {
      "totalFindings": 15,
      "feedback": {
        "accepted": 12,
        "false_positive": 1,
        "dismissed": 2
      },
      "acceptanceRate": 0.8,
      "falsePositiveRate": 0.067
    },
    "reviewer": {
      "totalFindings": 12,
      "feedback": {
        "accepted": 7,
        "false_positive": 3,
        "dismissed": 2
      },
      "acceptanceRate": 0.583,
      "falsePositiveRate": 0.25
    }
  },
  "entries": [...]
}
```

### Key Metrics

| Metric | Formula | Target |
|---|---|---|
| `acceptanceRate` | `accepted / (accepted + false_positive + dismissed)` | > 0.7 |
| `falsePositiveRate` | `false_positive / totalFindings` | < 0.15 |

---

## Interpreting Metrics

**High false-positive rate (> 0.3) for an agent:**
- The agent's confidence threshold may be too low — raise `review.confidenceThreshold`
- The agent may be flagging patterns your team accepts intentionally — add a rule or exception
- Check `review.severityThreshold` — filtering out `low` severity often reduces noise

**Low acceptance rate for `domain-policy`:**
- Rule files may be too broad in their glob patterns
- Rules may describe aspirational rather than enforced standards — narrow or remove them

**High acceptance rate for `security`:**
- Consider enabling CI blocking: `ci.blockOnPolicy: true`
- Consider lowering the confidence threshold for security agent only

**No feedback collected:**
- Verify `ci.postComments: true` in config
- Verify the `GITHUB_TOKEN` secret is set in the CI workflow with comment write permissions
- Confirm `alm.platform: "github"` is set
