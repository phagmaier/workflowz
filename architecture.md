# Technical Architecture — Agent Workflow Runner

**Status:** MVP design contract  
**Read first:** [Product specification](spec.md)

## 1. System overview

```text
                   Local browser UI
                         |
                   HTTP / SSE / API
                         |
   wf CLI --------> LOCAL RUNNER <--------- control CLI
   (reports)           |  |
                       |  +-- SQLite run state and durable event log
                       |
                  Workflow compiler
                  + route evaluator
                       |
                 Sequential dispatcher
                       |
         +-------------+------------+-------------+
         |             |            |             |
   Harness adapters  command exec  task primitives
   codex pi omp opencode claude
         |             |            |             |
         +-------------+------------+-------------+
                       |
              Project working directory
```

A **single local daemon process** owns orchestration and event storage. The browser is not required for the daemon to run. The report CLI is a thin client. One active stage attempt at a time per run, and **one active run globally in MVP** (multiple saved runs can be inspected). A global single-run limit prevents accidental repository collisions and simplifies recovery. Later, allow separate independent runs after workspace isolation is designed.

### 1.1 Packages / modules

- `packages/contracts`: strict types and schema validation; no web/runtime imports.
- `packages/engine`: graph compilation, policy resolution, task scheduler, transition reducer, state machine, persistence interfaces.
- `packages/adapters`: process wrapper; harness adapters (Codex, Pi, omp, OpenCode, Claude Code) and the command executor, plus the harness registry.
- `apps/runner`: daemon, run service, local HTTP API, CLI report endpoint, event publishing.
- `apps/cli`: `wf` commands for creating/validating/starting/observing/reporting/pausing/resuming runs.
- `apps/web`: local UI; only after headless integration works.

Monorepo packages are optional organizational boundaries; use a single repository and avoid distributed services or an internal microservices architecture.

## 2. Durable state model

SQLite is authoritative. Store DB and run artifacts under a user-level application state directory, not inside the target project repository, e.g. `${XDG_STATE_HOME:-~/.local/state}/agent-workflow/`. The project contains only user-authored workflow files and optional input docs. File paths stored in DB should be absolute or normalized at run creation.

**Tables (conceptual; normalize fields sensibly):**

| Table | Core columns | Invariants |
| --- | --- | --- |
| `workflows` | workflow_id, name, file_path, created_at | Workflow identity |
| `workflow_revisions` | revision_id, workflow_id, definition_yaml, definition_hash, created_at | Immutable revisions; a run references one |
| `runs` | run_id, current_revision_id, project_root, status, cursor_step_id, active_task_id, created_at, updated_at, start_time, end_time | One authoritative status and cursor per run |
| `tasks` | task_id, run_id, source_order, source_identity, title, body, heading_path, state | Imported snapshot, source order fixed absent manual update |
| `attempts` | attempt_id, run_id, step_id, task_id nullable, revision_id, sequence_no, session_id nullable, pid/pgid nullable, process_identity, status, started_at, finished_at, exit_code, error_code | Exactly one active attempt globally |
| `reports` | report_id, attempt_id UNIQUE, outcome, summary, issue, handoff, data_json, received_at | At most one **accepted** report per attempt |
| `events` | event_id AUTOINCREMENT, run_id, attempt_id nullable, type, data_json, timestamp, revision_id | Append-only event stream; correlate transition commits |
| `attention_items` | item_id, run_id, attempt_id nullable, category, severity, message, resolution, resolved_at | Human tasks and failures |
| `task_overrides` | task_id, overrides_json | Current run-local parameters for an imported task; previous values in audit events |
| `attempt_inputs` | attempt_id, input_json | Immutable prepared agent input, without report authorization |
| `run_variables` | run_id, key, value_json, updated_at | Bounded explicit variables only, if needed |

Use foreign keys and DB constraints. Prefer WAL with bounded busy timeout. Transactions wrap transitions, completion of task state, and cursor updates. Event entries accompany state mutations within the **same transaction**, so a state advance and its log cannot disagree.

### 2.0 Phase 2 implementation notes

These record the adjustments made when the store was built (todo Phase 2). The rationale is given so later changes can be judged against it.

