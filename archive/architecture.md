# Technical Architecture — Agent Workflow Runner

> Archived for the UI-focused reset on 2026-10-20. This is reference/history, not the current work plan or agent instructions. Use [DESIGN.md](../DESIGN.md) and [AGENTS.md](../AGENTS.md) for active direction.

**Status:** Implemented beta contracts; current usability work follows [todo.md](refinement-plan.md).

**Read first:** [Product specification](spec.md)

## 1. System overview

```text
                   Local browser UI
                         |
                   HTTP / polled API
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

A **single local daemon process** owns orchestration and event storage. The browser is not required for the daemon to run. The report CLI is a thin client. One active stage attempt at a time per run, and **one active run globally in MVP** (multiple saved runs can be inspected). A global single-run limit prevents accidental repository collisions and simplifies recovery. Parallel scheduling remains deferred (spec §8).

### 1.1 Packages / modules

The repository uses one TypeScript project, with these source directories:

- `src/contracts/`: strict schema/types, validation and shared control/report contracts.
- `src/engine/`: compilation, policy routing, pure reducer and transactional run coordinator.
- `src/store/`: SQLite ownership, migrations, transaction wrapper and persistence.
- `src/adapters/`: process supervision, harness/command adapters, registry and offline probes.
- `src/runner/`: run service, attempt preparation, reporting, task import and recovery orchestration.
- `src/app/`: daemon, CLI entry points and management/browser application services.
- `src/web/`: local HTML/CSS and browser TypeScript.

See [development](development.md#repository-layout) for tests and fixtures. There are no
separate monorepo packages or distributed services. The canonical [deferred-feature list](spec.md#deferred-features-and-permanent-non-goals)
records the current limits: immutable task snapshots/revisions, paginated events/polling and
local log files; no mutable named workflow library, task re-import or browser recovery.

## 2. Durable state model

SQLite is authoritative. The production default for DB and run artifacts is `${XDG_STATE_HOME:-~/.local/state}/workflowz/`, with `WF_STATE_DIR` and higher-precedence `--state-dir` overrides. The project contains user-authored workflow files and optional input docs; offline tests use explicit disposable project-local directories. File paths stored in DB are absolute or normalized at run creation.

**Persisted records:** The canonical tables/columns are defined by the append-only migrations in
`src/store/migrations.ts`. This summary describes their responsibilities rather than a second SQL schema.

| Table | Responsibility / invariant |
| --- | --- |
| `workflow_revisions` | Immutable definition text/hash/source directory; content/source-directory deduplication |
| `runs` | Authoritative status, selected revision, cursor, active task and retry deadline |
| `tasks` | Imported run-local task identities/order and engine-owned progress |
| `task_imports` | Immutable source text/hash/import options |
| `attempts` | Execution identity, revision, task, session/process evidence, settlement and recovery state |
| `attempt_inputs` | Immutable prepared agent input, without report authorization |
| `reports` | At most one accepted report per attempt |
| `transitions` | At most one committed transition per finalized attempt; engine/manual transitions may have no attempt |
| `events` | Append-only audit history committed with state mutations |
| `attention_items` | Blocking/informational items and their resolution |
| `task_overrides` | Current run-local task parameters; prior values remain in audit events |
| `recovery_resolutions` | Operator cleanup assertions kept separate from OS observations |

Use foreign keys and DB constraints. Prefer WAL with bounded busy timeout. Transactions wrap transitions, completion of task state, and cursor updates. Event entries accompany state mutations within the **same transaction**, so a state advance and its log cannot disagree.

### 2.0 Phase 2 implementation notes

These describe implemented storage invariants and their rationale. Phase numbers retained in section headings refer to the archived MVP plan, not pending work.

- **Storage.** `node:sqlite` (built into Node) with `PRAGMA user_version` migrations. The migration file is append-only. Each run's writes go through `WorkflowDatabase.transaction`, which uses `BEGIN IMMEDIATE`. Nested calls join the outer transaction; any inner failure makes the whole transaction rollback-only, even if its caller catches the error.
- **Extra table: `transitions`.** Every routing decision is one row, with `revision_id`. `attempt_id` is UNIQUE, so the database itself forbids two transitions for one attempt. Engine-only steps have `attempt_id` NULL.
- **One active run and attempt.** Transactional coordinator start/resume checks reject a second running or pausing run. A database unique index on `(status IN (active states))`, restricted to active attempts, independently allows at most one active attempt across the whole database. The independent database writer lease in §7.5 prevents competing owners.
- **Single writer.** `RunCoordinator` is the only code that changes run state. For each step it reads the run, decides with the pure reducer (`engine/reducer.ts`), and writes the decision with its event in one transaction. A settlement with an undeclared outcome is refused before any write (spec §4.2). Compiled cache entries use definition hash and source directory, not revision ID alone: rolled-back SQLite revision IDs can be reused.
- **Retries.** A `retry` action reruns the step while its attempt count within the current task is below `max_attempts`. The count includes the attempt that just settled. When the budget is spent, `system.retry_exhausted` routes and is recorded as the transition outcome; the attempt settlement event preserves the originally observed outcome. If the exhaustion route also asks for a retry, the run pauses. Phase 7.4 adds durable backoff admission as described in §7.7. Engine-only steps do not retry; a retry there pauses the run.
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

A step attempt has an **input snapshot**: task, project root, prompt, instruction paths, selected preceding reports, working directory, effective outcomes/transitions, harness, model, and timeout. Its accepted report is immutable. Run-specific task overrides are saved alongside imported run-local task IDs; reusable YAML workflows do not depend on project-specific task IDs. Its execution may produce files in the target project, which remain external side effects.

### 3.1 Task loop semantics

- `task.next` selects the next queued task in imported order; if exhausted, emits `exhausted`. The task remains active across subsequent agent, command, and review steps.
- `task.complete` marks the active task complete only after configured workflow has reached that step; it clears active task and emits `complete`.
- If a task is blocked and run is paused, it remains active. Resume may retry current stage, jump to another stage, or mark task complete through a manual action. No implicit skip.
- Reentering `task.next` while an active task exists is an engine error, not a way to silently discard it.
- Engine-owned task progress is independent of `todo.md` modification by agents.

### 3.2 Phase 5 task import and context implementation

`RunService.createRun` is the filesystem entry point for Markdown import; `previewTasks` is read-only. The coordinator retains its supplied-task seam for fixtures. Migration 4 stores immutable source text/hash/import settings and per-task source positions/check state, transactionally with task rows and the import event. The parser preserves separate nested checkbox tasks and heading ancestry without deriving dependencies. File edits never update the active queue.

At attempt preparation the runner reads configured instruction content, resolves explicit placeholders and adds the current task plus only selected reports from the same run/task. Missing selected history is omitted until produced; missing explicit placeholder values or instruction files fail before launch. Migration 5 stores the exact assembled agent input once per attempt with an `attempt_prepared` event in the same transaction. Report tokens are generated afterward and never enter that snapshot. Per-task parameters and paused revisions are implemented as described below. Neither manual re-import into an existing run nor Markdown auto-sync/write-back is implemented; create a new run for another snapshot (spec §8).

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
  readonly id: string;
  readonly capabilities: HarnessCapabilities;
  start(input: AgentInput): AgentHandle;
  readonly resumeForReportCorrection?: (
    input: AgentInput & { readonly priorSessionId: string }
  ) => AgentHandle;
}
```

