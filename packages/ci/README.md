# @engagement-harness/ci

GitHub PR comment posting for Engagement Harness. Posts findings as issue comments with embedded metadata tags for reaction-based feedback collection.

---

## Key Modules

| File | Purpose |
|---|---|
| `src/github-commenter.ts` | `GitHubCommenter` — formats and posts findings as PR issue comments |

---

## Key Exported Classes

```typescript
export interface GitHubCommenterOptions {
  token: string;
  owner: string;
  repo: string;
  runId: string;
}

export class GitHubCommenter {
  constructor(options: GitHubCommenterOptions);

  // Post all findings as individual PR comments
  async postFindings(findings: Finding[], prNumber: number): Promise<void>;

  // Format a single finding as a comment body (exposed for testing)
  formatComment(finding: Finding): string;
}
```

---

## Comment Format

Each finding produces a comment with this structure:

```markdown
### [HIGH] Missing authorization check on /admin route

**Why it matters:** Any authenticated user can access admin-only endpoints.

**Suggested fix:**
Add `requireRole('admin')` middleware before the route handler.

---
*Engagement Harness · agent: `security` · confidence: 87%*

---
**React to provide feedback:**
👍 Accepted (will fix) | 👎 False positive | 🚀 Already fixed | 😕 Dismissed

<!-- eh-metadata: findingId=EH-0001 runId=run-1748304000 sourceAgent=security dimension=security severity=high -->
```

The `<!-- eh-metadata: ... -->` tag is read by `ReactionCollector` in `@engagement-harness/feedback` to link emoji reactions back to specific findings and agents.

---

## Usage

```typescript
import { GitHubCommenter } from '@engagement-harness/ci';

const commenter = new GitHubCommenter({
  token: process.env.GITHUB_TOKEN!,
  owner: 'my-org',
  repo: 'my-repo',
  runId: 'run-1748304000',
});

await commenter.postFindings(result.published, prNumber);
```

---

## Dependencies

- `@engagement-harness/core` — `Finding` type

Uses the native `fetch` API (Node.js ≥ 18) for GitHub API calls. Requires a `GITHUB_TOKEN` with `issues: write` permission on the target repository.
