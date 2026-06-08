# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 0.1.x | ✅ Active |

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report security vulnerabilities through [GitHub Security Advisories](https://github.com/abhishikthmeesala-2000/harness-review/security/advisories/new). You will receive a response within 72 hours.

Include:
- A description of the vulnerability and its potential impact
- Steps to reproduce, or a proof-of-concept
- Affected version(s)
- Any suggested mitigations

We will acknowledge receipt, keep you informed of the fix timeline, and credit you in the release notes unless you prefer otherwise.

---

## What Data Is Sent to AI Providers

Engagement Harness sends the following to your configured AI provider (Anthropic or OpenAI):

**Sent:**
- The diff of changed files (lines added/removed)
- Imported file context (imports and exports from changed files)
- Client rule files from `.engagement-harness/rules/*.md`
- Agent system prompts

**Not sent:**
- Full file contents beyond the diff and imported context
- Git history or commit messages (except PR title/body for `pr-intent-gap`)
- Credentials, environment variables, or config files outside `.engagement-harness/`

### Secret Redaction

Before any context is passed to an agent, it runs through `SecretRedactor` in `packages/core/src/redaction/`. This strips patterns matching:

- API keys (`sk-`, `AKIA`, `ghp_`, `Bearer `, etc.)
- Connection strings with embedded passwords
- Private key blocks (`-----BEGIN * PRIVATE KEY-----`)
- Generic high-entropy strings adjacent to known key names

**Redaction is best-effort.** Do not rely on it as a substitute for keeping secrets out of your diff. If a secret appears in a diff, it has already been committed to git history.

---

## Data Retention

Engagement Harness makes direct API calls to your configured provider. The data sent in these calls is subject to that provider's data retention policy:

- **Anthropic API**: Business customers can opt out of data training. See [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy).
- **OpenAI API**: API data is not used for training by default. See [OpenAI's API data usage policy](https://openai.com/policies/api-data-usage-policies).

Engagement Harness itself retains no data outside of:
- Reports written to `.engagement-harness/reports/` on your local disk or CI runner
- Feedback metrics written to `.engagement-harness/feedback/metrics.json` in your repository
- Eval fixture files committed to this repository

---

## CI Workflow Permissions

The generated `engagement-harness.yml` and `feedback-on-merge.yml` workflows require the following GitHub Actions permissions:

```yaml
permissions:
  contents: write      # commit metrics.json
  pull-requests: write # post inline comments and summary comment
```

Scope these as narrowly as your organization's policy allows. If you use a GitHub App token instead of `GITHUB_TOKEN`, grant only `contents:write` and `pull-requests:write` on the target repository.

---

## Dependency Security

Engagement Harness uses a pinned `pnpm-lock.yaml`. Dependabot is configured to open PRs for dependency updates. All dependency updates go through the standard PR + CI review process before merge.

To audit dependencies manually:

```bash
pnpm audit
```
