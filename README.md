# Agent Workflow Runner — Starter Pack

**Status:** Implemented core: strict workflow compilation, transactional SQLite coordination, sequential command/agent execution, mandatory reporting with one same-session correction, immutable task import, parameters/revisions, and all five harness adapters. Milestone 0.5, Phase 6, Phases 7.1–7.5 and browser preparation/editor/dashboard Phases 8.1–8.3 are complete. This is not a complete MVP: paused editing and remaining browser acceptance stay on the [`todo.md`](todo.md) roadmap. See the [implementation evidence](docs/implementation-log.md).

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

Requirements: Linux with `/proc`, Node.js 26 or newer (verified with v26.8.2) and npm (verified with 11.19.1). State databases require a local filesystem with reliable SQLite locks. The test suite runs offline and makes no model calls.

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
npm run smoke:capabilities   # offline installed-feature preflight + real fixture reporting
npm run smoke:boundaries     # synthetic credential/environment/log boundaries + real reporting
npm run smoke:recovery       # real owner SIGKILL + process identity + no replay, offline
npm run smoke:harnesses -- --help  # opt-in live tool; no provider execution without --execute
npm run probe:harnesses      # isolated factory capability probes of codex, pi, omp, opencode, claude
```

Process tests start real children: `sh`, `sleep`, and `node`. Linux `/proc` is required for supervised process identity; unsupported identity environments fail before launch.

`npm run validate` exits 0 for a runnable workflow (warnings allowed), 1 when it has errors, and 2 when the file cannot be read. Diagnostics are printed as `file:line:column: severity [code] path: message`.

### Reporting (implemented headless path)

Build first (`npm run build`); the project-local executable is `bin/wf` (also declared as the npm `wf` bin). Adapters put it on the child PATH and inject `WF_REPORT_ENDPOINT` and `WF_REPORT_TOKEN` in the environment. Agents submit, for example:

```bash
wf report complete --summary "Implemented validation" --handoff-file handoff.md
wf report blocked --summary "Need input" --issue "Missing requirement" --data '{"area":"auth"}'
```

The CLI waits for acknowledgment. Rejected reports exit 1 with a useful message; acceptance exits 0. Identity comes from the opaque token; reports cannot supply run/attempt IDs or transitions. Acceptance writes one immutable report and event, then waits for process settlement before routing. Clean missing reports allow one same-session correction, bounded to 30 seconds (or less); failed/unavailable correction routes `system.report_error`. Original process/provider failures bypass correction. The offline fake harness and all five real adapters' synthetic CLI fixtures exercise this path. All five adapters have offline launch/session conformance coverage; Codex and Pi additionally passed authenticated Luna/low reporting and exact-session correction.

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

### Ownership and startup recovery (Phase 7.1)

Opening a writable `WorkflowDatabase(file)` holds a single-owner lease until `close()` or process exit/crash. A competing writer fails before migrations or execution; symlink aliases resolve to the same lease. Inspect a live database with `new WorkflowDatabase(file, { readOnly: true })` and `RunCoordinator`, not a second runner. Read-only snapshots cannot write. Do not unlink the adjacent `.runner-lock` file or use hard-link aliases/network filesystems.

The first `RunService` on a writer connection automatically reconciles persisted running/pausing runs and unresolved attempts into `interrupted`; it never resumes work or signals orphan processes. Linux boot ID, PID/PGID/session and start ticks are persisted for commands and every agent/correction invocation. Spawn intent clears the prior process identity before launch, so a correction spawn gap stays unknown rather than borrowing its original's settled identity.

`service.reconcile(runId)` refreshes an interrupted attempt's process observation. `alive`, `mismatch` or `unknown` blocks execution across the state database; `gone` removes only that process barrier, not the interruption. Explicit interrupted resume requires a reason acknowledging possible side effects. Accepted reports are retained but cannot route an interrupted attempt. Between-step restarts preserve the committed cursor without replay.

`/proc` inspection and signalling are not atomic, escaped descendants remain outside group ownership, and no isolation or rollback is claimed. See [recovery contracts and limits](architecture.md#75-phase-71-ownership-identity-and-reconciliation).

### Explicit headless recovery decisions (Phase 7.2)

`service.recovery(runId)` returns a consistent durable view: run/cursor/revision, interrupted attempt, retained report, invocation log paths, last process observation, separate operator resolution, process barrier status, action hints and `expectedEventId`. Inspection performs no signalling or fresh OS observation; use `reconcile` to refresh evidence.

Every recovery mutation needs the inspected `expectedEventId`, exact `attemptId` (null between committed steps), and a nonblank reason. Changed state requires a fresh inspection, not a blind retry.

```ts
const state = service.recovery(runId);
await service.terminateRecovery(runId, {
  expectedEventId: state.expectedEventId,
  attemptId: state.attempt?.attemptId ?? null,
  reason: "Terminate the verified orphan before deciding whether to repeat its work",
});
const resolved = service.recovery(runId);
service.decideRecovery(runId, {
  expectedEventId: resolved.expectedEventId,
  attemptId: resolved.attempt?.attemptId ?? null,
  action: "retry",
  reason: "Reviewed filesystem/external effects; explicitly repeat this interrupted stage",
});
// The decision leaves the run paused. Execution still needs explicit resume and drive.
service.coordinator.resume(runId, "Execute the selected recovery plan");
await service.drive(runId);
```

Termination commits user intent before signalling, rechecks group ownership before TERM/KILL, and waits at most one second after each signal for group absence. Uncertain/failed cleanup stays blocked. A crash during termination does not replay signals on startup.

For unidentified/mismatched operations, **independently establish that no operation remains first**. Then call `service.confirmExternalCleanup(runId, {...request, confirmedNoSurvivingOperation: true})`. This is a consequential operator assertion, not a force-kill or automated proof: it cannot signal an unknown/reused PID, rejects fresh evidence of a surviving owned group, and persists separately from the last OS observation. Unknown launch intent remains unknown. A false assertion can permit overlapping external work; the runner cannot verify escaped or unidentified processes for you.

Once every process barrier is resolved, `decideRecovery` supports `retry` for an interrupted stage, `continue` for a committed between-step cursor, `skip` with a declared `outcome`, `jump` with a compatible `stepId`, or `end` (records `stopped`, not successful completion). Non-ending choices stay paused. Retry creates a new logical attempt only on subsequent execution; the old report/session/correction/input history is preserved, never promoted to successful settlement. Skip records a manual null-attempt transition, not an agent report.

Legacy histories may contain multiple unresolved attempts; inspect and resolve each one in turn before choosing a continuation.

Phase 7.3 exposes these same recovery operations through the management CLI below. No provider calls are needed for `npm run smoke:recovery`.

### Management CLI and local daemon (Phase 7.3)

Build with `npm run build`. Start the owner explicitly in a separate terminal; it stays in the foreground and does not auto-start or detach:

```bash
bin/wf daemon start
bin/wf workflow validate examples/overnight.yaml
bin/wf tasks preview examples/overnight.yaml
bin/wf workflow import examples/overnight.yaml
bin/wf workflow list
bin/wf run create --revision 1       # or: run create path/to/workflow.yaml
bin/wf run list
bin/wf run status RUN_ID --json      # includes expectedEventId
bin/wf run start RUN_ID --expected-event EVENT_ID
bin/wf run events RUN_ID --after 0 --limit 100 --json
bin/wf run pause RUN_ID --expected-event CURRENT_EVENT_ID
bin/wf run resume RUN_ID --expected-event CURRENT_EVENT_ID --reason "Continue from paused cursor"
bin/wf run stop RUN_ID --expected-event CURRENT_EVENT_ID --reason "End this run"
bin/wf daemon status
bin/wf daemon stop
```

`run create` freezes the checklist it actually reads and returns a ready run ID. Existing runs use that snapshot for start, resume and revision even if the original checklist is moved or removed. `workflow import` saves an immutable definition revision, including its original absolute source directory; `run create --revision ID` reads the current checklist at that saved location. Neither command executes stages. Start/resume acknowledge the run ID after admission; the daemon drives it independently of the client. Poll status for completion. There is no job queue or automatic continuation after restart. Starting/resuming an agent workflow invokes its configured harness/provider; the offline tests use fixtures only.

State selection is `--state-dir DIR` > `WF_STATE_DIR` > `${XDG_STATE_HOME:-~/.local/state}/workflowz`. The selected directory must belong to the current user with mode `0700`; a new one is created that way. It contains `state.sqlite`, SQLite WAL/lease files, `logs/` (attempt logs and adapter session artifacts), and private `daemon.json`. The daemon binds an ephemeral `127.0.0.1` port and atomically publishes a fresh owner-only token/port file (mode `0600`) after acquiring the database writer lease. Never publish that file. Competing owners fail without replacing it. Stale discovery does not authorize takeover: start a new owner explicitly; the kernel-backed lease decides ownership. The foreground terminal holds daemon diagnostics; no separate rotating daemon log/service manager is installed.

SIGINT, SIGTERM and `daemon stop` request pause-after-current and wait for the step, report channel and log streams to settle before releasing the database. `daemon stop` acknowledges the shutdown request; it does not wait for daemon exit. A stage without a timeout can delay shutdown indefinitely. `run stop` is the explicit process-tree termination action and waits for settlement. Client disconnect has no effect. On crash/reopen, uncertain runs become interrupted and no stage/report/signal is replayed.

Normal run controls use `--expected-event` from a fresh status inspection; recovery decision files carry the exact event/attempt cursor themselves. Changed state rejects the request; inspect again before making another decision. Resume requires paused state; interrupted runs first need an explicit recovery disposition. `run tasks RUN_ID`, `run reports RUN_ID`, and `run recovery RUN_ID` expose durable details. Events are ordered by increasing global `eventId`, filtered by run and exclusive `--after` cursor. `--limit` defaults to 100 (1–1000); JSON returns `{events,nextAfter,hasMore}`. No live event stream is added in this milestone.

Further controls:

```bash
bin/wf run override RUN_ID --expected-event EVENT_ID --request edit.json
bin/wf run task-overrides RUN_ID --task TASK_ID --expected-event EVENT_ID --request settings.json
bin/wf run revise RUN_ID --expected-event EVENT_ID --file revised.yaml --reason "Revise remaining steps"
# Add --cursor STEP_ID if the old cursor is incompatible.
bin/wf run reconcile RUN_ID --expected-event EVENT_ID
bin/wf run recovery-terminate RUN_ID --request recovery.json
bin/wf run recovery-confirm RUN_ID --request confirmation.json
bin/wf run recovery-decide RUN_ID --request decision.json
```

Override JSON is exactly one of `{"action":"jump","stepId":"review","reason":"Inspect next"}`, `{"action":"skip","outcome":"complete","reason":"Explicitly skip this stage"}`, or `{"action":"mark-task-complete","taskId":"TASK_ID","reason":"Accept task manually"}`. Task-settings JSON uses the existing `{overrides:{steps:{...}},reason}` contract; `{steps:{}}` clears settings. Revisions resolve relative paths against the original workflow directory. Controls preserve the coordinator's state, outcome, task-compatibility and unresolved-process checks.

Recovery files use the exact inspected `expectedEventId`, `attemptId` (null between steps), and reason described above. Confirmation additionally requires `confirmedNoSurvivingOperation:true` after independent cleanup. Decision adds `action` (`retry`, `continue`, `skip`, `jump`, `end`), plus the declared `outcome` or compatible `stepId` where required. Non-ending decisions leave the run paused for separate resume. A retained report never settles interrupted work.

Management `--json` writes one result to stdout or one `{error,...}` object to stderr. Success exits 0; validation/control/transport rejection exits 1; malformed CLI fields/options or unreadable input files exit 2. Human validation retains `file:line:column` diagnostics. `wf --help` lists commands. Use `wf report ...` with its existing report options, without management flags; its acknowledgment/exit behavior is unchanged. Management never accepts the attempt token.

### Browser preparation, editor and run dashboard (Phases 8.1–8.3)

```bash
npm run build
bin/wf daemon start             # foreground owner; keep this terminal open
# In another terminal, with the same --state-dir if selected:
bin/wf ui
```

Open the printed `http://127.0.0.1:PORT/ui/` address and paste the separately printed pairing code. Codes expire after five minutes and work once; requesting another invalidates the unused prior code. Pairing rotates the single browser session (12-hour lifetime); logout/restart revokes it. Do not publish codes or `wf ui --json` output. Browser and CLI/report authority are separate; daemon/report credentials never enter the page.