- **Storage.** `node:sqlite` (built into Node) with `PRAGMA user_version` migrations. The migration file is append-only. Each run's writes go through `WorkflowDatabase.transaction`, which uses `BEGIN IMMEDIATE`. Nested calls join the outer transaction; any inner failure makes the whole transaction rollback-only, even if its caller catches the error.
- **Extra table: `transitions`.** Every routing decision is one row, with `revision_id`. `attempt_id` is UNIQUE, so the database itself forbids two transitions for one attempt. Engine-only steps have `attempt_id` NULL.
- **One active run and attempt.** Transactional coordinator start/resume checks reject a second running or pausing run. A database unique index on `(status IN (active states))`, restricted to active attempts, independently allows at most one active attempt across the whole database. These guards do not replace the daemon instance lock planned in todo 7.1.
- **Single writer.** `RunCoordinator` is the only code that changes run state. For each step it reads the run, decides with the pure reducer (`engine/reducer.ts`), and writes the decision with its event in one transaction. A settlement with an undeclared outcome is refused before any write (spec §4.2). Compiled cache entries use definition hash and source directory, not revision ID alone: rolled-back SQLite revision IDs can be reused.
- **Retries.** A `retry` action reruns the step while its attempt count within the current task is below `max_attempts`. The count includes the attempt that just settled. When the budget is spent, `system.retry_exhausted` routes and is recorded as the transition outcome; the attempt settlement event preserves the originally observed outcome. If the exhaustion route also asks for a retry, the run pauses. Backoff is recorded but not waited on yet (todo 7.4). Engine-only steps do not retry; a retry there pauses the run.
- **Limits.** `max_step_executions` counts committed transitions. `max_wall_time_seconds` counts elapsed time since the run started. Reaching either pauses the run with an attention item. A separate consecutive-engine-step bound blocks only another engine primitive, not completion, external dispatch, or a pause already reached at the boundary.
- **Clock and ids are injected.** Tests use a deterministic clock and ids. Production uses wall-clock time and random ids.

### 2.1 State reducer

The engine should implement a pure function or similarly deterministic reducer:

```ts
nextState = transition(currentState, acceptedOutcome, compiledWorkflow, context)
```

The reducer must not launch processes, interpret English, read arbitrary files, or call models. It returns an action proposal (dispatch step, pause, retry, finish, etc.); the coordinator persists that decision and only then carries out external effects.

**Prepare/dispatch lifecycle:**

1. Transactionally persist `attempt=starting` with step, revision, and execution intent.
2. Start the child process; record PID/PGID and session identity if available.
3. Stream runtime events to append-only structured log and persist bounded index/summary in DB.
4. Await reliable end of execution, including adapter-specific settle boundary.
5. Validate report; potentially perform the one correction turn; normalize to an outcome.
6. Transactionally mark attempt final, apply chosen transition, update cursor/task state, and append event. If pause-after-current was requested, persist that pause in the same transaction, preserving the routed cursor.
7. Dispatch next stage if run remains running and not pausing.

A crash may happen between (1) and (2), or between (2) and (4). On restart treat incomplete attempts as **uncertain** until process reconciliation; never assume a command did not run just because it lacks a final DB result.

### 2.2 Exactly-once limitations

The engine can guarantee **at most one committed transition for each finalized attempt** through DB uniqueness/transaction rules. It cannot guarantee exactly-once external side effects from arbitrary shell commands, provider calls, or Git pushes. It must not automatically replay an interrupted external operation. This is especially important with unrestricted agent tools.

## 3. Workflow compilation and routing

Parse YAML with the core schema, reject duplicate keys, unsupported tags and silently discarded entries, normalize paths, validate the schema, and compile a graph with node map and effective outcome mapping. Referenced-path validation checks the project root is a directory as well as checking input paths. Freeze workflow revision for a run.

**Policy resolution:**

1. Resolve the **exact** outcome in this order: stage-specific `on`; matching explicit-step-ID policies; matching tag policies; matching all-step policies; `defaults.on`.
2. If this is a `system.*` error with no exact match, resolve `system.error` in the **same** order, then implicit `pause`.
3. Equal-precedence overlapping rules with different actions are invalid at compile time.

