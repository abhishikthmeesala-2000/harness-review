# Troubleshooting

Solutions for every error encountered in production.

---

## Clone Authentication Errors

### `fatal: could not read Password`

**Symptom:**
```
fatal: could not read Password for 'https://github.com': No such device or address
```

**Cause:** The CI workflow uses `git clone https://github.com/...` in a non-interactive shell. Git prompts for credentials but there is no terminal to accept them.

**Fix:** Use HTTPS with an embedded token, or switch to SSH. In the CI workflow:
```yaml
- name: Clone Engagement Harness
  run: git clone https://github.com/abhishikthmeesala-2000/harness-review.git /tmp/harness
```
The repository is public, so a bare clone without credentials works. If the repository is private:
```yaml
- name: Clone Engagement Harness
  run: git clone https://x-access-token:${{ secrets.HARNESS_PAT }}@github.com/abhishikthmeesala-2000/harness-review.git /tmp/harness
```

### Empty token in clone URL `https://@github.com`

**Symptom:**
```
fatal: repository 'https://@github.com/owner/repo.git/' not found
```

**Cause:** `${{ secrets.HARNESS_PAT }}` is empty. The clone URL becomes `https://:@github.com/...` which GitHub rejects.

**Fix for public repos:** Remove the token from the URL entirely — bare HTTPS works without authentication.

**Fix for private repos:** Set the `HARNESS_PAT` secret in GitHub → Settings → Secrets and variables → Actions → Repository secrets.

---

## pnpm Version Conflict

### `ERR_PNPM_BAD_PM_VERSION` / Multiple versions of pnpm specified

**Symptom:**
```
Error: Multiple versions of pnpm specified:
  - version 10 in the GitHub Action config with the key "version"
  - version pnpm@10.33.2 in the package.json with the key "packageManager"
```

**Cause:** `pnpm/action-setup@v4.1.0` requires the pnpm version to be specified in exactly one place. A `version:` key in the workflow step conflicts with the `"packageManager"` field in `package.json`.

**Fix:** Remove the `version:` key from the `pnpm/action-setup` step in all workflow files. The action reads the version from `package.json` automatically.

```yaml
# Before (broken)
- uses: pnpm/action-setup@v4.1.0
  with:
    version: 10

# After (correct)
- uses: pnpm/action-setup@v4.1.0
```

---

## Zero Findings Published

### All agents on mock

**Symptom:** Review runs, no errors, but 0 findings published.

**Cause:** All agents are using `MockProvider`. The mock returns deterministic fixtures that may not match the current diff, causing the verifier to reject them.

**Check:**
```bash
engagement-harness models list
```
If every agent shows `mock`, no real AI provider is configured.

**Fix:**
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

### Verifier rejecting everything

**Symptom:** Console shows many `✗ rejected` lines; `verifierApprovalRate` near 0.

**Cause:** Evidence in agent findings does not match actual diff content. The `Verifier` checks that diff-type evidence items appear verbatim in the diff hunks.

**Check the output:**
```
✗ rejected: ... (verifier: diff evidence content does not appear in diff hunks)
```

**Fix:** This is usually a mock provider issue — the mock patches evidence to match the diff, but the patch may fail if the diff pattern is unusual. Switching to a real provider resolves it.

### Diff too small / below confidence threshold

**Symptom:** `confidenceThreshold` in config is high (e.g., 0.9) and small diffs produce no findings above that threshold.

**Fix:** Lower the threshold during a pilot:
```json
{ "review": { "confidenceThreshold": 0.2 } }
```

---

## Verifier Rejecting Real Bugs

### "Tests exist" used to reject a bug finding

**Symptom:** A real logic error is rejected with a reason like "unit tests cover this function."

**Cause:** The LLM truth verifier used test-coverage evidence to reject a bug claim. Tests do not prove logic is correct.

**Fix:** This is handled automatically by the claim-type-aware verifier. If you see this with an older version, upgrade to the version that includes `TruthVerifierStage` with `claimAddressed` enforcement. The check:
- Bug claim rejected with `claimAddressed=false` → published regardless
- High severity rejected with confidence < 0.7 → published regardless

---

## JSON Parse Errors

### Provider response wrapped in markdown fences

**Symptom:**
```
[agent:reviewer] could not parse JSON array from response
```

**Cause:** The AI provider wrapped its JSON response in markdown code fences (` ```json ... ``` `).

**Fix:** This is handled automatically by `BaseAgent.extractJsonArray()` — it uses bracket-counting to find the first balanced `[...]` block inside any surrounding prose or fences. If you still see this, it means the response contained no valid JSON array at all. Retry the review; this is usually transient.

### `[truth-verifier] invalid response schema`

**Symptom:**
```
[truth-verifier] invalid response schema: [{ "expected": "object", "code": "invalid_type", ... }]
```

**Cause:** The provider returned a JSON array instead of the expected `{ "verdicts": [...] }` object.

**Fix:** This is handled gracefully — the truth verifier logs the warning and returns `[]`, leaving all findings in their heuristic-verifier state. Retry the review.

---

## Git Divergence

### `fatal: Not possible to fast-forward, aborting`

**Symptom:** The `feedback-on-merge.yml` workflow fails when committing metrics:
```
fatal: Not possible to fast-forward, aborting
```

**Cause:** Two workflow runs committed to `main` concurrently.

**Fix:** The workflow already uses `git pull --rebase` before push. If the rebase fails due to a real conflict in `metrics.json`:
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

**Cause:** Branch protection or workflow permissions are not set.

**Fix:**
1. Go to GitHub → Settings → Actions → General → Workflow permissions
2. Set to "Read and write permissions"
3. Check that the workflow triggers on `pull_request` events to your default branch

### `feedback-on-merge.yml` not running on merge

**Cause:** The workflow triggers on `pull_request: types: [closed]` plus `if: github.event.pull_request.merged == true`. If the `if` condition is missing, it runs on close (not just merge).

**Fix:** Verify the workflow file contains:
```yaml
on:
  pull_request:
    types: [closed]
jobs:
  collect-if-merged:
    if: github.event.pull_request.merged == true
```

---

## `pnpm link --global` Fails on pnpm v11

**Symptom:**
```
[ERR_PNPM_LINK_BAD_PARAMS] You must provide a parameter. Usage: pnpm link <dir>
```

**Cause:** `pnpm link --global` (no-argument form) was removed in pnpm v11.

**Fix:** Use `npm link` from the CLI package directory:
```bash
cd packages/cli
npm link
```

---

## `doctor` Reports Missing API Key

**Symptom:**
```
✗ Provider 'anthropic' not reachable — ANTHROPIC_API_KEY is not set
```

**Fix:** Export the key before running:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
engagement-harness doctor
```

Or add it to your shell profile (`~/.zshrc` or `~/.bashrc`) to persist across sessions.