Select a saved immutable revision, upload a YAML workflow, or choose **New workflow in this directory** after entering its **original absolute directory** (browsers cannot reveal it). Choose the absolute project root, ordered instruction paths, optional checklist path and explicit prechecked inclusion. Selection changes update the canonical YAML draft. Preview is read-only. Save stores/reuses an immutable validated revision; import/create rereads the checklist into a **ready** run without starting anything. Relative instruction/checklist paths use the selected root. Reload resets unsaved inputs; saved revisions and runs remain in the daemon.

The stage list supports all five canonical kinds. Add stable IDs, select stages, apply their fields, reorder display independently of `start`/`goto`, and remove stages without silently repairing references. Agent fields include harness/model/reasoning, fresh/resume, inline/file prompt, instructions, report context, outcomes, cwd, tags and timeout. Commands use JSON argv/environment fields to preserve empty arguments, whitespace and exact strings. Controls configure direct transitions, defaults, all/tag/explicit-step policies, optional limits and report-correction settings. Effective normal/system transitions show compiler/router provenance, policy number and `system.error` fallback. No provider is called to edit or validate.

**Draft rules:** YAML text is authoritative. Apply a visual field group before leaving it; unapplied form fields are not part of the draft. Text input immediately freezes visual controls and save/create until **Validate YAML draft** completes for that exact text. Parse/schema errors retain the text and require YAML correction; shape-valid compile/path errors also permit visual correction. Diagnostics include code, model path and line/column where available. Invalid drafts cannot save/create. Delayed responses cannot overwrite newer text. Visual or project-selection edits serialize the canonical model and may normalize formatting, comments and schema defaults; validation/text-only saving preserves exact untouched text. Source files and historical revisions/runs are never rewritten.

