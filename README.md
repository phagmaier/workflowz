# Agent Workflow Runner — Starter Pack

**Status:** Implemented core: project tooling, strict YAML/schema validation, policy compilation, SQLite persistence, transactional run coordination, a sequential runner for command steps and fake agents, mandatory CLI/HTTP reporting with one same-session correction, immutable Markdown task import, selected input context, run-local task parameters, and paused workflow revisions, and offline-conformant Codex, Pi and Claude Code CLI adapters. This is not a complete MVP: live harness verification, the other harness adapters, management CLI, and UI remain on the [`todo.md`](todo.md) roadmap.

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
npm run smoke:reporting      # real wf report + SQLite + fake-session correction, no model calls
npm run smoke:tasks          # immutable Markdown import + fake task loop + persisted context
npm run probe:harnesses      # offline version and help-text probe of codex, pi, omp, opencode, claude
```

Process tests start real children: `sh`, `sleep`, and `node`. They need a POSIX system.

`npm run validate` exits 0 for a runnable workflow (warnings allowed), 1 when it has errors, and 2 when the file cannot be read. Diagnostics are printed as `file:line:column: severity [code] path: message`.

### Reporting (implemented headless path)

Build first (`npm run build`); the project-local executable is `bin/wf` (also declared as the npm `wf` bin). Adapters put it on the child PATH and inject `WF_REPORT_ENDPOINT` and `WF_REPORT_TOKEN` in the environment. Agents submit, for example:

```bash
wf report complete --summary "Implemented validation" --handoff-file handoff.md
wf report blocked --summary "Need input" --issue "Missing requirement" --data '{"area":"auth"}'
```

The CLI waits for acknowledgment. Rejected reports exit 1 with a useful message; acceptance exits 0. Identity comes from the opaque token; reports cannot supply run/attempt IDs or transitions. Acceptance writes one immutable report and event, then waits for process settlement before routing. Clean missing reports allow one same-session correction, bounded to 30 seconds (or less); failed/unavailable correction routes `system.report_error`. Original process/provider failures bypass correction. The offline fake harness, Codex, Pi and Claude fixtures exercise this path. All three real adapters have offline launch/session conformance coverage; live provider verification and the remaining installed harness adapters remain Phase 6 work.

`RunService.previewTasks({workflowText, workflowDir})` exposes checklist counts and source metadata without creating a run. `RunService.createRun` reads and freezes the configured checklist; prechecked tasks are excluded unless `includeCompleted: true` is explicit. The lower-level coordinator still accepts supplied task records for offline fixtures. Instructions and selected same-task reports are assembled at attempt preparation and persisted with the task context; future attempts read current configured instruction content. Run-local task parameters and paused revisions are available through the headless service API (below). Automatic re-import remains unimplemented.

`RunService.setTaskOverrides(runId, taskId, {overrides, reason})` replaces one unfinished task's settings in a ready or paused run. For example:

```ts
service.setTaskOverrides(runId, taskId, {
  reason: "Use a different model and omit this task's command check",
  overrides: {
    steps: {
      implement: { model: "chosen-model", prompt: "Implement {{task.text}}" },
      check: { skip: { outcome: "complete" } },
    },
  },
});
service.reviseWorkflow(runId, {
  workflowText: revisedYaml,
  reason: "Revise remaining stages",
  // cursorStepId: "implement", // required if the old cursor is incompatible
});
```

Settings may replace agent model/prompt, skip an existing executable step via a declared outcome, and override selected `on` entries. `{steps: {}}` clears task settings. Revisions retain imported task IDs/progress and all history, validate pending overrides, and require a compatible cursor. Each attempt freezes its settings. Session resume remains restricted to the same harness/run/task/revision; a new revision cannot reopen an older revision's session. See [schema decisions](docs/schema-v1.md) for the strict contracts and skip semantics.

### Codex adapter (Phase 6.1)

`await createCodexAdapter()` from `src/adapters/codex.ts` runs only offline version/help probes. Register the returned adapter as `new Map([["codex", adapter]])` in `RunService` options. Creating/driving a run is still through the headless API; the management CLI comes later. Calling `drive` with this adapter launches the installed Codex and can use the configured account/provider.

The adapter uses stdin for prompts, JSONL for session/failure evidence, and `wf report` for authoritative outcomes. It waits for process-group/pipe settlement after terminal events. It resumes only explicit persisted UUIDs, passes model/reasoning effort, records CLI version and unrestricted permission mode in invocation events, and scrubs injected authorization from output. Per-invocation configuration keeps report environment available to tools, excludes the Codex API key from tool inheritance, and disables shell snapshots; global config files are never edited. The child inherits the existing common environment allowlist plus `CODEX_HOME` and `CODEX_API_KEY` when set. Other harness variables/credentials are withheld.

Current evidence: installed Codex `0.163.0` advertises the required flags; the real adapter passes the full shared conformance suite against an offline fixture CLI. Authentication, provider-backed framing/resume and managed-config interactions are **not yet verified**; milestone 0.5 and the Phase 6 live gate remain open. See [compatibility details](docs/harness-compatibility.md).

### Pi adapter (Phase 6.2)

`await createPiAdapter()` from `src/adapters/pi.ts` probes the installed CLI offline with a temporary Pi config directory and resource discovery disabled. Register it as `new Map([["pi", adapter]])` in `RunService` options. The installed package is `@earendil-works/pi-coding-agent` 1.3.0. Driving a real run can use Pi's configured provider/account.

Prompts use stdin with `--print --mode json`. The LF-only streaming parser waits for `agent_settled`, allows Pi's internal retries to recover, and still requires supervised process/group/pipe settlement. Final provider failures, aborts and malformed streams bypass report correction. Outcomes come only from `wf report`.

Each fresh invocation gets a dedicated persistent directory below `pi-sessions` beside the attempt logs (or adapter option `sessionDir`). Only a matching streamed UUID and persisted v3 session header can supply a resume identity. Resume validates that exact file and working directory, then passes its full UUID with its dedicated `--session-dir`; missing sessions fail instead of starting fresh. The same runner-owned correction limit applies. Direct adapter callers must supply `sessionDir` or `logPath`.

Model and thinking level use `--model` / `--thinking`. Normal Pi tools use no permission flag; invocation events record the CLI version and `default-unrestricted-tools`. Runtime environment selects the base allowlist, Pi config/offline/telemetry settings, explicit provider credentials and report access; injected secrets are scrubbed. No global config is edited. See [compatibility details](docs/harness-compatibility.md) for the exact environment list and remaining live checks. Pi passes the full shared offline conformance suite; milestone 0.5 and the Phase 6 live gate remain open.

### Claude Code adapter (Phase 6.3)

`await createClaudeAdapter()` from `src/adapters/claude.ts` probes version/help with temporary home/config and no provider credentials. Register it as `new Map([["claude", adapter]])` in `RunService` options. Driving a real run uses Claude's configured provider/account and can incur usage.

The adapter sends prompts through stdin with `--print --input-format text --output-format stream-json --verbose --permission-mode bypassPermissions`. Optional model and validated effort use `--model` / `--effort`. A successful terminal `result` and supervised process/group/pipe settlement are both required. Protocol/provider errors bypass report correction; only `wf report` supplies outcomes.

Default CLI session persistence stays enabled. The terminal UUID is the opaque session identity; resume passes only that exact UUID to `--resume`, with no recent-session selector, fork or fresh fallback. Unavailable sessions and mismatches fail explicitly. CLI version and `bypassPermissions` are audited. Runtime selects the base environment plus Claude config, explicit Anthropic auth/provider settings and report access, scrubbing injected tokens/keys. No global config is edited.

The installed version is 2.1.303. Its offline missing-UUID check confirmed failure without a provider request. The real adapter passes all shared conformance tests against a synthetic CLI; authenticated persistence/resume, actual provider framing and tool environment remain live-smoke work. See [compatibility details](docs/harness-compatibility.md). Milestones 0.5 and 6.6–6.8 remain open.

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
