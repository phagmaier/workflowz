# Agent Workflow Runner — Starter Pack

**Status:** Implemented core: project tooling, strict YAML/schema validation, policy compilation, SQLite persistence, transactional run coordination, and a sequential runner for command steps and fake agents. This is not a complete MVP: real harness adapters, `wf report` and report correction, Markdown import/context assembly, management CLI, and UI remain on the [`todo.md`](todo.md) roadmap.

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

## Development

Requirements: Node.js 26 or newer (verified with v26.8.2) and npm (verified with 11.19.1). Nothing else is needed. The test suite runs offline and makes no model calls.

```bash
npm ci                       # install the exact versions in package-lock.json
npm run check                # typecheck + Biome lint + tests (the full gate)
npm run typecheck            # tsc --noEmit, strict mode
npm run lint                 # Biome check (lint and formatting)
npm run format               # Biome auto-fix
npm test                     # build to dist/, then node:test over dist/**/*.test.js
npm run validate -- examples/overnight.yaml   # strict parse, compile, and path checks
npm run probe:harnesses      # offline version and help-text probe of codex, pi, omp, opencode, claude
```

Process tests start real children: `sh`, `sleep`, and `node`. They need a POSIX system.

`npm run validate` exits 0 for a runnable workflow (warnings allowed), 1 when it has errors, and 2 when the file cannot be read. Diagnostics are printed as `file:line:column: severity [code] path: message`.

### Layout

| Path | Contents |
| --- | --- |
| `src/contracts/` | Strict YAML loader, typed v1 schema, diagnostics, placeholder grammar. No engine or process imports. |
| `src/engine/` | Pure compiler, routing, and reducer, plus the run coordinator. The coordinator is the only writer of run state; it has no process or filesystem access. |
| `src/store/` | SQLite migrations (`user_version`), transaction wrapper, and the run repository. The only module that opens the database. |
| `src/adapters/` | Process supervision (process groups, timeouts, reaping), command executor, agent adapter contract, environment allowlist, harness registry (data only), and the offline harness probe. Adapters never import the engine. |
| `src/runner/` | `RunService`: drives one attempt at a time, prepares attempts, maps process results to settlements, handles pause, stop, and recovery. |
| `src/app/` | Command-line entry points. |
| `src/architecture.test.ts` | Fails the build if an import crosses one of these boundaries. |
| `test/fixtures/fake-agent.mjs` | Test-only stand-in for a harness: report, crash, hang, and child-process modes. |
| `test/fixtures/workflows/` | Invalid and warning-only workflow fixtures. Every invalid fixture must be listed with its expected code. |
| `docs/` | [Harness compatibility note](docs/harness-compatibility.md) and [schema v1 decisions](docs/schema-v1.md). |

### Dependencies

| Package | Version | Why |
| --- | --- | --- |
| `yaml` | 2.9.1 | YAML 1.2 parser. Reports duplicate keys (`uniqueKeys`) and gives exact source offsets. |
| `zod` | 4.6.7 | Runtime validation of the workflow schema. Every object is `strictObject`. |
| `typescript` | 7.0.2 | Strict typecheck and build. |
| `@types/node` | 26.6.5 | Node API types, matching the Node version in use. |
| `@biomejs/biome` | 2.5.15 | One tool for lint and formatting. |

SQLite uses the built-in `node:sqlite` module, which needs no native build step and loads on Node v26.8.2 without flags. Tests use the built-in `node:test` runner.