Actual input/result signatures live in `src/adapters/agent-adapter.ts`; this sketch is not a second API contract. Canonical YAML uses optional `timeout_seconds` and required agent `session: fresh | resume`. Resume requires exact non-creating adapter admission of a persisted identity in the same harness/run/task/revision, never permissive/latest/fresh fallback. Async factories perform probes and expose their snapshot; there is no second per-invocation probe method. Responsibilities remain: adapter handles harness-specific launch/session/streaming; runner validates reports, stores state, routes outcomes.

The static **harness registry** maps `HarnessId` to descriptor/capability data. Executable adapters are supplied explicitly through `RunService` options. Workflow validation resolves `harness` against the registry and reports a clear "unknown or unsupported harness" error instead of failing an enum. The registry is a lookup table, not a plugin system; dynamic third-party plugin loading is deferred (see [spec.md](spec.md) §8).

Adapter responsibilities are uniform across harnesses; only the harness-specific behaviors below differ:

| `HarnessId` | Headless launch | Event/settle source | Correction resume | Capabilities to verify |
| --- | --- | --- | --- | --- |
| `codex` | `codex exec` | JSONL via `--json`; final message + process exit | `codex exec resume` | resume, event stream, structured output, permission mode, model selection |
| `pi` | `pi --print --mode json` | LF-delimited JSON; `agent_settled` | validated journal/full UUID in its exact directory; no create on resume | resume, event stream, permission mode, model selection |
| `omp` | `omp --print --mode json` | LF JSON; final successful assistant and `agent_end.isTerminal: true` + process settlement | `--resume <exact-persisted-path>` | terminal dialect, journal identity and exact path resume |
| `opencode` | private `serve --stdio` child + v2 API | prompt admission, wait-for-idle, persisted terminal outcome + process settlement | exact session API, never create on resume | resume, permission mode, model/variant selection; no provider event stream in this slice |
| `claude` | `claude -p --output-format stream-json` | stream-json lines; terminal `result` message | `--resume <session-id>` | resume, event stream, permission mode, model selection |

Every adapter must pass the offline **adapter conformance suite** (see §9) before it is registered as supported. Adapters must also pass the child process only a deliberate environment allowlist, never the daemon's full environment, so nested-harness variables and credentials cannot leak between harnesses.

All five adapters have offline conformance coverage. Versioned sources, exercised live reporting/
correction results and remaining limits are maintained in the [compatibility reference](harness-compatibility.md)
and its historical record. Offline fixtures do not establish fresh provider/account compatibility.

### 4.1 Codex integration

The adapter uses the **non-interactive Codex CLI**. Capture JSONL events and CLI exit status; extract/persist the session ID from documented events; support normal work and same-session follow-up for correction. Check locally installed flags/version at integration time.

Codex docs describe `codex exec` headless mode, JSONL through `--json`, `--output-schema` structured final responses, and `codex exec resume` for continuing sessions. They also document permission configuration, including unrestricted modes. Structured-output reporting fallback is deferred; current adapters require `wf report`. Do **not** assume the first JSONL agent-message item is the final completion boundary.

**Official references:**

- https://learn.chatgpt.com/docs/non-interactive-mode
- https://learn.chatgpt.com/docs/cli/reference
- https://github.com/openai/codex

Version-specific behavior is a risk. Use executable compatibility tests against the user's installed Codex version and avoid pinning assumptions in the workflow file.

### 4.1.1 Phase 6.1 implementation

`adapters/codex.ts` provides an async offline-probed factory and an executable `AgentAdapter`. It uses the common supervisor with stdin prompt delivery and a scrubbed continuous stdout observer. `codex-events.ts` independently decodes bounded LF records across UTF-8 chunks, captures explicit UUID identity and terminal/failure evidence, and never extracts reports. Completion still requires the supervised process/group/streams to settle. Parser/provider failure on an otherwise clean exit bypasses report correction; clean missing report/session behavior continues through existing runner rules. Resume requests never select the latest session or silently start fresh.

The adapter forwards model/reasoning effort, injects the existing report channel and project-local `wf` PATH, and records CLI version/unrestricted mode in invocation-start events. Only base environment plus Codex home/key and report access are selected. Per-invocation config preserves report environment for tools, excludes the API key from their inheritance, and disables shell snapshots; it does not edit global files. No schema migration or workflow control change is needed. Raw scrubbed events use the existing bounded attempt log.

Codex registry status is `conformance_passed`, based on synthetic offline conformance. Recorded live reporting/correction evidence and version-specific limits are in `docs/harness-compatibility.md`. Neither registry status nor old live results establish current account availability.

### 4.2 Pi integration

The implementation uses the **Pi headless CLI** in one-shot `--mode json`; correction reopens the exact persisted session. RPC and SDK integration are not used. Verify the installed fork/package when changing the adapter.

Pi JSON/RPC streams are strict LF-delimited JSONL. Read with a UTF-8 byte stream decoder, split **only on byte `\n`**, and consume continuously to avoid pipe backpressure. Distinguish `agent_end` (potentially followed by automatic retries) from `agent_settled` (run fully quiescent). Capture the persisted session ID/path needed to send a follow-up correction turn. The agent is allowed full tools according to the user's configured Pi setup.

**Project references:**

- https://github.com/badlogic/pi-mono (verify currently installed fork)
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md (JSON mode reference of a Pi fork)
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md (RPC mode reference of a Pi fork)

### 4.2.1 Phase 6.2 implementation

`adapters/pi.ts` targets the installed `@earendil-works/pi-coding-agent` 1.3.0 CLI, using `--print --mode json` and stdin prompts rather than a long-lived RPC connection. `pi-events.ts` decodes bounded UTF-8/LF records continuously, including beyond bounded stdout capture. `agent_end` never settles execution: transient assistant failures may recover through Pi's native retries/compaction. Final assistant errors/aborts/truncation, exhausted retries, failed compaction or malformed records make a clean exit technical failure. A final non-aborted `agent_settled` and common process/group/pipe settlement are required. Streamed content never becomes a report.

Fresh sessions use unique directories under a runner-owned persistent root beside logs (or explicit adapter `sessionDir`). After settlement the adapter finds the exact UUID file and validates its bounded v3 header against the streamed identity. Its absolute path is the opaque durable engine session identity. Resume rechecks header/UUID/cwd before launch and preserves the requested identity if returned evidence mismatches. Pi creates missing *paths* and `--session-id` sessions, so resume instead uses `--session <full-UUID> --session-dir <that-file-directory>`. Installed source confirms missing ID lookup exits without creating a session; the dedicated directory prevents cross-project lookup. No selector, recent-session, fork or fresh fallback is used. Existing same-run/task/revision scoping and one sequential bounded correction remain runner responsibilities.

The factory isolates version/help probes with a temporary Pi config directory, offline mode and resource discovery disabled. Runtime keeps the user's normal unrestricted tools, passes model/validated thinking level, selects a deliberate environment and scrubs injected secrets through the common supervisor. Version and permission mode are audited. The common probe runner now accepts an explicit environment; existing probes keep their previous default. The shared conformance helper accepts a harness id so Pi is exercised as `pi`. Its registry status is `conformance_passed` after shared offline tests, not live verification. Session/routing policy stays with the runner; this adapter does not own run state.

### 4.3 Claude Code integration