Lists refresh explicitly. **Inspect** a run (newly created runs open automatically) for current task/stage, effective harness/model/reasoning, elapsed wall time including pauses, accepted report payloads and attention items with attempt IDs. Known imported queues show accepted completed tasks / total; empty queues show counts without a percentage. Graph-only runs never show a percentage. The selected run refreshes every two seconds using exclusive event cursors, 100 events per page, with at most the latest 300 fetched events displayed. Reload resets selection and unsaved drafts, not execution.

**Start**, **Pause after current**, **Stop now** and **Resume** control the daemon-owned run. Creating or inspecting never starts it. Pause waits for settlement and preserves the routed cursor; Stop now terminates the owned operation and waits for settlement, without rolling back files. Stop/resume require a reason. Controls use the last inspected event ID and reject stale or settling state. Rejections/transport errors stop refresh and disable execution controls until explicit **Refresh run**; no mutation is automatically retried. A timed-out operation may have committed: inspect lists and status before repeating it. Interrupted runs require the existing CLI recovery inspection/disposition before separate resume; the dashboard cannot bypass process/recovery barriers.

If the daemon is unavailable, start it explicitly and request a fresh pairing code; nothing auto-starts. Tab close/reload/disconnect never stops the daemon. Starting an actual agent workflow invokes its configured provider; Phase 8.3 verification uses disposable fake adapters only. Paused-run revision/manual intervention stays in 8.4, and the later browser suite in 8.5; the full Phase 8 gate and MVP remain incomplete. Exact Host/Origin checks, a separate HttpOnly SameSite cookie, JSON/custom-header requirements and CSP still protect the narrow local API. No recovery/edit/raw-log/filesystem-reading endpoints, dependencies or migrations were added; this is not isolation from same-user programs.

