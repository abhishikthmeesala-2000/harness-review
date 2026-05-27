# @engagement-harness/cli

Command-line interface for Engagement Harness. Built with Commander.js and wired to all subcommand implementations.

---

## Key Modules

| Path | Purpose |
|---|---|
| `src/index.ts` | `buildProgram()` — assembles the Commander.js program; `run(argv)` — entry point |
| `bin/engagement-harness.js` | Binary entry point (calls `run(process.argv)`) |
| `src/commands/init.ts` | Interactive repository initialization |
| `src/commands/uninit.ts` | Remove config, scaffold, and workflows |
| `src/commands/doctor.ts` | Validate installation, config, and environment |
| `src/commands/review.ts` | PR review orchestration |
| `src/commands/remediate.ts` | Remediation plan generation |
| `src/commands/report.ts` | `reportLatestCommand`, `reportRunCommand`, `reportListCommand` |
| `src/commands/config-validate.ts` | Validate current config |
| `src/commands/agents-list.ts` | List registered agents |
| `src/commands/models-list.ts` | List providers and routing |
| `src/commands/models-validate.ts` | Validate provider availability |
| `src/commands/ci-templates.ts` | Generate CI workflow templates |
| `src/commands/eval.ts` | Run eval suite |
| `src/commands/feedback-collect.ts` | Collect GitHub PR reactions |
| `src/commands/feedback-import.ts` | Import feedback JSON |
| `src/commands/feedback-report.ts` | Print feedback metrics report |
| `src/utils/git.ts` | Git utilities — branch, remote, platform detection |
| `src/utils/errors.ts` | `CliError` class |

---

## Full Command Reference

```
engagement-harness [options] <command>

Options:
  -v, --version             output version (0.1.0)
  -h, --help                display help

Commands:
  init [options]            Initialize Engagement Harness in the current repository
    -y, --yes               Non-interactive mode using detected defaults

  uninit [options]          Remove config, scaffold, and workflows
    -y, --yes               Skip all prompts

  doctor                    Validate installation, config, and environment

  review [options]          Run a pull request review
    --ci                    Headless CI mode
    --base <ref>            Base git ref for diff (overrides auto-detect)
    --head <ref>            Head git ref for diff (overrides auto-detect)

  remediate [options]       Generate a remediation plan for a finding
    --finding <id>          Finding ID (e.g. EH-0001)

  report <subcommand>
    report latest           Print the most recent report to stdout
    report run <id>         Print a specific run report to stdout
    report list             List all run IDs with timestamps and decisions

  config <subcommand>
    config validate         Validate the current configuration

  agents <subcommand>
    agents list             List registered agents

  models <subcommand>
    models list             List registered providers and routing
    models validate         Validate provider routing for each agent

  ci <subcommand>
    ci templates [options]  Generate CI workflow templates
      --platform <name>     github | gitlab | azure-devops | bitbucket
      --write               Write the template to disk
      --no-print            Do not print to stdout
      --context <mode>      client | source | auto (default: auto)

  eval                      Run the eval suite against fixture cases

  feedback <subcommand>
    feedback collect [opts] Collect feedback from GitHub PR reaction emojis
      --repo <owner/repo>   GitHub repository (required)
      --pr <number>         Specific PR number to scan
      --days <number>       Days to look back (default: 7)
      --since <date>        ISO date or "Xdays" shorthand
      --memory-dir <path>   Write Claude memory file after collecting
    feedback import <file>  Import a feedback JSON file
    feedback report [opts]  Print a feedback metrics report
      --format <format>     text | json (default: text)
```

---

## Usage

```typescript
import { run } from '@engagement-harness/cli';
await run(process.argv);
```

Or via the binary:
```bash
engagement-harness review --base main --head HEAD
```

---

## Dependencies

- `@engagement-harness/agents` — `AgentOrchestrator`
- `@engagement-harness/ci` — `GitHubCommenter`
- `@engagement-harness/core` — config, context, diff, schemas
- `@engagement-harness/eval` — `EvalRunner`
- `@engagement-harness/feedback` — `ReactionCollector`, `FeedbackStore`, `MetricsCalculator`
- `@engagement-harness/pipeline` — `FindingPipeline`
- `@engagement-harness/providers` — `ProviderRegistry`
- `@engagement-harness/reports` — `ReportGenerator`, `ReportWriter`
- `commander` — CLI framework
- `@inquirer/prompts` — interactive init prompts
- `chalk` — colored console output