`adapters/claude.ts` provides an offline-probed factory and a one-shot print adapter for the installed 2.1.303 interface. Launch uses stdin with `--print --input-format text --output-format stream-json --verbose --permission-mode bypassPermissions`; model/validated effort use `--model` and `--effort`. The factory isolates home/config for version/help probes and supplies no provider credentials. Runtime retains normal configured resources/authentication and session persistence; no global settings change.

`claude-events.ts` continuously decodes bounded UTF-8/LF records independently of stdout capture. Startup events may precede `system/init`; init and terminal `result` identities must agree. Only a final `result` with subtype `success` and `is_error: false` confirms success. API retry notifications alone are not failures. Malformed/oversized/unterminated records, duplicate/nonfinal results, error results and missing terminal evidence are technical failures on an otherwise clean exit, bypassing report correction. The common supervisor must still confirm exit/group reaping/pipe closure; neither result nor report can settle a process.

The result UUID is the engine's opaque session identity. Missing identity cannot authorize correction. Explicit resume accepts only full UUIDs, uses `--resume <UUID>`, and preserves the requested identity on mismatch. Installed offline missing-UUID evidence confirms a nonzero terminal error without fresh fallback; the adapter maps that known result to unavailable resume. No recent selector, transcript-path lookup, fork or ephemeral flag is used. Same-harness/run/task/revision lookup and one bounded sequential correction remain owned by the runner.

Only the common environment, explicitly selected Claude/Anthropic settings and report access reach the child; known injected auth is scrubbed by the supervisor. Version and selected permission mode are audited. Claude is `conformance_passed` after the full shared offline suite through a synthetic CLI, with additional framing, failure, identity and settlement cases. The runner retains report/routing/session-scope authority. Recorded live evidence and remaining resource/tool compatibility limits are in `docs/harness-compatibility.md`.

### 4.4 OpenCode integration

Phase 6.4 uses a private leased `opencode serve --stdio --hostname 127.0.0.1 --port 0` process per invocation, not the shared OpenCode service. **Rationale:** installed v2.0.32 and official source confirm `run --session` creates missing IDs; a precheck followed by CLI launch would race with deletion. Its JSON `step_finish` also represents a model step, not terminal execution. Exact API prompt admission cannot create a missing session, including a session removed after lookup. This process belongs to the adapter invocation, independently of the management daemon lifecycle.

`adapters/opencode.ts` probes version/help offline and starts `opencode-bridge.ts` under the existing supervisor. The bridge receives its prompt/private lease credential on stdin, launches the server in the same process group, validates a bounded loopback readiness record, and authenticates bounded v2 JSON requests. Fresh execution alone calls session create. Resume first reads the exact ID and verifies cwd; later updates and prompt admission address only that ID. Missing/moved/mismatched sessions fail without fallback; returned evidence never replaces the requested durable identity.

Prompt admission must acknowledge the generated message ID and session ID. The bridge then calls `POST /api/experimental/session/:id/wait` and rereads session metadata: identity/cwd must agree, idle time must cover admission and advance beyond any prior execution, and outcome must be `succeeded`. Failed/interrupted outcomes, malformed/oversized/truncated/invalid-UTF-8 responses, invalid readiness, stale/missing terminal evidence and wrong admission are technical failures even at exit zero. Reports remain exclusively authorized `wf report` submissions. The bridge emits a strict bounded internal LF protocol; it does not parse CLI `run` events or capture provider text/tool events. The registry advertises `supportsEventStream: false` for this implementation.

On completion/error the bridge closes the stdin lease and awaits server exit. The common supervisor independently confirms the bridge/group/pipe settlement; stuck shutdown still obeys timeout/stop precedence. No report or terminal API response allows early routing or correction. Existing correction limits, rotated report access, revision scope, state transactions and migrations are unchanged.

The supported v2 session permission ruleset is `[{action: "*", resource: "*", effect: "allow"}]`, audited as `session-allow-all` with CLI version. Session rules apply after agent rules; this explicit unrestricted selection overrides session denials, unlike `--auto`'s allow-unless-denied semantics. No global setting is written. Model/variant selection uses existing model/reasoning fields. Runtime selects the common environment plus documented OpenCode/config/provider names; the private server removes its lease password from tool inheritance, and the supervisor scrubs known injected secrets. No isolation or rollback is claimed.

OpenCode is `conformance_passed` after the entire shared offline suite through a synthetic CLI/private API server, plus adapter-specific identity, framing, failure and settlement coverage. The shared missing-identity case now permits a protocol error when identity is required by the transport, while still requiring no correction/fresh fallback. Installed isolated checks independently confirmed CLI create-if-missing, exact API missing-session rejection and terminal invalid-provider failure. Recorded live reporting/correction evidence and unverified resource/tool interactions are distinguished in `docs/harness-compatibility.md`.

### 4.5 omp integration

`createOmpAdapter` probes installed oh-my-pi 18.12.2 offline with temporary home/config and no credentials, then selects `omp` on the existing `PiAdapter` runtime. This is a bounded two-dialect implementation, not a harness plugin framework. stdin delivery, deliberate environment selection, secret scrubbing, persistent session directories and common supervision are reused. The CLI uses `--print --mode json --approval-mode yolo`; optional model/thinking include omp's `auto`. Version and `yolo` are audited. Explicit tool/user restrictions and provider safety policies still apply.

**Verified differences:** omp print JSON has no Pi `agent_settled` frame. `PiEvents("omp")` requires successful assistant evidence and a final `agent_end` with explicit `isTerminal: true`, tracks native retry lifecycles and `auto_compaction_start/end`, and invalidates terminal evidence when more work starts. Failed assistant stops, exhausted retries, failed compaction, error notices and malformed/oversized/truncated/invalid-UTF-8 records fail even on exit zero. RPC's `session_settled` is not a print-mode substitute. Print mode itself drains recovery/event persistence, stdout and disposal; the runner additionally waits for process/group/pipe settlement. Reports remain out of band.

`omp-session.ts` reads v3 UUID journals, accepting the optional physical title slot before the logical header. It retains only header/transfer metadata while checking bounded records. Dedicated directories default to `omp-sessions` beside logs. The absolute persisted file path is the engine identity; header/UUID/cwd are revalidated. Resume uses `--resume <absolute-path>` with its exact directory. Installed source and deletion-after-precheck smoke confirm strict open rejects missing files, unlike prefix/global ID lookup's permissive open. No continue/restore/selector/fork fallback is used. Latest valid departed-transfer markers make a journal unavailable before launch because the CLI would implicitly fork it. Returned mismatches never replace the durable target.

The complete shared synthetic offline suite runs as `omp`; additional framing, native-recovery, persistence/identity, environment/secret and settlement coverage supports `conformance_passed`. Independent service smoke proves one sequential correction and durable reporting; installed negative smoke proves missing/deleted paths do not create replacements. Fresh isolated installed startup failed in database initialization, so the negative check used an empty schema fixture from official source; no runtime workaround or global change was introduced. Recorded live reporting/correction evidence is in the compatibility reference; arbitrary tool/resource interactions remain outside that scoped verification.

### 4.6 Harness capabilities and graceful incompatibilities

Phase 6.6 adds the missing connection between existing factory evidence and attempt preparation. The compiler uses static `HarnessCapabilities` (including `supportsReasoningEffort`) without subprocesses. Each real adapter publishes a frozen snapshot for its selected CLI and implemented transport. `probeHarness`/`probeHarnesses` invoke those same factories through a small built-in lookup; the earlier informational `HELP_PROBES` table was removed to prevent divergent checks. Required failed/truncated version/help evidence rejects construction. Optional resume/model/reasoning evidence gates only requested features; OpenCode's optional run/session help failures do not prohibit its supported fresh API transport. Codex config remains required for always-used environment overrides, with separate resume-model checks.

