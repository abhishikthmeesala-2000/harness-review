# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 0.1.x | Yes |

---

## Reporting a Vulnerability

If you discover a security vulnerability in Engagement Harness, please report it privately rather than opening a public GitHub issue.

**Email:** Report to the repository maintainers via the contact information in the GitHub profile. Include:

1. A description of the vulnerability and its potential impact
2. Steps to reproduce
3. Any suggested remediation

We will acknowledge the report within 3 business days and provide a timeline for a fix.

---

## What Data Is Protected

### Secret Redaction

Engagement Harness applies `SecretRedactor` to all diff content, file content, and PR metadata before any agent prompt is sent to an external provider. The following patterns are redacted to `[REDACTED_SECRET]`:

| Pattern | Example match |
|---|---|
| PEM private keys | `-----BEGIN RSA PRIVATE KEY-----` blocks |
| AWS access keys | `AKIA[0-9A-Z]{16}` |
| GitHub tokens | `gh[psuro]_[A-Za-z0-9]{36,}` |
| `sk-` prefixed API keys | `sk-ant-...`, `sk-proj-...` |
| JWTs | Three-segment `eyJ...eyJ...` format |
| Bearer tokens | `Authorization: Bearer <token>` |
| Env-style secrets | `SECRET=...`, `PASSWORD=...`, `API_KEY=...`, `TOKEN=...`, `CREDENTIAL=...` |

**Limitation:** Redaction is pattern-based. A secret encoded in an unusual format (e.g., base64-wrapped without standard headers, rotated prefix) may not be caught. Never commit real secrets to version control — treat redaction as a safety net, not a substitute for proper secret management.

### API Keys in Config

The `config.json` file does not store API keys. Keys are read exclusively from environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). The `.engagement-harness/` directory should be committed to version control; it contains no secrets.

### Report Content

Reports written to `.engagement-harness/reports/` contain finding descriptions and code snippets from the diff. In most cases this includes non-sensitive code, but review report content before sharing externally.

---

## What Engagement Harness Does Not Do

- **Never executes code** — diffs are read as text only; no subprocess runs application code from the reviewed repository
- **Never auto-commits** — the `remediate` command produces plan text only; it does not modify files or create commits
- **Never posts comments without opt-in** — `ci.postComments` must be explicitly set to `true` in config
- **Never blocks CI without opt-in** — `ci.blockOnPolicy` defaults to `false`
- **Never calls live AI providers without explicit config** — agents use `MockProvider` unless a named provider is configured in `config.models`

See [SAFETY.md](SAFETY.md) for the complete list of safety guarantees and redaction implementation details.
