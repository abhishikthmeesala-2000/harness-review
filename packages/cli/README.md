# @engagement-harness/cli

Command-line interface for Engagement Harness. Built with Commander.js and wired to all subcommand implementations.

---

## Installation

```bash
# Link globally from the monorepo
cd packages/cli
npm link
```

The binary is `engagement-harness`.

---

## Command Reference

### `init [--yes]`

Initialize Engagement Harness in the current repository.

```bash
engagement-harness init          # interactive
engagement-harness init --yes    # non-interactive, accept all defaults
```

Creates `.engagement-harness/config.json`, `.engagement-harness/rules/`, and `.engagement-harness/reports/`.

---

### `uninit [--yes]`

Remove Engagement Harness config, scaffold, and generated workflow files from the current repository.

```bash
engagement-harness uninit
engagement-harness uninit --yes  # skip confirmation
```

---

### `doctor [--fix]`

Validate installation, config, and environment.

```bash
engagement-harness doctor
engagement-harness doctor --fix  # attempt to auto-fix detected issues
```

Checks: CLI is linked, config.json is valid, configured providers have API keys, ALM platform is reachable.

---

### `review [options]`

Run a pull request review.

```bash
engagement-harness review
engagement-harness review --base main --head HEAD
engagement-harness review --ci --base main --head $GITHUB_SHA
```

Options:
- `--base <ref>` — base git ref (default: `main`)
- `--head <ref>` — head git ref (default: `HEAD`)
- `--ci` — CI mode: suppress interactive output, use ALM to post comments

---

### `remediate --finding <id>`

Generate a BEFORE/AFTER code patch for a specific finding.

```bash
engagement-harness remediate --finding EH-0001
```

Reads the finding from the most recent run report, generates a tech-stack-aware patch.

---

### `report <subcommand>`

Report inspection utilities.

```bash
engagement-harness report latest          # print the most recent report
engagement-harness report run <id>        # print a specific run report
engagement-harness report list            # list all run IDs with timestamps and decisions
```

---

### `config validate`

Validate the current `.engagement-harness/config.json` against the schema.

```bash
engagement-harness config validate
```

---

### `agents list`

List all registered agents with their IDs, dimensions, and descriptions.

```bash
engagement-harness agents list
```

---

### `models list`

Show the per-agent provider routing based on the current config.

```bash
engagement-harness models list
```

---

### `models validate`

Check that each configured provider is reachable (API key present and valid).

```bash
engagement-harness models validate
```

---

### `ci templates [options]`

Generate CI workflow templates for your platform.

```bash
engagement-harness ci templates --platform github
engagement-harness ci templates --platform github --write
engagement-harness ci templates --platform gitlab --write
engagement-harness ci templates --platform azure-devops --no-print
```

Options:
- `--platform <name>` — `github | gitlab | azure-devops | bitbucket`
- `--context <mode>` — `client | source | auto` (where to write the template)
- `--write` — write template to the correct path in the repository
- `--no-print` — suppress stdout output (use with `--write`)

---

### `eval`

Run the eval suite against fixture cases.

```bash
engagement-harness eval
```

Requires eval fixture cases in the `packages/eval/` directory.

---

### `feedback <subcommand>`

Feedback ingestion utilities.

```bash
# Collect reactions from GitHub (auto-detects repo from git remote)
engagement-harness feedback collect

# Collect with explicit options
engagement-harness feedback collect --repo owner/repo --pr 42
engagement-harness feedback collect --repo owner/repo --days 30
engagement-harness feedback collect --repo owner/repo --since 2026-01-01

# Import feedback from a JSON file
engagement-harness feedback import feedback.json

# Print a metrics report
engagement-harness feedback report
engagement-harness feedback report --format json

# Print a pilot program summary
engagement-harness feedback pilot-report --days 30
```

---

## Global Options

```bash
engagement-harness --version   # output version
engagement-harness --help      # display help
engagement-harness help <cmd>  # display help for a subcommand
```

---

## Source Layout

```
src/
├── index.ts                    # Commander program builder and entry point
├── commands/
│   ├── init.ts                 # init command
│   ├── uninit.ts               # uninit command
│   ├── doctor.ts               # doctor command
│   ├── review.ts               # review command
│   ├── remediate.ts            # remediate command
│   ├── report.ts               # report subcommands
│   ├── config-validate.ts      # config validate
│   ├── agents-list.ts          # agents list
│   ├── models-list.ts          # models list
│   ├── models-validate.ts      # models validate
│   ├── ci-templates.ts         # ci templates
│   ├── eval.ts                 # eval command
│   ├── feedback-collect.ts     # feedback collect
│   ├── feedback-import.ts      # feedback import
│   ├── feedback-report.ts      # feedback report
│   └── feedback-pilot-report.ts # feedback pilot-report
├── utils/
│   ├── git.ts                  # git utilities (getRepoRoot, getRemoteUrl)
│   └── errors.ts               # CliError class
└── pricing.ts                  # cost estimation utilities
```