`prepareAttempt` checks the effective selected adapter before dispatch, using frozen task/revision settings. Unsupported model/reasoning selection becomes `system.spawn_error`; unsupported explicit resume becomes `system.resume_unavailable`. These are existing routable outcomes, recorded through coordinator settlement with explanatory detail/attention and no subprocess or correction. Known credential-free `AdapterPreflightError` messages from adapter option/session checks survive the service boundary; arbitrary launch exceptions stay generic. The runner does not interpret vendor flags or provider schemas. No new workflow fields, migrations or mandatory gates are needed.

Snapshot capability cannot prove session existence or provider access. Journal/cwd validation and exact non-creating CLI/API admission remain in each adapter and still fail closed after prechecks, including deletion races. A fresh workflow does not require resume merely because correction is enabled; absent correction support produces the existing `system.report_error` after clean missing-report execution. All process/group/pipe settlement and token rules remain unchanged. Current transports advertise structured-final-output as false because no report fallback is implemented; OpenCode also advertises no provider event stream. Static CLI potential is not promoted into transport support.

Preflight occurs at preparation of the affected attempt, not exhaustive run-creation validation of every branch or task. Factories are explicit offline snapshots: callers must recreate adapters after binary/configuration changes. Help markers are not authentication, live session, provider framing or tool-environment evidence. The independent `smoke:capabilities` exercises factory rejection, durable preflight failure, fresh reporting, unavailable correction and explicit workflow resume without providers.

### 4.7 Environment and diagnostic boundaries (Phase 6.7)

The common supervisor still accepts an explicit environment; adapters select their existing base/harness names and reporting access before launch. OpenCode's bridge now reapplies that same selection for its nested server, adding only the private lease password and current reporting access. Existing configuration/authentication and permission selections are unchanged. Probes use their existing temporary configuration and explicit environment; any deliberately injected probe credentials are scrubbed too. Ordinary command steps keep the original base allowlist plus arbitrary workflow `env` overrides, with no new output filtering policy.

`adapters/secrets.ts` extracts the existing process filter into one byte-preserving implementation. It matches known injected keys/tokens/passwords, URL userinfo authorization and OpenCode's private Basic representation. Literal, canonical JSON-escaped, URL component/form-encoded, Base64 and Base64url representations are recognized across arbitrary chunks within a stream. Original-byte masks handle overlapping secrets without rewriting replacement text or corrupting UTF-8/invalid protocol evidence. Memory retention is bounded by the longest known representation plus the incoming chunk. Each channel is filtered before observers/capture; the combined disk log is filtered again after merging. OpenCode additionally filters each nested server channel before multiplexing and buffers diagnostic lines up to 4 KiB per channel so short lines remain readable; longer lines may interleave.

All adapters return optional scrubbed process diagnostics. The runner rechecks known report-token representations, caps stderr to 4096 UTF-8 bytes without splitting a code point, and includes stderr plus stdout/stderr capture-truncation flags in the existing transactional `invocation_settled` event. These diagnostics do not affect routing or prove settlement. Existing stdout/stderr capture heads remain 64 KiB, and the combined raw stream log remains capped at 16 MiB plus its cap marker. Session/terminal events remain available beyond the memory capture. The original `.log` and `.log.correction` retain separate invocation evidence; stream merging/redaction means these files are diagnostic evidence, not guaranteed valid replayable JSONL.

Adapters expose their already-selected process secrets through memory-only handle metadata. Before yielding to report handlers, the runner registers them with the report channel so known provider/private credentials cannot leak through accepted reports or durable diagnostics. The report channel retains these values and issued tokens solely for redaction/rejection until `close`, including later same-channel attempts and correction; only the current token has report authority. Adapter input carries that memory-only history, and OpenCode forwards it through private bridge stdin for nested scrubbing. It never enters durable input snapshots, argv or the child environment. Authorization-history memory grows with distinct injected values/channel invocations; closing the channel discards it. Raw/provider text is not copied into preflight exceptions; unexpected supervision exceptions stay generic. No migrations or workflow/report fields are added.

Limits: this is environment selection, not isolation. Only values known at this boundary and the specified representations are matched. Unknown credentials loaded by harnesses/tools, arbitrary encodings/transformations, fragments deliberately separated by other text, and tokens from a previous closed channel are not discoverable by this filter. Harness-managed journals/transcripts/auth/config and arbitrary tool-created files are not rewritten. Live verification remains version/account/path-scoped as recorded in the compatibility reference. Process identity and escaped-descendant limits are described in §7.

## 5. Reporting channel

`wf report` talks to the local daemon using its private per-drive loopback HTTP listener, separate from the management API and authenticated with an **attempt-scoped opaque token** passed to the child environment. The token authorizes only *report submission for that attempt*, not run control or arbitrary DB modification. `wf report` always waits for server acknowledgment.

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
- `RunService` owns a private loopback report server for its headless drive lifetime. `bin/wf` reads the endpoint and token from environment and waits for synchronous acknowledgment. Tokens are opaque, memory-only and limited to one attempt invocation, rotated for correction and revoked before routing or on stop. This channel remains separate from the management listener in §8.1.
- `RunCoordinator.acceptReport` validates and writes the immutable report and `report_accepted` event in one transaction. It never writes a cursor. The runner waits for confirmed process/group/pipe settlement and applies the report only after a clean result. Earlier reports survive process failures for diagnosis.
- Migration 3 adds a durable correction count (0 or 1); existing session columns store adapter-issued persisted identity. Correction reserves its budget/event before launch and uses a separate log path. A failed follow-up, including timeout/provider/process failure, becomes `system.report_error` with invocation failure metadata. This makes the bounded correction's failure behavior explicit (spec §4.3.6); the original invocation's technical failures keep their technical system codes and never enter correction.
- The shared process wrapper redacts injected secrets across arbitrary stdout/stderr boundaries. Adapters must supply their report token as a process secret. The fake fixture invokes the actual `wf` executable, persists a session file and verifies it on resume. Stdout outcome parsing has been removed.

## 6. Commands and filesystem state

Each command is an ordinary subprocess launched with explicit argv and cwd. Capture bounded stdout/stderr and stream bounded diagnostics to local disk; invocation events expose log paths, not a raw-log endpoint or UI tail. Return normalized `complete` / `failed` on exit codes; return system errors on spawn failure/timeout/interruption. `stdout` is available as a bounded interpolation field for downstream steps. Script authors who need complex shell behavior may explicitly call `sh -lc` or a checked-in script; the engine does not parse shell source.

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
- **Known limits.** Signals go to the process group. The implemented boot/start/group identity checks in §7.5 guard signal admission, but OS inspection and signalling are not atomic. Descendants that deliberately escape the group cannot be terminated through group ownership; retained pipes cause an uncertain-settlement error, not a success. There is no sandbox or subreaper.
- **Bounded output.** The heads of stdout and stderr (64 KiB each by default) stay in memory; stdout supplies `{{steps.<id>.stdout}}`. Combined output goes to a per-attempt log file, capped at 16 MiB plus a cap marker. A chunk crossing the cap retains its fitting prefix instead of discarding the whole chunk.
- **One process at a time.** `RunService.drive` awaits each attempt before asking for the next step and rejects concurrent drive calls. Stop only terminates the requested run's owned operation; stopping another saved run cannot affect it. Live operations cannot be reconciled as crashed. Adapter launch exceptions become spawn errors; completion rejections require termination before routing an internal error. If termination cannot be confirmed, the attempt remains active for reconciliation.
- **Adapters are workflow-agnostic.** Adapters launch processes and report what happened. The runner maps results to settlements (`src/runner/settlement.ts`), so the same precedence rules apply to every harness. Terminated agents cannot succeed even if they reported an outcome and exited zero. Session resume selects the latest persisted session for the same harness, task, run and revision; absence routes `system.resume_unavailable` before launch.
- **Offline probes use the same supervisor.** Version/help checks terminate owned descendant groups on timeout, retain nonzero exits and stderr, and reject truncated output as compatibility evidence. Help markers alone cannot turn a failed command into a successful probe.