### Limits and stage retries (Phase 7.4)

Limits and retries remain optional workflow settings. For example:

```yaml
limits:
  max_step_executions: 120
  max_wall_time_seconds: 28800
  agent_idle_timeout_seconds: 300
# Inside an executable step's on mapping:
on:
  system.timeout: {retry: {max_attempts: 2, backoff_seconds: 5}}
```

`max_step_executions` counts committed transitions, including task primitives and skips. `max_wall_time_seconds` counts from the original run start, including pauses, downtime and retry waits. The remaining wall budget caps each command/agent/correction invocation; expiry requests process-group termination and pauses after confirmed settlement. Cleanup can take additional grace/reap time. Increase an exhausted limit through a paused revision before resuming; resume alone never resets it.

`max_attempts: 2` permits a retry only while the total logical executions of that step within the same task (or across a taskless run) is below two, including the first. Counts survive pause, revision and restart. Explicit `goto` loops remain governed by the graph and run limits. A stage retry creates a new attempt and follows the step's normal fresh/resume session policy. A report correction stays inside its original attempt, has its own 0-or-1 budget, and shares the remaining run wall budget. Harness-native retries remain inside their invocation.

Backoff starts at committed settlement. Status exposes `run.retryNotBefore`; the deadline and transition commit together. Pause/shutdown wake the wait promptly and preserve the deadline; explicit resume waits only its remainder. A crash during a wait still interrupts the run and requires a recovery decision plus resume. Cursor overrides, skips, stopping, or completing the active task cancel the pending wait. Revisions preserving the cursor retain it. No uncertain operation is automatically replayed.