**Nuance:** `system.error` serves as a *catch-all* for engine errors, not normal agent outcomes. A normal declared agent outcome must resolve to an explicit rule at level 1–3 or validation fails. A step with custom `outcomes: [complete, blocked]` cannot accidentally route an unrecognized `unknown` result by `system.error`.

Graph diagnostics follow effective normal and system-error routes. Terminal `end` steps have no outgoing edges, even when global policies contain transitions. Transition and step lookup uses own properties only, so names such as `constructor` cannot inherit JavaScript object members.

A step attempt has an **input snapshot**: task, project root, prompt, instruction paths, variables, selected preceding reports, working directory, effective outcomes/transitions, harness, model, and timeout. Its accepted report is immutable. Run-specific task overrides are saved alongside imported run-local task IDs; reusable YAML workflows do not depend on project-specific task IDs. Its execution may produce files in the target project, which remain external side effects.

### 3.1 Task loop semantics

- `task.next` selects the next queued task in imported order; if exhausted, emits `exhausted`. The task remains active across subsequent agent, command, and review steps.
- `task.complete` marks the active task complete only after configured workflow has reached that step; it clears active task and emits `complete`.
- If a task is blocked and run is paused, it remains active. Resume may retry current stage, jump to another stage, or mark task complete through a manual action. No implicit skip.
- Reentering `task.next` while an active task exists is an engine error, not a way to silently discard it.
- Engine-owned task progress is independent of `todo.md` modification by agents.

### 3.2 Phase 5 task import and context implementation

`RunService.createRun` is the filesystem entry point for Markdown import; `previewTasks` is read-only. The coordinator retains its supplied-task seam for fixtures. Migration 4 stores immutable source text/hash/import settings and per-task source positions/check state, transactionally with task rows and the import event. The parser preserves separate nested checkbox tasks and heading ancestry without deriving dependencies. File edits never update the active queue.

At attempt preparation the runner reads configured instruction content, resolves explicit placeholders and adds the current task plus only selected reports from the same run/task. Missing selected history is omitted until produced; missing explicit placeholder values or instruction files fail before launch. Migration 5 stores the exact assembled agent input once per attempt with an `attempt_prepared` event in the same transaction. Report tokens are generated afterward and never enter that snapshot. Per-task parameters and paused revisions are implemented as described below. Re-import remains unimplemented.

### 3.3 Run-local parameters and paused revisions (Phase 5.5)

Strict contracts live in `contracts/run-configuration.ts`; pure task specialization and revision-cursor checks live in `engine/run-configuration.ts`. The coordinator validates edits and writes their state and audit events in the same transaction. Its service API accepts edits only for `ready` or `paused` runs without an active attempt. Interrupted runs require an explicit recovery decision before configuration editing.

Migration 6 appends `task_overrides` and an immutable `attempts.task_overrides_json` dispatch snapshot; migrations 1–5 are unchanged. Task edits replace one unfinished task's settings and record both previous/new values and reason. Specialization changes only existing executable steps' model/prompt, selected transitions and explicit skip outcome. The ordinary compiler validates the resulting document. Effective configuration for preparation and settlement comes from the attempt's revision plus its frozen parameters. Base YAML never contains imported task IDs. Agent input now carries model/reasoning effort to the adapter and records them plus harness in its prepared snapshot; old snapshots remain unchanged.

Configured skips emit `step_skipped` and a null-attempt transition without a process/report. They use engine-only routing, so a retry on a skip pauses. They count toward the consecutive engine-step limit. Task activation/completion remains controlled by the reusable graph; skipping a stage does not imply completing its task. Manual step skip also uses effective task routing.

Definition revision validates the whole replacement YAML plus every unfinished task's settings before changing the run's revision/cursor and writing `workflow_revised`. Project root and normalized task source cannot change in this slice. Completed task settings remain historical even if their step no longer exists. Imported task IDs, source snapshot, states, active task, execution counters, reports, old revisions, input snapshots and attempt/transition revision associations remain intact. A removed or kind-changed cursor requires an explicit compatible target; task-control and statically visible task-placeholder preconditions are checked by a pure function. File-dependent values are checked at preparation as before. Edits affect subsequent occurrences of loop stages, never historical executions.