### 7.5 Phase 7.1 ownership, identity and reconciliation

- **Writer lease.** `WorkflowDatabase` resolves the database's eventual creation target, including dangling file links and directory aliases, before acquiring an exclusive SQLite transaction on a separate `<canonical-database-path>.runner-lock` file. The main connection opens that same resolved path; ownership precedes migration, reconciliation and discovery publication. The kernel releases it on close or crash; no heartbeat, PID-file reclamation or stale-lock deletion is needed. Never unlink an owned lease file: replacing its inode can admit two owners. Use one stable database path on a local filesystem; hard-link aliases and unreliable network locks are unsupported. `:memory:` fixtures have connection-local ownership only.
- **Read-only inspection.** `{readOnly: true}` opens no writer lease, performs no migration and rejects stale schemas needing migration. Consistent snapshots use deferred read transactions; writes remain SQLite-enforced errors. Writer state transitions still use `BEGIN IMMEDIATE`. A read-only connection cannot construct `RunService`. Main WAL reads do not touch the separate lease.
- **Process identity.** The supervisor captures Linux boot UUID, PID, process group/session IDs and `/proc/<pid>/stat` start ticks immediately after spawn. Commands, all five adapters and correction handles carry that identity to transactional invocation history and the existing attempt PID/PGID/identity columns. Unsupported identity environments fail before spawn. Before every group signal, current evidence must agree; a reaped leader's remaining group members must retain its reserved group/session IDs and start bounds. Mismatch or unavailable evidence is uncertain settlement, never permission to signal an unrelated PID.
- **Spawn boundary.** `invocation_dispatching` commits before each command/agent/correction launch, clearing the attempt's previous process identity without discarding session/report/correction history. A crash between spawn and identity persistence is intentionally unknown. Original process absence cannot establish correction-process absence.
- **Reconciliation.** The first service facade for an owner connection inspects every persisted running/pausing run and unresolved attempt. The runner supplies conservative OS observations; only `RunCoordinator` writes interruption state/events/attention in one transaction. Running runs with no active attempt also interrupt, preserving their committed cursor. Accepted reports, immutable inputs and prior transitions survive; no report routing, signalling, correction or side-effect replay occurs on startup.
- **Durable execution barrier.** Append-only migration 7 adds `attempts.recovery_state` (`alive`, `gone`, `mismatch`, `unknown`); migrations 1–6 are unchanged. Legacy uncertain interrupted attempts start as unknown. Any unresolved observation blocks `start`, `resume` and running `advance` across that database. `reconcile(runId)` refreshes observations idempotently; changes append `process_reconciled`. Proven absence clears only the process barrier; an explicit recovery disposition (§7.6) and separate reasoned resume are still required. Live operations cannot be reconciled through another facade of the same owner connection.
- **Recovery limits.** The decision API is described below and management/browser surfaces in §8. Check-then-signal is not atomic: Node exposes no pidfd/group-signalling primitive here. Escaped descendants, inaccessible process evidence, deliberate local lease tampering and arbitrary external effects are not isolated or rolled back. A group disappearing is not evidence that its work succeeded.

