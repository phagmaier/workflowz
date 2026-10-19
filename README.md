# Agent Workflow Runner — Starter Pack

**Status:** Approved architecture for a personal-use MVP; implementation has **not** begun.

A deterministic, local workflow runner for coding agents. The runner executes a user-authored graph of agent steps and ordinary commands, accepts agents' declared outcomes without imposing mandatory review, and follows user-configured transitions. One agent runs at a time in the MVP.

## What to read

| File | Purpose |
| --- | --- |
| [`spec.md`](spec.md) | Product scope, concrete workflow schema, user behavior, and acceptance criteria |
| [`architecture.md`](architecture.md) | Components, persistence, reporting, process lifecycle, recovery, API boundaries |
| [`todo.md`](todo.md) | Ordered implementation checklist with testable milestones |
| [`AGENTS.md`](AGENTS.md) | Rules for coding agents contributing to **this tool** |
| [`examples/overnight.yaml`](examples/overnight.yaml) | Example user-authored workflow, including task iteration, reviews, and failures |
| [`examples/tasks.md`](examples/tasks.md) | Input Markdown task-list example |

## Philosophy

- **The user authors the workflow; the engine follows it.** No supervisor LLM chooses the next step.
- **Trust is configurable.** An agent's valid declared outcome is accepted as input; testing/review/approval happens only if specified by the workflow.
- **The engine owns execution state.** Agents submit reports; they never directly edit the canonical run state.
- **Reporting is strict.** Undeclared outcomes are rejected. Exactly one bounded report-correction turn is allowed after a normally completed agent execution without a valid report; otherwise the run pauses by default.
- **Errors are routable.** The program distinguishes workflow outcomes from execution failures and delegates each to a configured deterministic transition.
- **Sequential first.** No concurrent coding agents, distributed jobs, enterprise permissions, or complex scheduling in the MVP.
- **Unattended but inspectable.** Persistent event history, intervention queue, pause/resume, stop, and modest local UI.

## Typical usage

1. Point the UI or CLI at a project that already has `spec.md`, `AGENTS.md`, and `todo.md`.
2. Import the Markdown checklist as an immutable task snapshot for the run.
3. Select a saved workflow or build one visually. Configure stages, harnesses, outcomes, transition policies, command steps, context, and optional per-task overrides.
4. Validate the definition, choose the working directory and harness settings, then press Start.
5. Leave it running. Later inspect the current step, logs, reports, completed tasks, and human-attention items.
6. When paused, fix an issue, change the remaining workflow, choose a resume point, continue, or end the run.

## Implementation choice

TypeScript on Node.js, SQLite, YAML, a small CLI, and a local web UI. Build the **headless engine before the UI**. Supported harnesses — `codex`, `pi`, `omp`, `opencode`, and `claude` (Claude Code) — are independent process adapters behind one interface and a harness registry. Commands run as configured rather than as special-case Git features.

See [`spec.md`](spec.md) §2.4 for the supported harnesses and [`architecture.md`](architecture.md) for version-dependent integration notes. Verify the exact installed version of each harness CLI during development rather than blindly copying its flags.