Session lookup still requires the same harness, run, task and revision. Parameter edits within a revision preserve this rule. New definition revisions cannot use another revision's persisted session; `session: resume` without a matching identity fails before launch. Exact YAML/source-directory matches reuse the existing content-addressed revision identity, preserving the original deduplication and session rules.

## 4. Agent adapter interface

Keep the first interface small, with typed input/output and event callbacks; do not make adapters aware of workflow transition logic. Every supported harness is an adapter keyed by a stable `harness` id (`codex`, `pi`, `omp`, `opencode`, `claude`); the engine and workflow schema refer to harnesses only by that id, so adding an adapter must not require engine changes.

```ts
interface AgentAdapter {
  readonly id: HarnessId; // open registry: 'codex' | 'pi' | 'omp' | 'opencode' | 'claude' | ...
  probe(): Promise<AdapterCapabilities>;
  start(input: AgentInput, sink: EventSink): Promise<AgentHandle>;
  resumeForReportCorrection(
    handle: AgentHandle,
    correctionPrompt: string,
    sink: EventSink
  ): Promise<AgentHandle>;
  stop(handle: AgentHandle, options: StopOptions): Promise<void>;
}

interface AgentInput {
  attemptId: string;
  cwd: string;
  prompt: string;
  harnessModel?: string;
  reasoningEffort?: string;
  sessionPolicy: 'fresh' | 'resume';
  priorSessionId?: string;
  timeoutMs?: number;
  reportContract: { allowedOutcomes: string[]; schemaVersion: 1 };
  reportEndpoint: string;
  reportToken: string;
  permissionMode?: string;
}

interface AgentHandle {
  pid?: number;
  processGroupId?: number;
  sessionId?: string;
  completed: Promise<AgentProcessResult>;
}

interface AgentProcessResult {
  exitCode: number | null;
  signal?: string;
  settled: boolean;
  errorCode?: string;
}
```

Exact signatures may change, but responsibilities cannot: adapter handles harness-specific launch/session/streaming; runner validates reports, stores state, routes outcomes.

A **harness registry** maps `HarnessId` to an adapter factory. Workflow validation resolves `harness` against the registry and reports a clear "unknown or unsupported harness" error instead of failing an enum. The registry is a lookup table, not a plugin system; dynamic third-party plugin loading is deferred (see [spec.md](spec.md) §8).

Adapter responsibilities are uniform across harnesses; only the four harness-specific behaviors below differ:

| `HarnessId` | Headless launch | Event/settle source | Correction resume | Capabilities to verify |
| --- | --- | --- | --- | --- |
| `codex` | `codex exec` | JSONL via `--json`; final message + process exit | `codex exec resume` | resume, event stream, structured output, permission mode, model selection |
| `pi` | `pi --print --mode json` / `--mode rpc` | LF-delimited JSONL/RPC; `agent_settled` | resume by persisted session id/path | resume, event stream, permission mode, model selection |
| `omp` | `omp --print --mode json` / `--mode rpc` | Pi-family JSON/RPC framing | `--resume <id>` / `--continue` | verify against installed fork |
| `opencode` | `opencode run --format json`, or `serve` + SDK/SSE | one-shot JSON, or session wait-for-idle | `--session <id>` (create-or-continue) | resume, event stream, permission mode, model selection |
| `claude` | `claude -p --output-format stream-json` | stream-json lines; terminal `result` message | `--resume <session-id>` | resume, event stream, permission mode, model selection |

Every adapter must pass the offline **adapter conformance suite** (see §9) before it is registered as supported. Adapters must also pass the child process only a deliberate environment allowlist, never the daemon's full environment, so nested-harness variables and credentials cannot leak between harnesses.

### 4.1 Codex integration

Start with the **non-interactive Codex CLI**, not direct API calls. Capture JSONL events and CLI exit status; extract/persist the session ID from documented events; support normal work and same-session follow-up for correction. Check locally installed flags/version at integration time.