Agent idle timeout measures silence on **both stdout and stderr**, starting at invocation launch and resetting on any bytes before redaction/capture limits. It terminates the owned group and routes `system.timeout` without report correction. An idle correction failure remains `system.report_error`. Commands have no idle timeout. Output is activity, not proof of useful progress; silent provider work can time out, and OpenCode's private API transport emits less activity than streaming CLIs. Leave this setting unset when that behavior is unsuitable.

### Codex adapter (Phase 6.1)

`await createCodexAdapter()` from `src/adapters/codex.ts` runs only offline version/help probes. Register the returned adapter as `new Map([["codex", adapter]])` in `RunService` options. The management daemon uses these same factories for the harnesses selected by an explicitly started/resumed workflow. Calling `drive` with this adapter launches the installed Codex and can use the configured account/provider.

The adapter uses stdin for prompts, JSONL for session/failure evidence, and `wf report` for authoritative outcomes. It waits for process-group/pipe settlement after terminal events. It resumes only explicit persisted UUIDs, passes model/reasoning effort, records CLI version and unrestricted permission mode in invocation events, and scrubs injected authorization from output. Per-invocation configuration keeps report environment available to tools, excludes the Codex API key from tool inheritance, and disables shell snapshots; global config files are never edited. The child inherits the existing common environment allowlist plus `CODEX_HOME` and `CODEX_API_KEY` when set. Other harness variables/credentials are withheld.

Current evidence: installed Codex `0.163.0` passes the full shared offline conformance suite and the authorized `gpt-6-luna`/low live report and exact-session correction scenarios. Real helper acknowledgment, provider framing, sequential settlement and durable reopen passed. Managed-config interactions beyond the exercised setup remain unverified. See [compatibility details](docs/harness-compatibility.md).

### Pi adapter (Phase 6.2)

`await createPiAdapter()` from `src/adapters/pi.ts` probes the installed CLI offline with a temporary Pi config directory and resource discovery disabled. Register it as `new Map([["pi", adapter]])` in `RunService` options. The installed package is `@earendil-works/pi-coding-agent` 1.3.0. Driving a real run can use Pi's configured provider/account.

Prompts use stdin with `--print --mode json`. The LF-only streaming parser waits for `agent_settled`, allows Pi's internal retries to recover, and still requires supervised process/group/pipe settlement. Final provider failures, aborts and malformed streams bypass report correction. Outcomes come only from `wf report`.

Each fresh invocation gets a dedicated persistent directory below `pi-sessions` beside the attempt logs (or adapter option `sessionDir`). Only a matching streamed UUID and persisted v3 session header can supply a resume identity. Resume validates that exact file and working directory, then passes its full UUID with its dedicated `--session-dir`; missing sessions fail instead of starting fresh. The same runner-owned correction limit applies. Direct adapter callers must supply `sessionDir` or `logPath`.

Model and thinking level use `--model` / `--thinking`. Normal Pi tools use no permission flag; invocation events record the CLI version and `default-unrestricted-tools`. Runtime environment selects the base allowlist, Pi config/offline/telemetry settings, explicit provider credentials and report access; injected secrets are scrubbed. No global config is edited. Pi `1.3.0` passes the full shared offline suite and the authorized `openai/gpt-6-luna`/low live report and exact-session correction scenarios, including helper acknowledgment, sequential settlement and durable reopen. See [compatibility details](docs/harness-compatibility.md) for exact evidence and limits.

### Claude Code adapter (Phase 6.3)

`await createClaudeAdapter()` from `src/adapters/claude.ts` probes version/help with temporary home/config and no provider credentials. Register it as `new Map([["claude", adapter]])` in `RunService` options. Driving a real run uses Claude's configured provider/account and can incur usage.

The adapter sends prompts through stdin with `--print --input-format text --output-format stream-json --verbose --permission-mode bypassPermissions`. Optional model and validated effort use `--model` / `--effort`. A successful terminal `result` and supervised process/group/pipe settlement are both required. Protocol/provider errors bypass report correction; only `wf report` supplies outcomes.

Default CLI session persistence stays enabled. The terminal UUID is the opaque session identity; resume passes only that exact UUID to `--resume`, with no recent-session selector, fork or fresh fallback. Unavailable sessions and mismatches fail explicitly. CLI version and `bypassPermissions` are audited. Runtime selects the base environment plus Claude config, explicit Anthropic auth/provider settings and report access, scrubbing injected tokens/keys. No global config is edited.

