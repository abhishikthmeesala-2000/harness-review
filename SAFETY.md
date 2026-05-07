# Safety Guarantees

This document describes the explicit safety boundaries of Engagement Harness and the known limitations of its secret redaction subsystem.

---

## What the System Never Does

**Never executes changed code.**
The system reads git diffs and file content as text. It does not import, compile, evaluate, or run any code from the repository under review. No subprocess is spawned to run application code.

**Never exposes secrets in reports or agent prompts.**
Before the `ContextBundle` is handed to any agent, `SecretRedactor.redactBundle()` rewrites all diff lines, file content entries, and PR metadata (title and body) in place. Matched values are replaced with the literal string `[REDACTED_SECRET]`. The seven patterns applied are listed in the section below.

**Never auto-fixes code or commits artifacts.**
The tool produces read-only reports and optional remediation plan text. It does not write to the repository, stage files, create commits, or open PRs. The `remediate` command produces a plan as text output only.

**Never posts comments without opt-in.**
`config.ci.postComments` defaults to `false`. ALM comment posting is completely disabled unless the user explicitly sets `postComments: true` and configures `alm.platform`. No PR comment is ever posted in the default configuration.

**Never blocks merges without opt-in.**
`config.ci.blockOnPolicy` defaults to `false`. The `review --ci` command exits with code `0` regardless of the policy engine decision unless the user explicitly sets `blockOnPolicy: true`. No pipeline is blocked in the default configuration.

**Never calls live providers without explicit configuration.**
The default provider for every agent is `"mock"`. Live provider calls (OpenAI, Anthropic) require the user to (a) add a `providers.openai` or `providers.anthropic` block to the config, (b) set the matching environment variable (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`), and (c) explicitly route at least one agent to the live provider in `config.models`. A config that was produced by `defaultConfig()` or `engagement-harness init` will never make a live API call.

**Never modifies access controls or shares documents.**
The system writes report files to the local `reports.outputDir` directory only. It does not modify repository permissions, share files externally, or interact with any access control system.

**Never prompts the user in CI / headless mode.**
When invoked with `review --ci`, all interactive prompts are suppressed. The process reads config and environment variables only and exits with a deterministic exit code. No stdin reads are performed in CI mode.

---

## Secret Redaction Patterns

`SecretRedactor` applies the following seven patterns in order. All patterns are applied globally (the `g` flag) and are reset between calls to prevent state carry-over.

| # | Name | Regex | Matches |
|---|---|---|---|
| 1 | `pem` | `/-----BEGIN (?:RSA \|EC \|DSA \|OPENSSH \|PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA \|EC \|DSA \|OPENSSH \|PGP )?PRIVATE KEY-----/g` | PEM private key blocks (RSA, EC, DSA, OPENSSH, PGP). Checked first because it is multi-line and must match before other patterns can corrupt the block boundaries. |
| 2 | `aws-access-key` | `/\bAKIA[0-9A-Z]{16}\b/g` | AWS access key IDs (`AKIA` prefix followed by exactly 16 uppercase alphanumeric characters). |
| 3 | `github-token` | `/\bgh[psuro]_[A-Za-z0-9]{36,}\b/g` | GitHub personal access tokens, fine-grained tokens, app tokens, server tokens, OAuth tokens, and refresh tokens (`ghp_`, `ghs_`, `ghu_`, `ghr_`, `gho_` prefixes). |
| 4 | `sk-token` | `/\bsk-[A-Za-z0-9_-]{20,}\b/g` | `sk-` prefixed tokens including OpenAI API keys, Anthropic API keys, and other services that use this prefix format. |
| 5 | `jwt` | `/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g` | JSON Web Tokens in their standard three-part base64url-encoded format (`eyJ` header + `.eyJ` payload + `.` signature). |
| 6 | `bearer` | `/\bBearer\s+[A-Za-z0-9._\-+/=]{20,}/gi` | HTTP `Authorization: Bearer <token>` values where the token is at least 20 characters. Case-insensitive on `Bearer`. |
| 7 | `env-style` | `/\b((?:[A-Z0-9_]*?(?:SECRET\|PASSWORD\|TOKEN\|API[_-]?KEY\|ACCESS[_-]?KEY\|KEY))\s*[=:]\s*)["']?([^\s"']{8,})["']?/gi` | Environment variable assignments and config file entries where the key name contains `SECRET`, `PASSWORD`, `TOKEN`, `API_KEY`, `APIKEY`, `API-KEY`, `ACCESS_KEY`, `ACCESSKEY`, `ACCESS-KEY`, or `KEY`, and the value is at least 8 non-whitespace characters. Only the value is redacted; the key name is preserved for readability. |

---

## Known Limitations of Secret Redaction

The patterns are intentionally narrow to minimize false positives on non-secret content. As a result, the following classes of secret are not detected:

**Short tokens may slip through.**
The `sk-token` pattern requires at least 20 characters after the prefix. The `bearer` and `env-style` patterns require at least 20 and 8 characters respectively. Secrets shorter than these thresholds are not redacted.

**Custom or non-standard secret formats are not detected.**
API keys that use proprietary prefixes not listed above (for example, `xoxb-` for Slack, `SG.` for SendGrid, or vendor-specific formats) are not covered by any pattern. Only the seven patterns listed above are applied.

**Encoded or obfuscated secrets are not detected.**
Base64-encoded, hex-encoded, URL-encoded, or otherwise transformed secrets will not match any pattern and will pass through unredacted. The redactor operates on plaintext only.

---

## Defense-in-Depth Recommendation

Because no automated redaction is complete, operators should also:

1. Add `**/.env`, `**/.env.*`, and `**/secrets/**` to `context.ignoredPaths` in the config to prevent secret-containing files from being included in the context bundle at all.
2. Never commit `.engagement-harness/reports/` to source control, as report JSON may contain diff excerpts even after redaction.
3. Rotate any credentials that appear in a diff immediately, regardless of redaction outcome.