Codex docs describe `codex exec` headless mode, JSONL through `--json`, `--output-schema` structured final responses, and `codex exec resume` for continuing sessions. They also document permission configuration, including unrestricted modes. Structured output may be used as a fallback, but `wf report` remains the common contract. Do **not** assume the first JSONL agent-message item is the final completion boundary.

**Official references:**

- https://learn.chatgpt.com/docs/non-interactive-mode
- https://learn.chatgpt.com/docs/cli/reference
- https://github.com/openai/codex

Version-specific behavior is a risk. Use executable compatibility tests against the user's installed Codex version and avoid pinning assumptions in the workflow file.

### 4.1.1 Phase 6.1 implementation

`adapters/codex.ts` provides an async offline-probed factory and an executable `AgentAdapter`. It uses the common supervisor with stdin prompt delivery and a scrubbed continuous stdout observer. `codex-events.ts` independently decodes bounded LF records across UTF-8 chunks, captures explicit UUID identity and terminal/failure evidence, and never extracts reports. Completion still requires the supervised process/group/streams to settle. Parser/provider failure on an otherwise clean exit bypasses report correction; clean missing report/session behavior continues through existing runner rules. Resume requests never select the latest session or silently start fresh.

The adapter forwards model/reasoning effort, injects the existing report channel and project-local `wf` PATH, and records CLI version/unrestricted mode in invocation-start events. Only base environment plus Codex home/key and report access are selected. Per-invocation config preserves report environment for tools, excludes the API key from their inheritance, and disables shell snapshots; it does not edit global files. No schema migration or workflow control change is needed. Raw scrubbed events use the existing bounded attempt log.

Codex registry status is `conformance_passed` after the full shared offline suite passes against a fixture CLI. Real account/provider framing and resume remain unverified; Phase 0.5 and the live Phase 6 gate remain open. Pi is the next adapter. See `docs/harness-compatibility.md` for official sources, installed-version evidence and limitations.

### 4.2 Pi integration

Start with the **Pi headless CLI** (`--mode json` for one-shot turns, or `--mode rpc` for a long-lived session/correction). For a TypeScript runner, RPC isolates Pi in a child process and exposes structured events; the SDK is optional later. Check the exact user's Pi fork/package before coding against a hardcoded import name.

Pi JSON/RPC streams are strict LF-delimited JSONL. Read with a UTF-8 byte stream decoder, split **only on byte `\n`**, and consume continuously to avoid pipe backpressure. Distinguish `agent_end` (potentially followed by automatic retries) from `agent_settled` (run fully quiescent). Capture the persisted session ID/path needed to send a follow-up correction turn. The agent is allowed full tools according to the user's configured Pi setup.

**Project references:**

- https://github.com/badlogic/pi-mono (verify currently installed fork)
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md (JSON mode reference of a Pi fork)
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md (RPC mode reference of a Pi fork)

### 4.3 Claude Code integration

Claude Code is driven headlessly with `claude -p` and a machine-readable stream: `--output-format stream-json` (which also requires `--verbose`) emits one JSON object per line, starting with an init event that carries the session id; the terminal `result` message also carries `session_id` on every result regardless of success or error. Capture that id and resume the same session with `--resume <session-id>` for the single report-correction turn. Keep session persistence enabled (`--no-session-persistence` would break correction). Permission selection uses `--permission-mode`, or an explicitly configured bypass flag; the adapter must surface which mode was chosen rather than silently assuming one.

### 4.4 OpenCode integration

OpenCode offers two viable integrations. The simple path is a one-shot `opencode run --format json` child process with `--session <id>` (which creates the session if it does not exist) so the correction turn can attach to the same session. The richer path is a long-lived `opencode serve` instance driven through its REST/SSE API or the generated SDK: session create, prompt, and an explicit wait-for-idle, which yields cleaner structured events, process isolation, and an unambiguous settle boundary. Prefer the long-lived path if the one-shot stream proves an unreliable settle boundary; it is not required for MVP. Permissions use `--auto` or the configured approval behavior.

### 4.5 omp integration

`omp` (oh-my-pi) is a Pi-family harness: it uses the same `--print` non-interactive mode and `--mode json|rpc` output framing as Pi, and resumes with `--resume <id>` or `--continue`. The Pi adapter should therefore cover `omp` as a distinct `HarnessId` variant with launch/capability differences rather than a from-scratch implementation; verify the installed fork's exact flags instead of assuming parity.

