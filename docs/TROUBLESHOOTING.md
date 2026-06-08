# Troubleshooting

Solutions for every error encountered in production. Each section shows the exact symptom, the root cause, and the precise fix.

---

## Clone Authentication Errors

### `fatal: could not read Password`

**Symptom:**
```
fatal: could not read Password for 'https://github.com': No such device or address
```

**Cause:** The CI workflow uses `git clone https://github.com/...` in a non-interactive shell. Git prompts for credentials but there is no terminal to accept them.

**Fix for public repos:** Remove any token from the URL. A bare HTTPS clone works without authentication:
```yaml
- name: Clone Engagement Harness
  run: git clone https://github.com/abhishikthmeesala-2000/harness-review.git /tmp/harness
```

**Fix for private repos:** Embed a token in the URL:
```yaml
- name: Clone Engagement Harness
  run: git clone https://x-access-token:${{ secrets.HARNESS_PAT }}@github.com/abhishikthmeesala-2000/harness-review.git /tmp/harness
```

---

### Empty token in clone URL `https://@github.com`

**Symptom:**
```
fatal: repository 'https://@github.com/owner/repo.git/' not found
```

**Cause:** `${{ secrets.HARNESS_PAT }}` is empty. The clone URL becomes `https://:@github.com/...`, which GitHub rejects.

**Fix for public repos:** Remove the token from the URL entirely.

**Fix for private repos:** Set the `HARNESS_PAT` secret:
```
GitHub → Settings → Secrets and variables → Actions → Repository secrets → New repository secret
Name: HARNESS_PAT
Value: ghp_...
```

---

## pnpm Version Conflicts

### `ERR_PNPM_BAD_PM_VERSION` / Multiple versions of pnpm specified

**Symptom:**
```
Error: Multiple versions of pnpm specified:
  - version 10 in the GitHub Action config with the key "version"
  - version pnpm@10.33.2 in the package.json with the key "packageManager"
```

**Cause:** `pnpm/action-setup@v4.1.0` requires the pnpm version to be specified in exactly one place. A `version:` key in the workflow step conflicts with the `"packageManager"` field in `package.json`.

**Fix:** Remove the `version:` key from all `pnpm/action-setup` steps. The action reads the version from `package.json` automatically:

```yaml
# Before (broken)
- uses: pnpm/action-setup@v4.1.0
  with:
    version: 10

# After (correct)
- uses: pnpm/action-setup@v4.1.0
```

---

### `pnpm link --global` Fails on pnpm v11

**Symptom:**
```
[ERR_PNPM_LINK_BAD_PARAMS] You must provide a parameter. Usage: pnpm link <dir>
```

**Cause:** The no-argument form of `pnpm link --global` was removed in pnpm v11.

**Fix:** Use `npm link` from the CLI package directory:
```bash
cd packages/cli
npm link
```

---

## Zero Findings Published

### All agents on mock provider

**Symptom:** Review runs successfully, no errors, but 0 findings published.

**Check:**
```bash
engagement-harness models list
```

If every agent shows `mock`, no real AI provider is configured.

**Fix:** Export your API key and configure agents:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

In `.engagement-harness/config.json`:
```json
{
  "models": {
    "security": "anthropic",
    "reviewer": "anthropic"
  },
  "providers": {
    "anthropic": { "model": "claude-sonnet-4-6" }
  }
}
```

---

### Verifier rejecting everything

**Symptom:** Console shows many `✗ rejected` lines. `verifierApprovalRate` near 0 in the report.

**Cause:** Evidence in agent findings does not match actual diff content. The `Verifier` checks that diff-type evidence items appear verbatim in the diff hunks.

**Look for:**
```
✗ rejected: ... (verifier: diff evidence content does not appear in diff hunks)
```

**Fix:** This usually occurs with the mock provider, which patches evidence to match the diff but may fail on unusual diff shapes. Switching to a real provider resolves it. If you see this with a real provider, retry the review — this is typically a transient parsing issue.

---

### Confidence threshold too high

**Symptom:** `confidenceThreshold` is set high (e.g., 0.9) and small diffs produce no findings above the threshold.

**Fix:** Lower the threshold during a pilot:
```json
{ "review": { "confidenceThreshold": 0.2 } }
```

Raise it gradually as you collect feedback and calibrate the agents.

---

## Verifier Rejecting Real Bugs

### "Tests exist" used to reject a correctness finding

**Symptom:** A real logic error is rejected with a reason like "unit tests cover this function."

**Cause:** The LLM truth verifier used test-coverage evidence to reject a bug claim. Tests do not prove logic is correct.

**Fix:** This is handled automatically by the claim-type-aware verifier (version with `TruthVerifierStage`). The verifier checks `claimAddressed` — if the rejection reason does not address the actual claim (e.g., "logic is wrong"), the rejection is overridden. Safety guards:
- `critical` findings always published regardless of verifier verdict
- `high` severity rejected with confidence < 0.7 is published regardless

