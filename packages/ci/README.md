# @engagement-harness/ci

GitHub PR comment posting for Engagement Harness. Posts findings as inline diff comments with embedded metadata tags and upserts a summary comment on every run.

---

## Installation

```bash
pnpm add @engagement-harness/ci
```

---

## GitHubCommenter

Posts inline review comments and a summary comment to a GitHub PR.

```typescript
import { GitHubCommenter } from '@engagement-harness/ci';

const commenter = new GitHubCommenter({
  token: process.env.GITHUB_TOKEN,
  repo: 'owner/repo',
  prNumber: 42,
  commitSha: process.env.GITHUB_SHA,
});

// Post inline comments for each published finding
await commenter.postFindings(publishedFindings, runId);

// Upsert the summary comment (creates on first run, updates on re-reviews)
await commenter.upsertSummary(pipelineResult, runMetadata, deltaResult);
```

---

## Inline Comment Format

Each finding is posted as an inline diff comment on the changed file and line. The comment body includes:

```markdown
**[severity] title**

reasoning text

<details><summary>Evidence</summary>

evidence text

</details>

<!-- eh-metadata: findingId=EH-0001 runId=run_abc123 sourceAgent=security dimension=security severity=high -->
```

The hidden `<!-- eh-metadata: ... -->` tag is parsed by `ReactionCollector` to associate developer reactions with the correct finding, agent, and run.

**Fallback:** If the finding's `lineStart` is not within the visible diff hunk (GitHub only allows inline comments on `+`/`-` lines in the diff), the comment is posted as a review-level comment attached to the file rather than a specific line.

---

## Summary Comment

The summary comment is **upserted** — created on the first run, updated on subsequent runs. It shows:

```markdown
## Engagement Harness Review

**Decision:** approved_with_warnings

### Delta
✅ Resolved (2) — fixed since last run
⚠️ Outstanding (3) — still present
🆕 New (1) — first seen this run

### Published Findings (4)
| Severity | Agent | File | Title |
|---|---|---|---|
| high | security | src/api/users.ts | SQL injection via unsanitized input |
...

### Metrics
- Confidence: 0.84 overall
- Truth verifier approval rate: 87%
```

The summary comment ID is stored in the run report so subsequent runs can find and update it.

---

## Comment Metadata Tag

Finding comments include a hidden HTML tag that enables the feedback system:

```html
<!-- eh-metadata: findingId=EH-0001 runId=run_abc123 sourceAgent=security dimension=security severity=high -->
```

Fields:
- `findingId` — unique finding identifier (e.g., `EH-0001`)
- `runId` — review run that produced this finding
- `sourceAgent` — agent ID that generated the finding
- `dimension` — finding dimension (e.g., `security`, `correctness`)
- `severity` — `low | medium | high | critical`

`ReactionCollector` in `@engagement-harness/feedback` reads these tags to associate GitHub emoji reactions with finding metadata.