### 4.6 Harness capabilities and graceful incompatibilities

Adapters report capabilities: `supportsResume`, `supportsStructuredFinalOutput`, `supportsEventStream`, `supportsPermissionMode`, `supportsModelSelection`. Preflight errors if a workflow requires unsupported capabilities (e.g., `session: resume` without a valid session). For *report correction*, if resume is unavailable at runtime, immediately route `system.report_error` and pause by default. Avoid inventing brittle alternative behavior such as prompting a new independent model to infer what the first agent meant.

## 5. Reporting channel

`wf report` talks to the local daemon using a loopback HTTP endpoint (reused from the local UI API), authenticated with an **attempt-scoped opaque token** passed to the child environment. The token authorizes only *report submission for that attempt*, not run control or arbitrary DB modification. `wf report` always waits for server acknowledgment.

- `POST /internal/reports` payload: `{outcome,summary,issue?,handoff?,data?}`.
- Validate attempt token, active attempt, schema version, length limits, outcome membership, and report uniqueness.
- Persist accepted report with a UNIQUE constraint on attempt ID. Reply `201` with accepted metadata. Invalid outcome/malformed data: `422` with allowed values; already accepted: `409`. Expired/stopped attempt: `409` or `410`.
- Reading a report does not transition the workflow. Only the runner's process-settle handler finalizes attempts.
- Keep the endpoint on loopback, avoid leaking token in args, URLs, logs, or UI.
- `--handoff-file` causes the CLI to read that file and submit bounded text; the engine records the content, not merely an ephemeral path to an agent temporary directory.
- Ignore or reject model-supplied authoritative IDs: run/attempt identity comes only from token lookup.

### 5.1 One-shot report-correction turn

Reporting is **mandatory**, not optional. On a cleanly settled attempt lacking an accepted report:

- If correction budget is 1, the adapter can resume exact same session, and provider is available, issue **one** correction message identifying invalid/missing fields and listing allowed outcomes. Allow only output correction, not another implementation loop. Record `correction_requested` as an event.
- Return to settled/wait-for-report; if still invalid, emit `system.report_error`. Do not issue a second correction. If adapter cannot resume, emit `system.report_error` immediately.
- A crash, failed child process, timeout, or provider failure skips this correction branch and generates the respective system error. This avoids extra paid calls against a broken service.
- Correction itself is part of the same logical step attempt, with a separately recorded correction invocation/usage and process ID if it requires another process. It **must not overlap** the original process.
- Original and correction process streams are retained separately in the event log. The accepted report remains one row per logical attempt.

This design allows an agent to fix a rejected report *during its original turn* and also provides at most one additional turn if it never succeeded.

### 5.2 Phase 4 implementation notes

- `src/contracts/report.ts` defines report v1 and bounded JSON validation. The contract version is engine-owned; the body has no authoritative IDs or transition fields. Exact limits and HTTP response codes are recorded in `docs/schema-v1.md` decisions 27–29.
- `RunService` owns a private loopback report server for its headless drive lifetime. `bin/wf` reads the endpoint and token from environment and waits for synchronous acknowledgment. Tokens are opaque, memory-only and limited to one attempt invocation, rotated for correction and revoked before routing or on stop. This channel is not a management daemon; daemon lifecycle remains Phase 7.
- `RunCoordinator.acceptReport` validates and writes the immutable report and `report_accepted` event in one transaction. It never writes a cursor. The runner waits for confirmed process/group/pipe settlement and applies the report only after a clean result. Earlier reports survive process failures for diagnosis.
- Migration 3 adds a durable correction count (0 or 1); existing session columns store adapter-issued persisted identity. Correction reserves its budget/event before launch and uses a separate log path. A failed follow-up, including timeout/provider/process failure, becomes `system.report_error` with invocation failure metadata. This makes the bounded correction's failure behavior explicit (spec §4.3.6); the original invocation's technical failures keep their technical system codes and never enter correction.
- The shared process wrapper redacts injected secrets across arbitrary stdout/stderr boundaries. Adapters must supply their report token as a process secret. The fake fixture invokes the actual `wf` executable, persists a session file and verifies it on resume. Stdout outcome parsing has been removed.