Rationale: use [SQLite's existing kernel-backed exclusive locks](https://www.sqlite.org/lockingv3.html) rather than race-prone stale PID-file takeover. Linux [`/proc/pid/stat`](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html) supplies process group/session and boot-relative start ticks; combining them with boot identity avoids treating observed PID reuse as ownership. The independent `npm run smoke:recovery` SIGKILL scenarios exercise the headless implementation without a daemon or provider.

### 7.6 Phase 7.2 explicit headless recovery

- **Inspection and stale decisions.** `RunService.recovery` / `RunCoordinator.recovery` expose a transactional durable snapshot with run/cursor/revision, uncertain attempt, retained report/log references, last process evidence and separate operator confirmation. Requests use strict contracts in `contracts/recovery.ts`: exact attempt identity (null between steps), the last run event ID and a nonblank reason. Changed/duplicate requests fail rather than applying to a different operation. Inspection does not refresh OS evidence.
- **Interruption context.** Inspection follows the current interruption episode, not an arbitrary old interrupted attempt. Pending legacy operations are resolved one at a time. A later between-step crash, including after a paused revision, preserves its committed cursor and cannot borrow an earlier resolved attempt. Explicit retry reselects the interrupted stage even if a prior audited manual jump moved the cursor.
- **Verified termination.** Only the service performs process I/O. The coordinator commits `recovery_termination_requested` before signalling; each TERM/KILL admission checks current ownership through the existing Linux helper. Each signal has a one-second bounded disappearance wait. Completion records fresh observation and `recovery_termination_finished` transactionally, not a successful stage result. Unconfirmed absence retains the database-wide barrier. Shared-owner service facades cannot overlap drive, reconciliation or recovery termination. Startup only reconciles an interrupted termination; it never replays signals.
- **Unidentified operations.** `confirmExternalCleanup` requires `confirmedNoSurvivingOperation: true` plus fresh service-supplied evidence that is not a verified live owned group. The operator must independently investigate/settle any unidentified or mismatched operation. Append-only migration **8** adds `recovery_resolutions`, keyed by attempt, with observation, reason and timestamp; migrations 1–7 are unchanged. This explicit assertion clears that attempt's barrier without overwriting `recovery_state` as `gone`. It is not automated absence evidence, rollback or assurance about escaped descendants. False operator assertions can permit overlap; no arbitrary-PID termination or generic ignore-process override is provided.
- **Workflow disposition is separate.** `decideRecovery` requires resolved process barriers and records `recovery_decided` with the reason/action and old/new cursor in the same transaction as state changes. Retry selects another execution of the interrupted stage; continue preserves the committed between-step cursor. Skip uses a declared outcome and a manual null-attempt transition; jump validates cursor/task compatibility; end records stopped. Non-ending choices stay paused until explicit resume/drive. Existing audited manual controls also refuse unresolved processes. Interrupted attempts, reports, frozen inputs, sessions and correction history are never rewritten into success.

Rationale: distinguish **what the OS observed**, **what the operator asserts about process cleanup**, and **which workflow action the operator chooses**. Conflating those would make an unknown launch look like a successful operation or silently authorize replay. Recovery disposition remains separate from execution; configured stage retries do not authorize crash replay.

### 7.7 Phase 7.4 limits and durable retry admission

Existing append-only attempts and transitions remain the authoritative counters: retry routing counts attempts by run/step/task without a revision filter, while the run step limit counts transitions. Correction/native harness invocations do not add attempts. No redundant mutable counters or new YAML/report fields are needed.

Append-only migration **9** adds nullable `runs.retry_not_before`; migrations 1–8 are unchanged. Retry settlement writes this deadline and includes it in `transition_committed` within the same transaction as the attempt/transition. `advance` checks run limits first and returns `{kind: "waiting", until, delayMs}` until due, without creating an attempt. The wait is bounded by the remaining run wall time. Deadline clearing and subsequent advancement commit together. Legacy rows begin with no invented wait; all historical attempts/transitions remain intact.

`RunService` uses one abortable timer during backoff, with no active child/attempt. Pause and stop wake it immediately; daemon shutdown reuses pause. Pause/restart and revisions retaining the cursor preserve the deadline. Audited cursor jump/skip/stop, active-task completion or revision cursor change cancels it. Startup still interrupts a running between-step cursor, so continuing a saved wait needs explicit recovery disposition plus resume. No pending delay automatically dispatches on reopen.

Run wall time remains elapsed time from durable `start_time`, including pauses/downtime; limits do not reset on resume/revision. Immediately before each launch the service caps its configured timeout by the remaining run budget; zero prevents dispatch. This includes report correction's existing separate 30-second cap. The coordinator checks limits again on settlement and before advancement, recording blocking attention and pausing even when timeout routing selected a next cursor. Process-group termination, reaping and stream/log settlement can extend beyond the deadline; uncertain cleanup leaves the attempt unresolved through the existing recovery path.

Agent input forwards optional idle duration to the common process supervisor in every adapter (omp uses Pi's shared path). Any raw stdout/stderr bytes reset the timer before redaction or capture/log caps; no parser, transcript or model judgment defines activity. Idle expiry uses existing supervised termination and `system.timeout`, with `timeoutReason: "idle"` in invocation diagnostics. An original timeout bypasses correction; correction failure stays `system.report_error` inside the same attempt. Commands/probes have no new idle policy. OpenCode's bridge does not expose continuous provider activity, and arbitrary output can keep idle alive; this is an opt-in silence bound, not semantic progress detection. Long process timers are segmented to avoid Node's oversized-delay clamp.

Rationale: reuse durable execution history for budgets and store only the missing admission deadline. This preserves transactional decisions, responsive controls, sequential settlement and conservative restart without a scheduler queue, hidden retry or second state owner.

## 8. Local API and UI boundary

### 8.1 Implemented daemon and management RPC (Phase 7.3)

`app/daemon.ts` is an explicit foreground owner (`wf daemon start`), with no auto-start/detach/service manager. It first opens `state.sqlite` under the existing kernel-backed writer lease, constructs one `ManagementService`/`RunService` (which reconciles startup state), then binds an ephemeral HTTP port on `127.0.0.1`. It atomically replaces `daemon.json` with `{version:1,port,token}` only after ownership/listen succeeds. The directory must be current-user-owned with mode 0700; new discovery/artifact files use owner-only permissions. Clients reject unsafe ownership/modes/symlink discovery and validate its shape before connecting. A competing daemon cannot replace discovery; a restarted owner rotates authority. Stale files never trigger PID signalling or lease deletion. Foreground stdout/stderr holds daemon lifecycle diagnostics; `logs/` contains existing per-attempt logs/session artifacts. No new database migration or dependency is needed.

All management operations use authenticated `POST /api/v1` with a strict discriminated `{op,...}` contract in `contracts/management.ts`. Bearer authority is separate from the private per-drive report server. Management requires JSON, rejects browser Origin headers, bounds bodies to 2 MiB and request reads to five seconds, and exposes no CORS/raw-execution endpoint. No token is printed or placed in child environment/argv/database/event history. Same-user unrestricted workflows can access user files; this is local authority separation, not isolation from malicious same-user code. The existing report endpoint/token lifetime and `wf report` client remain unchanged.

| RPC `op` | Additional fields / behavior |
| --- | --- |
| `ping`, `shutdown` | Lifecycle inspection / acknowledge pause-after-current shutdown |
| `validate`, `import` | `workflowText` (up to 1 MiB), absolute `workflowDir`; validate or save immutable revision |
| `workflows`, `runs` | Saved revisions / run list |
| `preview`, `create` | Workflow fields, optional `includeCompleted`; preview or freeze actual checklist into a ready run |
| `create-import` | `revisionId`, optional `includeCompleted`; use saved source directory/definition, read current checklist |
| `status`, `tasks`, `reports`, `recovery` | `runId`; durable inspection, no process observation/signalling |
| `events` | `runId`, `after` (nonnegative exclusive cursor), `limit` (1–1000); `{events,nextAfter,hasMore}` |
| `start`, `pause`, `reconcile` | `runId`, inspected `expectedEventId` |
| `stop`, `resume` | Same cursor plus nonblank bounded `reason` |
| `override` | Same cursor plus strict `edit`: jump/skip/mark-task-complete and reason |
| `revise` | Same cursor plus existing `WorkflowRevisionInput` as `edit` |
| `task-overrides` | Same cursor, `taskId`, existing `TaskOverrideEdit` as `edit` |
| `recovery-terminate`, `recovery-confirm`, `recovery-decide` | `runId`, existing exact-attempt/event/reason contract as `request` |

Replies are JSON: 200 success, 202 shutdown admission, 401 invalid management authority, 404 unknown route, 409 wrong state/stale or settling control, 413 oversized body, 422 invalid request/definition, 400 other operation rejection. Diagnostics preserve code/path/location; transport failures are not retried. Management CLI exits are 0 for success, 1 for control/validation/transport rejection, and 2 for malformed CLI or unreadable input. See `docs/development.md` for commands. CLI local validation and RPC validation share `app/workflow-validation.ts`.

`ManagementService` serializes mutations by rejecting overlap during asynchronous control settlement, while durable reads remain available. It checks `expectedEventId` before action and again after offline adapter construction. It delegates lifecycle, overrides, revisions and recovery to existing coordinator/service APIs. Start/resume install selected existing adapter factories lazily and acknowledge the run ID while retaining the drive promise. A new drive is refused until the old drive, report server and stop operation have settled. The coordinator independently enforces one active run and the database enforces one active attempt. The same service instance resets its stop flag only when admitting a subsequent drive. No queue or hidden retry is introduced.

Resume through management requires paused state; interrupted runs first need an explicit Phase 7.2 disposition and separate resume. Manual jump checks task-compatible cursor selection. Existing-run edits retain reason/audit, declared-outcome and unresolved-process barriers. All state/event writes stay with the coordinator and its transactions. `workflow import` reuses immutable revision storage; listing includes revisions also saved by run creation/editing. It does not add mutable named-workflow CRUD or re-import tasks.

Per-task settings and interrupted recovery remain CLI/service-only; the browser
has no settings editor or recovery-decision operation. Management resume admits
only paused state: explicit process resolution and recovery disposition must
precede a separate resume. Polling/paginated events replace the early SSE/log-tail
proposal; no raw-log or filesystem-browsing endpoint is exposed (spec §8).

Existing-run admission and revision validate live referenced inputs but exclude the checklist already frozen at creation. Status uses the active attempt's frozen settings, or the active task's current saved settings when there is no attempt, so paused model inspection agrees with subsequent execution.

SIGINT/SIGTERM or shutdown admission marks the facade closing, rejects new mutations and synchronously requests pause-after-current before acknowledgment. Teardown awaits any admitted control, rechecks pause and awaits drive settlement before closing connections/discovery/database. Shutdown acknowledgment precedes exit; a stage without a timeout can delay exit indefinitely. Clients may inspect while draining. Stop-now remains the explicit run termination action. If drive fails unexpectedly, its released guard permits conservative reconciliation into interruption; a safe failure notice remains visible in ping/status. No accepted report routes uncertain work, and restart never replays dispatch/signals.

An authenticated shutdown schedules the idempotent teardown after attempting its acknowledgment, independently of response delivery or client reset. Losing the acknowledgment cannot strand an admitted shutdown or convert graceful drain into stop-now.

Rationale: foreground ownership plus private loopback RPC is the smallest process model that lets independent CLI invocations control the actual child owner and lets the browser share the same application facade. Existing kernel ownership, SQLite revisions and recovery contracts avoid a second state authority or migration. Browser authorization integration is now described in §8.2; SSE, detachment and service-manager setup remain deferred.

### 8.2 Browser shell integration (Phase 8.1)

The same foreground daemon serves dependency-free HTML/CSS and compiled browser TypeScript at `/ui/`. There is no frontend server, database connection, second runner or new dependency. Build copies static assets alongside the compiled modules. Browser reload/disconnect has no lifecycle effect.

`wf ui` uses private CLI management authority to request a fresh, single-use, random browser pairing code (five-minute expiry). It prints the non-secret loopback address and code for deliberate entry into the page; neither daemon nor report credentials enter the browser. Codes are never URLs, bundles or daemon logs. Issuing a new code invalidates the previous unconsumed code. Pairing exchanges it for a memory-only session cookie (`HttpOnly; SameSite=Strict; Path=/ui`, 12-hour expiry); successful pairing rotates the single browser session. Restart revokes both. Loopback HTTP is not protection against malicious same-user processes.

Every browser route requires the exact `127.0.0.1:PORT` Host (DNS-rebinding protection). Browser POSTs additionally require the exact daemon Origin, JSON and a custom request header, with no CORS. API access requires the separate browser cookie, never management/report bearer authority. Pairing and API bodies use the existing 2 MiB/five-second bounds. Static responses prohibit framing, external resources, inline scripts, caching and referrer propagation via CSP and security headers. Workflow/task strings render as text, never HTML.

The browser API started as a separate strict preparation allowlist: session inspection/logout, saved revisions, run list, source loading, configured task preview, save immutable revision and create ready run. Phase 8.2 adds read-only draft validation/serialization below; Phase 8.3 adds run inspection/basic execution, and Phase 8.4 adds narrow paused revision/intervention operations. Preview/import and creation delegate to the existing management facade and share its validator. No recovery, raw-log endpoints, arbitrary filesystem browsing/reading, generic management forwarding or new migrations are exposed. Files are uploaded as text with their absolute original directory or selected from saved revisions; the editor can also create a new draft. Project/input selections and stage/policy controls update that draft before saving/creating. Preview writes nothing; create rereads and freezes the actual checklist, never starts execution. Original project files are not rewritten.

Stage/transition/policy/YAML editing is implemented in Phase 8.2 below; dashboard/basic controls in Phase 8.3 and paused-run editing in Phase 8.4 follow it. Permanent offline browser automation (Phase 8.5, §8.6 below) and the full visual-authoring Phase 8 gate pass, including their rerun in the final Phase 9.5 gate.

### 8.3 Draft editor integration (Phase 8.2; not execution dashboard)

The native editor keeps exact YAML text as draft authority. A read-only browser `draft` operation
parses, compiles and checks referenced paths with the existing application validator, returning
the canonical typed document and router-resolved normal/system transitions with provenance.
Visual mutations serialize that same document on the daemon; they never write source files.
Text edits immediately invalidate the prior visual snapshot. Explicit validation adopts only a
response for the current draft; parse/schema errors retain text and disable visual mutations,
while semantic/path errors retain a shape-valid model for correction. Save/create require
current successful validation and revalidate both source and configured input before writing.
Visual/input edits may normalize formatting, comments and canonical schema defaults; untouched
text preserves revision identity. Form groups apply explicitly; unapplied fields are discarded
when selecting another stage or validating text. Stable IDs and start/goto define execution,
never display order. The shared check result retains a shape-valid document through semantic
failure, and application inspection shares one parse/compile/path pass with summary validation.
No browser-specific policy resolver, database, execution endpoint or migration is added.

### 8.4 Run dashboard and basic execution controls (Phase 8.3)

`web/dashboard.ts` inspects one selected daemon-owned run. The strict browser request allowlist
adds only `status`, `reports`, exclusive-cursor `events`, `start`, `pause`, `stop` and `resume`.
Requests delegate directly to the existing management facade; response DTOs stay in the app layer,
not the pure contract layer. No browser state is execution authority and authorization is unchanged.
Status retains the consistent management snapshot of effective settings, active task/attempt,
elapsed time, accepted completion counts (null for graph-only), latest report and attention.
`configuredPermissions` lists every agent stage's harness and runner-selected permission mode
from shared adapter registry data, even when the cursor is an engine/task/command stage.
The dashboard displays this selection and host-access implications before Start/Resume;
invocation events remain separate observed launch evidence, not a pre-run compatibility claim.

The client refreshes status/reports and one 100-event page every two seconds, advancing only to
the returned exclusive cursor and retaining at most 300 fetched event rows. More history is
explicitly marked pending. Run-selection generations reject delayed responses from another run.
Reports, attention and events render inert text in bounded scrolling regions.

Each deliberate control uses the inspected `expectedEventId`, with nonblank stop/resume reasons.
The management facade retains stale-event rechecks, single-drive admission, process settlement,
global process barriers and explicit interrupted-recovery decisions. No automatic mutation retry
or recovery decision is added; Phase 8.4 extends the browser allowlist below. A control rejection or
transport/inspection error invalidates the UI cursor and stops refresh until explicit inspection;
successful controls refresh the resulting state. Stop response loss does not cancel daemon work.
Browser reload/logout/close/disconnect never signals or pauses the drive. Polling is intentionally
used instead of adding SSE or a second event transport.

### 8.5 Paused-run revisions and manual intervention (Phase 8.4)

`run-edit` requires a paused run and inspected `expectedEventId`, with no active attempt
or global unresolved-process barrier. Its read-only DTO carries exact immutable YAML/source
directory, run/revision/event/cursor/task identity, task summaries and effective declared
outcomes/routes. Existing `revisionCursor` checks determine compatible jump choices.
The existing `draft` operation optionally carries strict run/event context; run drafts
retain the original source directory and use canonical validation with `taskSourceConsumed`.
No checklist is read/reimported. No second validator or task-settings editor is introduced.

Browser `revise` and `override` reuse the existing strict management edit schemas (with
bounded revision text/reason) and delegate mutations to management after paused admission.
Management/coordinator serialization, event checks, settlement/process barriers and
transactional audit/state writes remain authoritative. Existing revision validation retains
root/task-source identity, pending task settings, compatible cursor and revision/session
scope. No engine, persistence or recovery semantics change.

`web/intervention.ts` binds a run revision draft to its inspected identity, reusing
`WorkflowEditor` in run mode; reusable save/create/preview are disabled. Polling/selection
never replace its text or target. Generation/exact-source checks reject delayed validation.
Mutation attempts invalidate that decision's submission authority; failures/ambiguity require
explicit fresh run inspection. Refreshing edit authorization retains text only for the same
run/revision, never silently rebases it. Changed revisions require explicit discard/reopen.
Reload discards unsaved drafts as before, without affecting execution.

Manual jump/skip/unfinished-task completion pins a separate decision and shows exact target
and consequences. Both revision/override paths require nonblank audit reasons and deliberate
confirmation. They leave the run paused, never fabricate reports or perform repository
repairs/rollback. Skipping even a task primitive does not complete/activate tasks; a skip retry
pauses through existing engine-only routing. Manual completion may clear the active task but
does not repair cursor compatibility. Repeat-stage side effects are explicitly warned about.
Stop now remains the ending control; interrupted-run recovery remains CLI-only.

### 8.6 Permanent offline browser smoke boundary (Phase 8.5)

`npm run test:browser` builds the real static application and runs three bounded Playwright
Chromium scenarios. Browser/package provisioning is explicit and separate; ordinary core
checks require neither a browser nor a provider. The dependency is pinned in the lockfile.

`test/browser/daemon.mjs` is a test-only foreground OS process. It supplies explicit fake
adapters for every registered harness, rejects unexpected launches, and never reaches installed
provider factories. Each scenario owns temporary project/state directories and pairs through
the ordinary UI. No fake switch, control endpoint, schema, migration or production authority
is added. The sole new fake-child mode reports through `wf report`, then waits for a fixture-owned
file before settlement; this proves lifetime independence without timing assumptions.

UI interactions exercise authoring, controls, revisions and overrides. Existing management
inspection supplies independent evidence; setup/concurrent-operator actions stay outside the
behavior under test. The fixture also reopens SQLite read-only after owner exit to compare
durable tasks, attempts, reports, events and selected frozen inputs. Explicit request gates
produce real stale-event rejection and delayed validation, never synthetic success responses.

One worker, no retries, bounded condition waits, isolated nonpersistent browser contexts,
loopback-only browser requests and uncaught-page-error checks keep this smoke reproducible.
Teardown uses existing stop/close supervision, reaps owned groups/owner, verifies listener and
discovery absence and durable state, then removes owned temporary state/output. Unproven
cleanup preserves state and fails. Profiles, traces, videos and pairing credentials are not
retained. This is bounded Chromium/390px coverage, not cross-browser coverage or isolation.



### 8.7 React app at `/ui/app/` (UI overhaul slice 1)

The redesigned interface is a React + TypeScript app in `ui/`, built by project-local Vite into
`dist/ui-app/` (`scripts/build-ui.mjs`, run by `npm run build`). The build also writes
`dist/ui-app/asset-list.json`, naming every emitted file and its content type; unexpected file
types fail the build. The daemon reads that list once and serves each listed file at exactly
`/ui/app/<path>` (`index.html` only at `/ui/app/`). Lookup is an exact map match, so paths outside
the list, encoded or `..` segments, the list itself and query strings return 404. List entries
must be plain relative segments with an allowed type, or loading fails. A missing list serves
nothing. Responses carry the same headers and CSP as `/ui/`; the build emits no inline script,
style or `data:` asset (`assetsInlineLimit: 0`, single CSS file). Routes are URL hashes, so no
daemon route is added. The legacy interface at `/ui/` is unchanged during migration.

The app uses the existing browser API, cookie, pairing and header contract without additions.
Run details read `status`, cursor-paged `events` (1000 per page), `reports` when a report is
accepted, `load` plus read-only `draft` of the run's revision for the map, and `run-edit` while
paused. Polling is every 2 s while running/pausing and 5 s otherwise, skipped in hidden tabs.
Controls send the inspected `expectedEventId`; paused-run overrides send the `run-edit`
snapshot's event and are disabled until it matches current status. One mutation runs at a time
app-wide, with inspection still available. A rejected or unanswered control is never resent;
unlike §8.4's dashboard, polling continues so the page shows the current state, and the user
must act again. Raw event JSON hides `logPath` and absolute paths under a `logs/` directory.

## 9. Testing strategy

**FakeHarness** is essential: configurable output sequence, report submission behavior, hang, nonzero process exit, output event streaming, session resume, and correction behavior. Drive the *real runner service* through real process boundaries where possible. Tests should not need network/API keys.

- Unit: strict parser, outcome membership, policy merging/conflicts, graph reachability warnings, task-loop semantics, interpolation errors, reducer determinism.
- Integration: real `wf report` invocation via local HTTP, accepted report once, invalid/duplicate submissions, correction once, report preserved before process settles, error routing, command exit mapping, timeout/kill, stop/pause/resume.
- Crash tests: kill runner at carefully chosen boundaries; restart and verify paused uncertain state, no silent replay.
- Adapter conformance (offline, no API keys): every harness adapter must pass the same suite the FakeHarness exercises — launch, stream parse, settle detection, accepted/invalid/duplicate report, correction-once, crash/timeout mapping, stop/terminate, and the no-resume fallback — before it is registered as supported.
- Adapter smoke: opt-in tests per installed harness (Codex, Pi, omp, OpenCode, Claude Code); capture version and fixture logs, avoid permanent dependence on volatile JSONL event fields beyond the adapter.
  Phase 6.8 implements the separate developer command `smoke:harnesses`, not a runner-management API. Admission requires `--execute` and explicit harness/model/scenario/time/artifact selection. Plan mode does no harness/authentication/artifact I/O after the npm build.
  Shared `createInstalledAdapter` dispatch serves offline inventory and smoke execution; `RunService`, its report channel, common supervisor and SQLite reopen remain the sole execution/state path. Smoke-only prompt decoration deliberately requests an omitted original report for correction, without changing runtime policy or report authority.
  A disposable tool helper checks actual `wf` acknowledgment; success also checks exact durable report content, session identity and ordered settled invocations. Report-only scenarios disable correction. Private artifacts remain; settled target projects are removed, uncertain ones preserved. Normal auth/resource discovery is retained, never replaced with empty HOME.
  Ordinary tests/check/build/probes never execute providers; synthetic CLI tests cover this developer surface. Live acceptance is recorded separately from tooling completion.
  The account-local `smoke:meta` convenience command reuses this same path with the owner's pinned Meta Contributor/low selection. Its explicitly authorized loader parses only `MUSE_SPARK_API_KEY` from the owner-only local secrets shell file as literal data, never executing the file or persisting the value. It maps the key to the selected adapter environment; Meta credential names join the existing allowlist/scrubber at both OpenCode boundaries and omp. A developer-only project-preparation callback writes credential-free OpenCode v2 provider configuration inside the disposable target. No global edits, provider client, workflow fields, migrations, engine model restrictions or new report/routing policy are introduced. Plan mode does not read credentials; exact live-execution admission remains separate.
- UI smoke: `npm run test:browser` permanently covers the complete visual two-stage gate, paused intervention/stale-state/draft pinning, and file-gated browser-lifetime independence (§8.6). Phase 9.1 audited the broader end-to-end scenarios; Phase 9.5 reran the offline/browser/smoke gates and added integrated real-CLI recovery proof. See the [archived implementation log](history/implementation-log.md) for exact historical results and limits.

**Verification:** Code changes require TypeScript typecheck, lint and relevant tests. UI changes also need applicable browser/visual checks. Use [development commands](development.md); ordinary verification needs no external LLM spend.

## 10. Current development direction

The original implementation order is complete and retained in the [archived MVP plan](history/mvp-plan.md).
Follow [todo.md](refinement-plan.md) for cleanup, the owner-led walkthrough/new guide, and subsequent UI design
and implementation. Keep these runtime contracts stable unless a concrete user problem requires
an explicitly documented behavior adjustment. Historical verification is in the [archive](history/README.md).