---

## JSON Parse Errors

### `[agent:reviewer] could not parse JSON array from response`

**Symptom:**
```
[agent:reviewer] could not parse JSON array from response
```

**Cause:** The AI provider wrapped its JSON response in markdown code fences (` ```json ... ``` `) or returned prose before the array.

**Fix:** This is handled automatically by `BaseAgent.extractJsonArray()`, which uses bracket-counting to find the first balanced `[...]` block inside any surrounding prose or fences. If you still see this error, it means the response contained no valid JSON array at all. Retry the review — this is usually transient. If it recurs, check whether the model is hitting context limits (`context.maxTokens` in config).

---

### `[truth-verifier] invalid response schema`

**Symptom:**
```
[truth-verifier] invalid response schema: [{ "expected": "object", "code": "invalid_type", ... }]
```

**Cause:** The provider returned a JSON array instead of the expected `{ "verdicts": [...] }` object shape.

**Fix:** Handled gracefully — the truth verifier logs the warning and returns `[]`, leaving all findings in their heuristic-verifier state. All findings that passed heuristic verification proceed to the quality gate. Retry the review if this occurs repeatedly.

---

## HTTP 400 — Extended Thinking Errors

### `[agent:reviewer] HTTP 400: max_tokens is too small`

**Symptom:**
```
[agent:reviewer] HTTP 400 Bad Request from Anthropic API
  "max_tokens must be greater than budget_tokens"
```

**Cause:** Extended thinking requires `max_tokens >= budget_tokens + margin`. The `reviewer` agent uses 8,000 thinking tokens; `security` uses 10,000. If `providers.anthropic.maxTokens` is set too low in config, the request is rejected.

**Fix:** Remove the explicit `maxTokens` override and let the provider compute it automatically (`budget_tokens + 4000`):
```json
{
  "providers": {
    "anthropic": { "model": "claude-sonnet-4-6" }
  }
}
```

Or set it high enough:
```json
{
  "providers": {
    "anthropic": { "model": "claude-sonnet-4-6", "maxTokens": 16000 }
  }
}
```

---

## Inline Comments Not Appearing

### Finding in report but not posted as inline comment

**Symptom:** The run report contains findings, but no inline diff comments appear on the PR. A single summary comment is posted instead.

**Cause:** The finding's `lineStart` is not within the visible diff hunk for that file. GitHub only allows inline comments on lines in the `+` or `-` hunk visible in the PR diff view.

**Fix:** This is expected behavior — the CI commenter falls back to a review-level comment (attached to the file, not a specific line) when the line is not in the diff. The finding is still reported; it just appears at the file level. This is common for findings about file-level patterns (e.g., a missing import at the top of a file when only the bottom was modified).

---

## Git Divergence in Feedback Workflows

### `fatal: Not possible to fast-forward, aborting`

**Symptom:** The `feedback-on-merge.yml` workflow fails when committing `metrics.json`:
```
fatal: Not possible to fast-forward, aborting
```

**Cause:** Two workflow runs committed to `main` concurrently.

**Fix:** The workflow already uses `git pull --rebase` before push. If the rebase fails due to a real conflict in `metrics.json`, resolve it manually:
```bash
git fetch origin main
git checkout main
git pull --rebase origin main
# resolve conflict in .engagement-harness/feedback/metrics.json
git add .engagement-harness/feedback/metrics.json
git rebase --continue
git push origin HEAD:main
```

---

## Workflows Not Triggering

### `engagement-harness.yml` not running on PRs

**Cause:** Branch protection or workflow permissions are not configured.

**Fix:**
1. GitHub → Settings → Actions → General → Workflow permissions
2. Set to "Read and write permissions"
3. Verify the workflow `on:` trigger includes `pull_request` events to your default branch

---

### `feedback-on-merge.yml` not running on merge

**Cause:** The workflow triggers on `pull_request: types: [closed]`. Without the `if: github.event.pull_request.merged == true` condition, it runs on close (including non-merge closes).

**Fix:** Verify the workflow contains the merged condition:
```yaml
on:
  pull_request:
    types: [closed]
jobs:
  collect-if-merged:
    if: github.event.pull_request.merged == true
```

---

## `doctor` Reports Missing API Key

**Symptom:**
```
✗ Provider 'anthropic' not reachable — ANTHROPIC_API_KEY is not set
```

**Fix:**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
engagement-harness doctor
```

Add to your shell profile (`~/.zshrc` or `~/.bashrc`) to persist across sessions.

---

## `config validate` Reports Unknown Fields

**Symptom:**
```
config.json is invalid:
  - Unrecognized key(s) in object: 'unknownField'
```

**Cause:** A field in `config.json` does not exist in `ConfigSchema`. This usually happens after a manual edit.

**Fix:**
```bash
engagement-harness config validate
```

The output names the exact invalid fields. Remove or correct them. See [docs/CONFIGURATION.md](CONFIGURATION.md) for the complete field reference.