## 6. Commands and filesystem state

Each command is an ordinary subprocess launched with explicit argv and cwd. Capture bounded stdout/stderr (stream to disk with tail in UI); return normalized `complete` / `failed` on exit codes; return system errors on spawn failure/timeout/interruption. `stdout` is available as a bounded interpolation field for downstream steps. Script authors who need complex shell behavior may explicitly call `sh -lc` or a checked-in script; the engine does not parse shell source.

**Git/worktree example:** a command step creates a named worktree, followed by an agent step whose `cwd` targets that path. Do not assume command process `cd` changes subsequent step directories. Automatic checkout/checkpointing/rollback is not built into the runner. The user can put these commands in the workflow.

**Permission model:** no mandatory safety gates. An agent or script running with user-level access can edit/erase project files, credentials, and other accessible data. Provide understandable UI affordances but honor explicitly selected unrestricted mode. Do not store credentials in workflow YAML or run logs.

## 7. Process lifecycle and crash recovery

### 7.1 Sequential invariants

- One globally active run and one active child-operation at a time in MVP.
- A valid report does not start the next step while the child remains alive.
- Stop terminates the entire owned process group where supported (send TERM, bounded grace period, KILL), and waits for reaping before marking stopped. Spawning another agent before this completes is a bug.
- Agent commands should not inherit or override the daemon's listening socket except as needed for report submission. Explicitly close inherited file descriptors where possible.

### 7.2 Restart reconciliation

On startup:

1. Obtain a single-instance lock for the runner and open DB.
2. List runs marked `running`, `pausing`, and attempts marked `starting`, `running`, or `settling`.
3. Reconcile process identity using persisted PID/PGID **plus an OS-specific process-start identifier** (avoid killing a reused PID); verify liveness conservatively. If uncertain, do not signal arbitrary processes.
4. Mark the attempt `interrupted` / uncertain, record the reason, and pause the run. Do not auto-dispatch the next stage or rerun the uncertain step.
5. Show recovery choices: inspect log, terminate verified orphan if present, retry stage, skip, jump, end. Each human action is recorded.

An optional later enhancement can provide automated recovery for proven side-effect-free primitives, but arbitrary commands and agent work are not safely idempotent.

### 7.3 Shutdown behavior

- Browser disconnect: **no effect** on run.
- Graceful daemon shutdown: request pause, finish current step if allowed, flush DB/log streams, then exit.
- Stop-now: kill active process tree; record potential filesystem side effects; no rollback.
- Unexpected daemon kill/power loss: reconcile as interrupted on next launch; never promise unattended continuation through a power outage without a service manager that restarts the daemon. Provide optional user-level systemd guidance later, not required for engine correctness.

### 7.4 Phase 3 process notes

- **Ownership by group.** Every child starts as the leader of its own process group. A stop or timeout signals the group. After the leader exits normally, leftovers in its group are ended too. `completed` resolves only after the group disappears and output streams close; cleanup uncertainty rejects completion rather than falsely reporting success.
- **Escalation.** SIGTERM first, then SIGKILL after a grace period (1 s by default). Failure to confirm group disappearance within the bounded reap wait is an error. Termination after completion is a no-op and never signals an old group.
- **Known limits.** Signals go to the group id, which is the leader's pid. If a leader exits and its pid is reused while members remain, the wrong group could be signalled. Process-start identity checks (todo 7.1) address this gap. Descendants that deliberately escape the group cannot be terminated through group ownership; retained pipes cause an uncertain-settlement error, not a success. There is no sandbox or subreaper.
- **Bounded output.** The heads of stdout and stderr (64 KiB each by default) stay in memory; stdout supplies `{{steps.<id>.stdout}}`. Combined output goes to a per-attempt log file, capped at 16 MiB plus a cap marker. A chunk crossing the cap retains its fitting prefix instead of discarding the whole chunk.
- **One process at a time.** `RunService.drive` awaits each attempt before asking for the next step and rejects concurrent drive calls. Stop only terminates the requested run's owned operation; stopping another saved run cannot affect it. Live operations cannot be reconciled as crashed. Adapter launch exceptions become spawn errors; completion rejections require termination before routing an internal error. If termination cannot be confirmed, the attempt remains active for reconciliation.
- **Adapters are workflow-agnostic.** Adapters launch processes and report what happened. The runner maps results to settlements (`src/runner/settlement.ts`), so the same precedence rules apply to every harness. Terminated agents cannot succeed even if they reported an outcome and exited zero. Session resume selects the latest persisted session for the same harness, task, run and revision; absence routes `system.resume_unavailable` before launch.
- **Offline probes use the same supervisor.** Version/help checks terminate owned descendant groups on timeout, retain nonzero exits and stderr, and reject truncated output as compatibility evidence. Help markers alone cannot turn a failed command into a successful probe.

