# Engagement Harness

A configurable, AI-powered code review platform that installs into a client repository, learns the repo through an interactive setup, and then runs automatically in CI on every pull request. It uses focused context selection, multiple specialized agents, model routing, finding verification, confidence scoring, and policy decisions to produce trustworthy, measurable, client-specific code review intelligence. It is not a generic AI reviewer — it is the harness around the AI that makes the AI's output usable.

## Install

```bash
pnpm install
pnpm build
cd packages/cli && pnpm link --global
```

## Usage

```bash
engagement-harness --help
engagement-harness --version
```

## Documentation

- `ARCHITECTURE.md` — system layers and data flow _(Phase 8)_
- `CONFIG.md` — configuration reference _(Phase 8)_
- `AGENTS.md` — agent catalog _(Phase 8)_
- `PROVIDERS.md` — provider interface and integrations _(Phase 8)_
- `SAFETY.md` — safety guarantees and redaction _(Phase 8)_
- `RELEASE_CHECKLIST.md` — pre-pilot checklist _(Phase 8)_

## Status

This project is being built phase-by-phase. See `.claude/MASTER_PROMPT.md` for the full plan.