The installed version is 2.1.303. Its offline missing-UUID check confirmed failure without a provider request. All shared synthetic conformance tests pass. Authorized live direct reporting and the separately approved exact-session correction with requested `claude-haiku-5-5`/low both passed: streamed/terminal model evidence matched, real helper acknowledgment and durable reopen succeeded, and settled targets were removed. Correction used exactly two sequential invocations and the same persisted session, closing milestone 0.5. See [Claude correction evidence and limits](docs/harness-compatibility.md#authorized-claude-correction--milestone-05-complete).

### OpenCode adapter (Phase 6.4)

`await createOpenCodeAdapter()` from `src/adapters/opencode.ts` probes the v2 CLI offline with isolated home/config. Register it as `new Map([["opencode", adapter]])` in `RunService` options. Driving a real workflow can use the configured provider/account and incur usage.

OpenCode v2.0.32's `run --session` creates missing sessions, so this adapter deliberately uses the supported private API path: an invocation-local `serve --stdio --hostname 127.0.0.1 --port 0` child, owned by the common process supervisor. The bridge holds its stdin lease until execution ends. It neither starts nor changes the shared background service. Prompts travel through bridge stdin and exact-session API admission, never argv. Missing sessions, including deletion between lookup and admission, fail without creating a replacement.

After prompt acknowledgment, the adapter waits for idle and verifies matching identity/cwd, a fresh persisted idle timestamp and `outcome: succeeded`. Terminal evidence and reports still cannot settle the process; lease shutdown, exit, group reaping and pipe closure are required. API/readiness/protocol failures bypass correction. This minimal API path captures bounded invocation evidence and server diagnostics, not provider text/tool event streams; `supportsEventStream` is false.

Model selection accepts `provider/model#variant`; `reasoning_effort` selects a named variant when an explicit unqualified model is supplied. Supplying both a model variant and reasoning effort is rejected rather than silently choosing one. Session-level `{action: "*", resource: "*", effect: "allow"}` rules select unrestricted permissions and are audited as `session-allow-all`. Unlike CLI `--auto`, these rules override denials for this session; global settings are unchanged. The private lease password and known injected provider/report credentials are scrubbed.

The synthetic CLI passes the full shared conformance suite. Installed offline checks verified create-if-missing CLI behavior, non-creating exact API resume failure and terminal invalid-provider failure. Live direct reporting with requested `openai/gpt-6-luna`/low passed earlier; the subsequent authorized `meta/muse-spark-1.3-contributor`/low pass completed both direct reporting and exact-session correction, including helper acknowledgment, sequential settlement, durable reopen and target cleanup. Actual provider-model usage is not exposed by this transport. Earlier normal MCP startup diagnostics exposed an unknown configured credential in private logs, confirming the scrubber limit; do not publish raw artifacts. See [Meta live results](docs/harness-compatibility.md#authorized-meta-contributor-live-results).


### omp adapter (Phase 6.5)

`await createOmpAdapter()` from `src/adapters/omp.ts` performs isolated offline version/help probes. Register it as `new Map([["omp", adapter]])` in `RunService` options. It targets installed `@oh-my-pi/pi-coding-agent` **18.12.2**, reusing the Pi-family process/report implementation while keeping harness identity `omp`. Driving a real workflow can use configured providers and incur usage.

Launch uses stdin with `--print --mode json --approval-mode yolo`, optionally `--model` / `--thinking` (including omp's `auto`). Unlike Pi, omp emits no `agent_settled`: final assistant evidence and `agent_end` with `isTerminal: true` are required, followed by successful process/group/pipe settlement. Native retries and `auto_compaction_*` can recover; final provider/protocol failures bypass correction. Only `wf report` supplies outcomes.

Dedicated persistent directories live under `omp-sessions` beside logs, or explicit `sessionDir`. The durable identity is an absolute journal path with matching UUID/header/cwd; the reader accepts omp's leading title slot. Resume passes that exact path to `--resume`, whose installed strict-open branch cannot create an absent file. Prefix/UUID/global/latest selectors, restore and forks are not used. Moved-away transcripts are refused before launch because omp otherwise forks them. Journals with malformed, truncated or over-1-MiB records are unavailable rather than partially trusted.

Version and `yolo` are audited; explicit tool/user denials and provider safety policies still apply. Deliberate environment selection and common known-secret scrubbing preserve report access without changing global configuration. The full shared offline suite and independent service/deletion-race smokes pass. Installed isolated startup needed an empty-schema fixture for its earlier fresh-database failure; no workaround was added. The earlier `openai/gpt-6-luna` report failed native credential resolution and was not retried. The owner then explicitly selected Meta Contributor and authorized a new bounded pass: `meta/muse-spark-1.3-contributor`/low direct reporting and exact-session correction both passed, with matching streamed assistant provider/model fields, real acknowledgment, settlement, durable reopen and target cleanup. The named local key source is now reusable through `smoke:meta`. See [Meta live results](docs/harness-compatibility.md#authorized-meta-contributor-live-results).

### Installed capability preflight (Phase 6.6)

Each async adapter factory returns a frozen `adapter.capabilities` snapshot for its selected executable and implemented transport, alongside `adapter.compatibility` version evidence. `npm run probe:harnesses` calls these same isolated factories; it does not maintain a separate flag table. Failed/truncated required probes reject construction. Missing optional resume/model/reasoning selectors disable those features while preserving supported fresh execution. Codex still requires config support for its invocation environment settings; its resume model selector is checked separately.

The compiler uses static registry capabilities, including reasoning-effort support, without spawning CLIs. The headless service checks the selected adapter's snapshot when preparing each effective attempt, including frozen task settings and revised workflows. A requested unsupported model/reasoning selector fails with `system.spawn_error`; unsupported explicit resume fails with `system.resume_unavailable`. Errors identify the feature and harness, are recorded with the failed attempt/attention item, and start no provider execution or report correction. Adapter-authored invalid-option/session errors also retain useful explanations; unexpected exceptions remain generic. This runs immediately before the affected attempt, rather than rejecting every possible future graph branch at run creation.

Resume capability does not establish that a particular session exists. Existing adapter-specific journal/API/CLI admission checks still enforce exact identity, cwd and no fresh fallback. Missing optional correction support never prevents fresh work; a clean missing report then follows the existing `system.report_error` policy without launching correction. Recreate adapters after changing/upgrading a CLI: snapshots do not continuously re-probe or attest to a binary that changes afterward.

OpenCode's effective event-stream capability stays false. All current transports report structured-final-output support as false because the common report path is exclusively `wf report`; a harness's CLI schema flag alone does not implement a report fallback. No workflow fields, migrations, provider calls or approval gates were added. `npm run smoke:capabilities` independently exercises required-feature rejection, model preflight, supported fresh work, disabled correction and unsupported workflow resume, including SQLite reopen. Authentication/live-session/tool-environment checks remain separate work.

### Adapter environment and logs (Phase 6.7)

Every runner-owned adapter/probe child receives an explicit selected environment. OpenCode reselects the same environment for its nested private server. Existing harness configuration/authentication names and unrestricted permission modes are preserved; ordinary commands still receive the base allowlist plus every user-authored `env` override.

Known injected credentials and report tokens are scrubbed before streaming observation, capture and capped disk logs, including canonical JSON/URL/Base64 forms and OpenCode's private Basic authorization. Known adapter credentials and retired report tokens remain redaction-only memory until the report channel closes; submissions containing these values are rejected before persistence. Invocation-settled events retain a scrubbed stderr head of at most 4 KiB plus capture-truncation flags. The existing 64 KiB stdout/stderr captures and 16 MiB combined stream logs retain useful session/terminal evidence; correction has its own `.log.correction` file. `npm run smoke:boundaries` independently exercises reporting, correction and provider failures through synthetic local CLIs, without providers.

Environment selection is not isolation. Scrubbing recognizes known injected values and specified representations, not every unknown secret or arbitrary transformation. Harness-managed files, tool inheritance, resources and live provider behavior remain outside this offline guarantee. Exact selections, bounds and remaining limits are in [harness compatibility](docs/harness-compatibility.md#environment-and-diagnostic-boundary-audit-phase-67).

### Opt-in authenticated harness smoke (Phase 6.8)

`npm run smoke:harnesses -- ...` requires one explicit harness, model, scenario, timeout and absolute artifact parent. Without `--execute`, it prints a plan **without probes, authentication checks, smoke artifact writes or provider calls**; npm still builds `dist/` first. Live execution is never invoked by builds, `npm test`, `npm run check` or offline capability probes.

```bash
npm run smoke:harnesses -- --harness codex --model gpt-6-luna \
  --reasoning-effort low --scenario report --timeout-seconds 60 \
  --artifacts-dir "$HOME/.local/state/workflowz/live-smoke"
# Add --execute only after authorizing provider usage for that exact selection.
```

Account preference for GPT smoke runs: Luna (`gpt-6-luna`, or `openai/gpt-6-luna` in Pi) with `--reasoning-effort low`. Do not upgrade models or raise reasoning automatically; other users' explicit workflow selections remain unchanged.

`report` allows one harness invocation and disables correction. `correction` deliberately requests a clean first turn without a report, then requires exactly one same-session report-only correction (at most 30 seconds). The agent runs a disposable helper that invokes the real `wf report`; success requires its acknowledgment marker, the exact durable report, clean sequential settlement, persisted session identity and SQLite reopen. An accidental original report cannot pass the correction scenario.

Normal HOME/auth/config/resource discovery and existing unrestricted permissions remain enabled: this is **not isolation** and may incur charges. Codex/Pi/Claude status checks discard their output and never log in or print credentials; Pi disables status-time OAuth refresh. OpenCode/omp record `status_unsupported`, not a fabricated authentication pass. No dollar cap is enforced; the timeout bounds supervised execution, not billing, native retries or external side effects.

Each execution retains private `evidence.json`, SQLite and existing bounded scrubbed adapter logs under a unique `wf-<harness>-<scenario>-*` artifact directory. Evidence includes version, capabilities, permissions, selected model/effort, authentication status, outcome, invocation/correction counts and session fingerprints—never raw handles/report access. Settled target projects are removed; uncertain cleanup preserves them and fails. SIGINT/SIGTERM stop through `RunService`. Harness-owned state/transcripts are not copied, rewritten or removed; known-value scrubbing cannot recognize unknown secrets.

The offline smoke tests exercise all five actual factories through synthetic CLIs. **The Phase 6 gate passed with live Codex/Pi Luna/low reporting and exact-session correction. The later authorized Meta Contributor/low pass verified omp/OpenCode reporting and exact-session correction, and Claude Haiku/low correction closed milestone 0.5 after its earlier direct-report success. The offline gate at that milestone passed 704 tests.** See [Claude completion evidence](docs/harness-compatibility.md#authorized-claude-correction--milestone-05-complete), [Meta live evidence and limits](docs/harness-compatibility.md#authorized-meta-contributor-live-results) and the [implementation log](docs/implementation-log.md) for subsequent offline recovery verification.

The earlier [Claude/OpenCode/omp pass](docs/harness-compatibility.md#remaining-milestone-05-results--stopped-at-omp-authentication) stopped at omp's missing OpenAI credential; that failure remains historical evidence, not a reason to ask for an OpenAI key again. Future paid execution still needs explicit bounded authorization. Requested selectors are not a guarantee against native substitution. OpenCode's earlier private diagnostic log exposed an unknown configured MCP credential; do not publish raw artifacts.

#### Standing local smoke selection: Meta Contributor

The owner selected **`meta/muse-spark-1.3-contributor` / low** for OpenCode and omp, using **`MUSE_SPARK_API_KEY` in `~/.config/secrets.zsh`**. Reuse that approved source; do not ask the owner to paste, relocate or rediscover the key. Contributor mode permits Meta to use submitted prompts/code/responses for training. This supersedes the earlier OpenAI/Luna proposal for these two harnesses, not Codex/Pi preferences or other users' workflow settings.

```bash
npm run smoke:meta -- --harness omp --scenario report --timeout-seconds 60 \
  --artifacts-dir "$HOME/.local/state/workflowz/live-smoke-meta"
# Plan only. --execute still requires approval of the exact live scenarios/bounds.
```

`smoke:meta` pins that account selection and reuses the existing smoke/runner, not a new provider client. Only execution reads the one named literal assignment; the shell file is never sourced and its other credentials are not imported. The source must be an owner-only regular file; missing/ambiguous/expanded assignments fail without credential output or fallback. The key is mapped to `MODEL_API_KEY` only in adapter memory/environment, not global environment, argv, configuration or evidence. OpenCode receives a credential-free v2 Meta Responses configuration inside the disposable target, including the low variant and encrypted reasoning replay; global settings are unchanged. Both adapters forward/scrub `MODEL_API_KEY` and `META_API_KEY` through their existing known-secret boundary. Normal resources remain enabled: not isolation or an all-secrets guarantee. See [standing decision and authorization limits](docs/harness-compatibility.md#standing-meta-contributor-selection-and-secret-source).

**Live verified:** both harnesses passed the authorized direct-report and exact-session correction scenarios using this source. All four workflows completed with actual helper acknowledgment and durable reopen; all settled targets were removed. omp assistant metadata matched the Contributor model; OpenCode's transport cannot independently attest actual provider-model usage. No key/setup action is needed from the owner.

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