## 8. Local API and UI boundary

HTTP over `127.0.0.1` only by default. Use REST actions or lightweight RPC plus SSE for state/events. Minimum operations:

- `POST /workflows/validate`, `/workflows/save`, `GET /workflows`.
- `POST /tasks/preview-import`.
- `POST /runs`, `POST /runs/:id/start`, `GET /runs/:id`, `GET /runs/:id/events`, `GET /runs/:id/reports`, `GET /runs/:id/tasks`.
- `POST /runs/:id/pause`, `/stop`, `/resume`, `/override`, `/revise`.
- `GET /runs/:id/events/stream` (SSE) for live UI.
- Private `POST /internal/reports` as above, authenticated by attempt token.

API mutating requests must validate run state server-side. The visual editor and CLI use the same route/engine service; no UI-only business logic. Avoid exposing raw command execution endpoint independent of a validated workflow.

UI uses a small component library only if it helps. Stage **list editor** is enough for MVP; no heavyweight flowchart canvas required. Show effective transitions, including inherited policies, and allow manual YAML edit + parse errors. Save YAML through a parser/serializer that warns if comments/style may be reformatted; do not silently destroy custom source formatting on first load.

## 9. Testing strategy

**FakeHarness** is essential: configurable output sequence, report submission behavior, hang, nonzero process exit, output event streaming, session resume, and correction behavior. Drive the *real runner service* through real process boundaries where possible. Tests should not need network/API keys.

- Unit: strict parser, outcome membership, policy merging/conflicts, graph reachability warnings, task-loop semantics, interpolation errors, reducer determinism.
- Integration: real `wf report` invocation via local HTTP, accepted report once, invalid/duplicate submissions, correction once, report preserved before process settles, error routing, command exit mapping, timeout/kill, stop/pause/resume.
- Crash tests: kill runner at carefully chosen boundaries; restart and verify paused uncertain state, no silent replay.
- Adapter conformance (offline, no API keys): every harness adapter must pass the same suite the FakeHarness exercises — launch, stream parse, settle detection, accepted/invalid/duplicate report, correction-once, crash/timeout mapping, stop/terminate, and the no-resume fallback — before it is registered as supported.
- Adapter smoke: opt-in tests per installed harness (Codex, Pi, omp, OpenCode, Claude Code); capture version and fixture logs, avoid permanent dependence on volatile JSONL event fields beyond the adapter.
- UI smoke: create workflow, view compiled transitions, start fake workflow, see progress and attention queue, edit paused workflow, resume; automated browser tests can come near the end.

**Quality gate:** TypeScript typecheck, tests, lint and documented local developer commands must pass before calling MVP complete. No external LLM spend needed for basic functionality.

## 10. Recommended implementation order

1. Define strict contracts and compiler.
2. Implement SQLite reducer/event store and tests.
3. Implement FakeHarness + command executor and runner lifecycle.
4. Implement report CLI/server channel and bounded correction.
5. Implement Markdown import/task primitives.
6. Implement harness adapters: Codex and Pi first, then Claude Code, OpenCode, and omp, all against the same interface and conformance suite.
7. Implement CLI management and recovery flows.
8. Add local UI for workflow configuration + execution monitoring.
9. End-to-end tests and documentation.

See [todo.md](todo.md) for actionable milestones.
