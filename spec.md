# Product and Behavior Specification — Agent Workflow Runner

**Version:** MVP design v0.1  
**Status:** Implemented MVP; final offline gate passes (Phase 9.5 evidence in implementation log)  
**Related:** [Architecture](architecture.md) · [Implementation checklist](todo.md) · [Example workflow](examples/overnight.yaml)

## 1. Purpose

Build a local, user-programmable deterministic workflow engine for long-running coding-agent work. A user can import ordered tasks from a project's Markdown checklist and define a reusable sequence/graph of agent stages, command stages, and control stages. For each step the user declares permissible outcomes and transitions to take for each outcome. The engine launches the correct executor, accepts strict structured results, persists state, and chooses the next step according to the authored workflow. It does **not** use an LLM as a supervisor.

Primary use case: a developer with existing `spec.md`, `AGENTS.md`, and `todo.md` configures a workflow, presses Start, leaves the machine unattended, and later inspects the completed work or a paused/interrupted run. The developer may intervene, update remaining workflow stages, override the next position, continue, or end the run.

This is a **personal tool**, not an enterprise or commercial service. The UI should be straightforward; the configuration file should be readable and hand-editable.

### 1.1 Non-negotiable principles

1. **Workflow-defined behavior.** No mandatory tester, reviewer, branch, commit, checkpoint, human approval, or safeguard stage. The user may add any of these.
2. **Agent-reported outcomes drive branching.** Valid reports are accepted without judging the quality of code. Agent trust is a deliberate user choice.
3. **Strict contract.** An agent can report only outcomes declared for its current step. The engine validates the report; the agent cannot set current workflow state.
4. **Deterministic transitions.** Given the current persisted run state, accepted outcome, and configuration revision, the next engine action is unambiguous.
5. **At most one agent at a time.** Command and agent stages run sequentially; no overlap after a result is submitted.
6. **Explicit recoverability.** Events, reports, and transition decisions are durable. Uncertain side effects after crashes are not silently replayed.
7. **Editable from file and UI.** One canonical YAML data model; a visual editor and text editor expose the same underlying configuration.

### 1.2 MVP success scenario

A user imports 10 unchecked Markdown tasks, chooses a Codex implement stage followed by an optional Pi review stage and an optional Git command stage, runs the workflow, sees the current step and task in the UI, receives a human-attention item if an agent reports `blocked` or the runtime fails, and can resume after intervention. Any registered harness may take either stage (§2.4); the Codex/Pi pairing merely demonstrates that one workflow can mix harnesses. A fake executor test suite must exercise the same logic without API calls.

## 2. User-facing functionality

### 2.1 Projects and input documents

- Select a project root, and optionally explicit instruction files such as `spec.md` and `AGENTS.md`.
- Import flat or nested Markdown checkboxes, `- [ ]`, `- [x]`, `* [ ]`, into ordered task records. Preserve text and enclosing headings; nested items are separate tasks in source order, not implicit dependencies.
- Each imported task receives an internal stable ID within the run snapshot; record source path, original line/location where possible, title/body, completion state, order, and heading ancestry.
- Import excludes already-completed checkboxes from the runnable queue unless the user explicitly includes them.
- Import is an immutable snapshot: edits to Markdown do not change the active queue. Neither manual re-import into an existing run nor automatic sync/write-back is implemented; create a new run for a new snapshot (see §8).
- The engine's SQLite run state, not Markdown text or the agent's direct edits, is authoritative for progress.
- The user may also author one-off workflows with **no** task list.

### 2.2 Workflow authoring

- Author and validate YAML in a file or the local YAML/visual editor; import/list/save immutable reusable revisions and create runs from them. Editing saves a new revision, not a mutable named workflow. Duplicate/export can be done by copying/saving YAML externally; named-workflow duplicate/delete/export management commands are deferred (§8).
- Add, remove, reorder visually, and connect stages. Stable **step IDs** are distinct from display order and task numbers.
- Stages: `agent`, `command`, `task.next`, `task.complete`, and `end` in MVP.
- Agent stages specify a harness (see §2.4 "Supported agent harnesses"), optional model and reasoning effort, required `session: fresh | resume`, prompt/instruction references, permissible custom outcomes, context selection, and working directory.
- Command stages specify an argv array, working directory, environment overrides, optional `timeout_seconds`, and mapping from exit result to `complete`/`failed`.
- Each stage has transitions mapping outcomes to `{goto: step_id}`, `{pause: true}`, or `{retry: ...}` actions. A dedicated `end` step represents normal completion.
- Common transition policies can match all steps, steps by tag, or enumerated step IDs. Direct step overrides take precedence.
- For same-precedence overlapping policies, reject conflicts at validation rather than rely on YAML order.
- Engine-defined failures are branchable; an implicit catch-all defaults to **pause** if not overridden.
- Support a global workflow template across imported tasks. `task.next` / `task.complete` primitives implement loops without a separate hundred-node task graph.
- Support task-level **parameter overrides** in MVP (agent model/prompt, per-task skip and selected transition overrides). Entire per-task graph rewrites are postponed.
- A workflow validator checks references, transitions, outcome completeness, policy conflicts, unreachable steps (warning), dangerous infinite cycles without explicit limits (warning), and required fields. Validation does not judge task success or agent quality.

### 2.3 Execution and intervention

- Validate before starting; snapshot YAML definition, imported tasks, and selected project inputs for the run. Original project files remain in place, and the runner can read current content when explicitly configured.
- Launch stages sequentially; show task index, current stage, executor, harness/model, elapsed duration, latest report, and event history.
- Support user-requested **Pause after current step**, **Stop now**, **Resume**, **Restart current step**, **Skip current step**, **Jump to an allowed step**, **Mark task complete**, and **End run**. Dangerous manual overrides require an explicit choice and create an audit event, not covert state edits.
- Allow editing remaining workflow definition only while paused or before starting. Validate revised definition and create a new immutable revision associated with subsequent attempts; preserve prior historical revisions.
- A paused run can be resumed after external filesystem modifications. Ending a run does **not** roll back filesystem changes.
- A human-attention queue contains blocking requests, failures, and informative reports, with severity and a link to the originating attempt; informational messages need not pause execution.
- Progress percentages are shown only when a known task count exists, expressed as accepted `task.complete` count / imported runnable count. For graph-only workflows show stage and history, not fabricated percent complete.
- Workflow actions and run controls must also be available through a CLI or local API for testability; the UI is not the runtime.

**Phase 8.3 browser path:** selected-run inspection and explicit start/pause-after-current/stop-now/
resume delegate to the existing daemon management facade. Task progress counts only accepted
engine-owned completion; an accepted agent report does not advance it before settlement and
`task.complete`. Graph-only runs show no percentage. Event refresh uses exclusive cursors, not
a new event stream transport. Basic controls retain inspected-event, settlement and recovery
barriers, including nonblank stop/resume reasons and no automatic mutation retries. Browser
close/reload/logout never stops execution. Interrupted recovery stays in the existing CLI;
paused-run browser revision/manual intervention is implemented in 8.4 below. Permanent browser
smokes (8.5) prove the full Phase 8 gate; final Phase 9.5 verification is recorded in the implementation log.

**Phase 8.4 browser path:** a paused run's exact current revision/source directory opens in
the existing canonical YAML/visual editor, distinct from reusable workflow preparation.
Reasoned management `revise` creates/selects an immutable revision, preserving imported
tasks/progress and all historical attempts/reports/frozen settings. The consumed checklist
need not exist; unfinished task settings and existing session/revision restrictions still
apply. Removed/kind-changed or task-incompatible cursors require an explicit compatible
replacement. Apply leaves the run paused; resume is separate.

Explicit manual intervention exposes compatible-stage jump, declared-outcome skip and
selected unfinished-task completion, with target/consequences, nonblank reason and deliberate
confirmation. It never fabricates a report, completes a task merely by skipping a stage,
or resumes automatically. These controls do not implement, repair, reset or roll back files;
repeating a stage can repeat external side effects. Stop now remains available.

Run drafts/decisions pin their inspected run/revision/event. Polling, selection changes,
delayed responses and lifecycle changes cannot overwrite/rebind drafts. Stale/failed/ambiguous
mutations require fresh explicit inspection, not automatic retries. Revision authorization
can refresh without replacing text only for the same run/revision; changed revisions require
explicit discard/reopen. Ready/active/settling/interrupted runs cannot use these paused controls.
Interrupted recovery stays in the CLI. No new engine action or state owner is added.

**Phase 8.5 acceptance:** `npm run test:browser` runs three bounded offline Chromium scenarios
against disposable foreground daemons with explicitly injected fake adapters. The complete
visual-authoring → ready → explicit Start → blocked attention → visual revision → separately
explicit Resume path passes, retaining imported tasks and historical reports/attempt inputs.
Other scenarios prove deliberate audited intervention, stale rejection/fresh inspection,
unsaved draft pinning and active-operation reload/last-tab closure independence. No new
production authority or engine behavior is introduced. The final Phase 9.5 gate reran this suite successfully.


### 2.4 Supported agent harnesses

The engine is deliberately harness-agnostic: every harness is an adapter behind one interface, and the reporting contract (`wf report`) is identical for all of them. The MVP ships adapters for:

| `harness` value | Product | Headless invocation | Session resume used for report correction |
| --- | --- | --- | --- |
| `codex` | OpenAI Codex CLI | `codex exec` with JSONL events | `codex exec resume` |
| `pi` | Pi coding agent | `pi --print --mode json` | validated persisted journal/full UUID in its exact directory; no create on resume |
| `omp` | oh-my-pi (Pi-family) | `omp --print --mode json` | `--resume <exact-persisted-path>` |
| `opencode` | OpenCode | invocation-local `serve --stdio` + v2 API | exact persisted session API admission; no create on resume |
| `claude` | Claude Code | `claude -p` with `--output-format stream-json` | `--resume <session-id>` |

- Exactly one harness executes per stage; harness selection is a per-stage field, so a single workflow may mix harnesses (for example, implement with `codex` and review with `pi`).
- `harness` values are validated against a **registry** of installed adapters, not a hardcoded enum. Adding a harness is expected to be an ordinary adapter addition rather than a schema change: implement the adapter interface, register it, and pass the adapter conformance suite. This is **not** a plugin framework; dynamic third-party plugin loading remains deferred (see §8).
- Each adapter reports capabilities (`supportsResume`, `supportsEventStream`, `supportsStructuredFinalOutput`, `supportsPermissionMode`, `supportsModelSelection`, `supportsReasoningEffort`). A workflow requiring an unsupported capability fails validation/preflight with a user-facing message rather than silently degrading.
- Harness-specific launch flags, session identity, event framing, and settle boundary live only in the adapter. The engine never assumes provider-specific behavior, such as treating the first streamed agent message as the final result.
- Adapters must not leak report tokens or credentials into logs, and must pass each child process only a deliberate environment allowlist.
- MVP ordering: `codex` and `pi` are implemented first; `claude`, `opencode`, and `omp` follow the same interface and must pass the same conformance suite.

**Adapter acceptance (2026-10-19):** The Phase 6 gate passed with authorized Codex/Pi Luna/low reporting and exact-session correction. A later authorized omp/OpenCode `meta/muse-spark-1.3-contributor`/low pass also completed direct reporting and exact-session correction, with actual helper acknowledgment, sequential settlement, durable SQLite reopen and target cleanup. All registered adapters passed offline conformance in the **704-test** gate at milestone 0.5 completion. Claude's separately authorized `claude-haiku-5-5`/low exact-session correction passed after its earlier direct report: exactly two sequential invocations, one correction, matching persisted identity, real acknowledgment, durable reopen and target removal. **Milestone 0.5 is complete.** The historical omp OpenAI credential failure was not retried; the owner explicitly selected and authorized Meta Contributor and the named local secret source. omp's streamed assistant provider/model fields matched that selection; Claude's assistant and terminal model evidence matched Haiku. OpenCode's private transport does not expose independent actual-model evidence. Earlier OpenCode diagnostics exposed an unknown configured MCP credential, confirming the known-value scrubber limitation; raw artifacts remain private. These results supersede only exercised paths' live-pending statements below. See `docs/harness-compatibility.md` for evidence and limits. Phase 7.1 was subsequently authorized separately; its headless runtime contract is in §6. Headless 7.2 and management 7.3 were later authorized separately; 7.4 was subsequently authorized for offline implementation; 7.5 onward and further paid execution require new authorization.

The following Phase 6 notes describe evidence **at implementation time**.
Their pending live-verification statements are superseded only by the later
scoped acceptance above and the compatibility record, not by fresh offline tests.

Phase 6.1 provides an offline-conformant Codex CLI adapter through the headless service API. It uses stdin prompts, explicit persisted session UUIDs, JSONL process/session evidence and the common `wf report` channel. Version and selected unrestricted permission mode are audited. Authentication and provider-backed stream/resume compatibility remain unverified; the full Phase 6 live gate remains unfinished. See `docs/harness-compatibility.md` for evidence and limits.

Phase 6.2 adds the offline-conformant Pi adapter for the installed earendil package. One-shot JSON uses LF-only streaming UTF-8 decoding and requires `agent_settled` plus process/group/pipe settlement. Low-level `agent_end` and transient retry failures cannot settle the attempt. Unrecovered final provider failures, aborts or malformed streams are technical errors, including on exit zero. Resume validates the persisted session file/header/cwd and uses its exact UUID within its dedicated storage directory, without create-if-missing or latest-session flags. Model/thinking selection, report access and default unrestricted tools use the existing contract; no workflow fields or migrations change. Live provider/session verification remains unfinished.

Phase 6.3 adds the offline-conformant Claude Code print adapter: stdin prompts, bounded stream-json parsing, terminal `result` success evidence and common process/group/pipe settlement. It keeps CLI persistence enabled and resumes only the exact persisted UUID with `--resume`; unavailable sessions and mismatches fail without fresh fallback. Existing model/reasoning settings map to `--model` / `--effort`, and the selected unrestricted `bypassPermissions` mode plus CLI version are audited. Reports, correction limits, revision scope and routing remain unchanged. Authentication and provider-backed stream/session behavior remain unverified.

Phase 6.4 adds the offline-conformant OpenCode v2 private API adapter. A leased, supervised server per invocation avoids CLI `run --session` create-if-missing behavior without touching OpenCode's shared service. Exact prompt acknowledgment, wait-for-idle, matching session/cwd and a fresh persisted successful outcome are required, followed by process/group/pipe settlement. Missing sessions cannot be created by resume. Existing model/reasoning fields select provider/model and named variant; explicit session-level allow-all permission rules are audited as `session-allow-all`. This minimal API path does not expose provider event streams (`supportsEventStream: false`). No workflow fields, mandatory approvals, daemon management or migrations are added. Reports and one bounded correction retain the existing contracts; authenticated/live success remains unverified.

Phase 6.5 adds omp as a verified Pi-family dialect, reusing process supervision/reporting but not assuming Pi lifecycle or resume behavior. One-shot JSON requires a final successful assistant and `agent_end.isTerminal: true`, not Pi's `agent_settled`, followed by process/group/pipe settlement. Native retries and omp's `auto_compaction_*` events may recover. Exact persisted journal paths use the installed non-creating resume branch; missing, mismatched and moved-away sessions fail without fresh/latest/fork fallback. Existing model/reasoning settings select `--model` / `--thinking`, including `auto`; `--approval-mode yolo` and CLI version are audited. All shared offline conformance cases pass. Reports, correction policy, session scope, workflow fields and migrations are unchanged; live-provider verification remains open.


Phase 6.6 connects existing offline factory probes to explicit installed-adapter capability snapshots and per-attempt service preflight. Static registry validation remains pure; installed capability checks use the selected adapter and frozen effective settings immediately before the affected invocation. Missing optional selectors preserve supported fresh work. Unsupported requested model/reasoning selection routes `system.spawn_error`; unsupported explicit resume routes `system.resume_unavailable`, with useful failure details and no provider execution/correction. Help evidence never proves runtime session availability; exact admission remains adapter-owned. Inventory uses the same factories, and structured-final-output capability is false for current transports because no stdout reporting fallback is implemented. Snapshots require adapter recreation after CLI changes; authentication/live compatibility remain unverified. No YAML fields, migrations or report/routing policy were added.

Phase 6.7 closes the offline adapter environment/log boundary audit. All owned children, including OpenCode's nested private server, receive deliberate selections without changing supported authentication/configuration or unrestricted permission choices. Known injected credential representations are scrubbed across stream chunks before capture/logging; bounded scrubbed stderr diagnostics and truncation flags accompany invocation settlement. Known-credential/report-token redaction history stays in memory until channel shutdown and cannot authorize another submission. Command overrides and output behavior remain unchanged. This is neither isolation nor recognition of arbitrary unknown secrets; harness-owned files and live tool/provider behavior remain outside the verified boundary. No workflow/report fields, migrations, routing or mandatory gates change.

## 3. Canonical workflow schema (v1 proposal)

> Implementation decisions for this section (field names, open semantics, deviations) are recorded in [`docs/schema-v1.md`](docs/schema-v1.md).

### 3.1 Document top level

YAML is parsed into a versioned typed data model, validated (e.g., by Zod or JSON Schema), and **compiled** into a deterministic transition table before a run. Extra unknown fields are errors, not silently accepted.

| Key | Meaning |
| --- | --- |
| `version` | Required integer; MVP accepts `1` |
| `name` | Human-readable workflow name |
| `project.root` | Project directory; relative to workflow file or selected via UI override |
| `project.instructions` | Ordered instruction paths to include in agent context |
| `tasks` | Optional Markdown checklist source |
| `start` | ID of initial step |
| `defaults.on` | Global fallback outcome transitions |
| `defaults.report_correction_attempts` | Default **1**, supported values `0` or `1` |
| `policies` | Optional scoped outcome-to-transition mappings |
| `steps` | Map of stable step ID to step specification |
| `limits` | Optional max wall-clock runtime, committed stage transitions and agent idle timeout; retry budgets belong to transition actions |

The parser must reject duplicate YAML keys, invalid interpolation, unknown outcome names, and conflicting effective transition definitions. The engine's own names are prefixed `system.` and cannot be declared as agent outcomes.

### 3.2 Types of steps

**`agent`**: fields `harness`, optional `model`, optional `reasoning_effort`, required `session: fresh | resume`, `prompt` or `prompt_file`, `instructions`, `cwd`, `outcomes`, `on`, optional `tags`, `timeout_seconds`, `context`. An agent stage receives the current task if present. Resume selects a persisted identity in the same harness/run/task/revision scope and requires exact non-creating adapter admission; missing/unavailable identities fail with `system.resume_unavailable`, never a fresh/latest/selector fallback.

**`command`**: fields `argv: string[]`, `cwd`, optional `env`, `timeout_seconds`, `on`, optional `tags`. Spawn without a shell by default. Shell syntax is allowed only through an explicit shell executable in `argv` (e.g., `['sh','-lc','...']`). Exit code 0 maps to `complete`; a nonzero exit maps to `failed`. Spawn errors map to engine outcomes.

**`task.next`**: requires task source. Select first not-completed task if no task is active; returns `task_ready` or `exhausted`. If a task is already active, this step produces `system.task_state_error` rather than silently skipping it.

**`task.complete`**: requires an active task. Marks that task completed in engine state, clears active-task pointer, returns `complete`; `system.task_state_error` otherwise. This is an explicit workflow operation, not an automatic consequence of an agent claiming success.

**`end`**: marks the run `completed` with an optional label. It does not require an outgoing transition.

### 3.3 Transitions and policies

Supported transition values in v1:

```yaml
on:
  complete: { goto: review }
  needs_debugging: { goto: debugger }
  blocked: { pause: true }
  system.timeout: { retry: { max_attempts: 2, backoff_seconds: 30 } }
  system.error: { pause: true }
```

- Exactly one action per transition.
- `goto` is a declared step ID. `pause` stops scheduling new steps and opens an attention item. `retry` reruns this step (or the configured action target, if an explicit extension is later added), counts attempts durably, and emits `system.retry_exhausted` if the bound is reached. On `retry_exhausted`, a more specific rule can handle it, otherwise `system.error` pauses. **Retries do not imply rollback or safe idempotency.**
- `system.error` is a catch-all fallback for runtime-produced errors and **must be supported implicitly as `{pause: true}`** so an unexpected engine failure never becomes a silently accepted success.
- Effective routing order for an exact outcome: `step.on` > policies targeting explicit step ID > policies targeting tag > policies targeting all steps > `defaults.on`. If an engine error has no exact match, resolve `system.error` through the same levels, then the built-in pause. All normal agent outcomes must resolve to an exact rule. An explicit outcome match always beats a catch-all.
- Policy selectors accept `{tags: [...]}` (match if any listed tag), `{step_ids: [...]}`, or `{all: true}`. Two policies of equal specificity resolving the same outcome to different actions are a load-time error; do not invent ordering priority.
- A more-specific policy can override a global rule; direct step policy always wins. Prefer named tags over ordinal step ranges.
- Task-level overrides are stored in the **run configuration** against imported run-local task IDs (rather than in the reusable YAML, which is project-independent). They are applied when selecting a task before executing its stages and must pass the same validation before execution.
- The implemented run-local shape is `{steps: {step_id: {model?, prompt?, skip?: {outcome}, on?}}}`. Only existing agent/command steps can be specialized; model/prompt require an agent. Inline prompt replacement supersedes `prompt_file`. Selected `on` entries override step rules using existing validated actions/outcomes/targets. Harness, session policy, outcomes, new steps and task-control steps cannot be changed through task settings.
- A configured skip takes an explicitly chosen declared normal outcome without launching a process or fabricating a report. It writes an audit event and a transition without an attempt; the graph still controls task completion. A retry on a skipped step pauses, and skip cycles obey the engine-step bound.
- Task settings can be replaced/cleared for unfinished tasks only while `ready` or `paused`, with no active attempt and a nonblank reason. Each attempt freezes its effective task settings. Model/prompt edits preserve the existing same-harness/run/task/revision session rule.
- A workflow revision applies to future occurrences of remaining stages, including repeated loop stages; historical executions never change. Revisions require `ready` or `paused` with no active attempt and a reason. They retain project root, task source, imported queue and progress, and validate all unfinished task settings. Removed/kind-changed cursor steps require an explicit valid `cursorStepId`; task-control and visible task-placeholder preconditions must also hold. Files read only during preparation (such as prompt-file content) retain pre-execution validation.
- Subsequent attempts reference the selected immutable revision. Resume never crosses revision IDs; a changed definition requiring resume must establish a session in that revision or fail before launch. Identical YAML/source-directory revisions reuse their existing identity under the store's content deduplication rule.

### 3.4 Template interpolation and handoff

Only allow fixed, explicit placeholders, with no arbitrary code or template evaluation:

- `{{task.id}}`, `{{task.text}}`, `{{task.index}}` when a task is active.
- `{{project.root}}`, `{{run.id}}`, `{{run.cwd}}`.
- `{{reports.<step_id>.summary}}`, `.issue`, `.handoff` for the most recent completed instance of that step in the **current task iteration**, or latest overall when no task is active.
- `{{steps.<step_id>.stdout}}` for the most recent successful command instance, subject to bounded output capture.

Unknown/missing placeholders are validation or pre-execution errors; they never become empty strings silently. No expressions, loops, system command substitution, or file reads inside interpolation. Agent context explicitly includes the named instruction files, current task, prompt, and prior reports selected by `context.include_reports: [step_id, ...]`; missing optional prior reports are omitted from that injected context, while missing **referenced interpolation placeholders** are errors. Avoid automatically concatenating full transcripts.

**Paths:** `cwd` defaults to project root; an explicit path may be relative to the project root or an absolute path. The runner should permit user-authorized alternative working directories (e.g., worktrees) without assuming it manages those worktrees. A command can create a known path, and subsequent steps can point to it. Never assume that `cd` in a subprocess persists across steps.

## 4. Agent reporting contract

### 4.1 Required report

Every `agent` step must finish with exactly one **accepted** report. A normal result shape:

```json
{
  "outcome": "complete",
  "summary": "Implemented login validation",
  "issue": null,
  "handoff": "Touched src/auth.ts and tests/auth.test.ts",
  "data": {}
}
```

- `outcome`: required, must be in step's declared `outcomes`. `system.*` is forbidden here.
- `summary`: required non-empty human-readable string with a bounded maximum size.
- `issue`: optional nullable string.
- `handoff`: optional string or attached text-file content, size limited.
- `data`: optional JSON object, size limited. Can carry structured context, not arbitrary instructions to the engine.
- Include engine-issued `run_id`, `step_id`, and `attempt_id` in the persisted envelope, not as model-authored authority fields.
- A report does **not** directly mark a task complete, transition to the next node, or rewrite workflow state.

### 4.2 CLI submission

MVP supports a local `wf` CLI installed/available on agents' PATH:

```bash
wf report complete --summary "Implemented login validation" --handoff-file handoff.md
wf report blocked --summary "Need a secret to continue" --issue "Missing deployment credential"
```

The CLI reads an engine-provided attempt-scoped endpoint/token from its environment, sends the report to the **running local engine**, validates synchronously, and returns a useful exit code and human-readable error for invalid submissions. The engine validates again before writing an accepted report transactionally. The CLI cannot write arbitrary run-state or transition objects. Never leak the report token into logs or UI reports.

A file/structured-final-response fallback is deferred; current adapters advertise `supportsStructuredFinalOutput: false`. Only acknowledged `wf report` submissions have report authority. No stdout normalization or separate formatting LLM is implemented.

### 4.3 Submission lifecycle and one bounded correction

1. Engine launches an agent attempt and injects a report contract listing **only the declared outcomes**, plus the `wf report` instructions.
2. Engine may receive zero or more **rejected** reports while the agent is active. Invalid status, malformed shape, or missing fields produce immediate error replies to the agent. Rejected submissions never mutate run state.
3. On the first valid submission, persist the accepted report. Reject later submissions for the same attempt as duplicate. **Do not advance while the agent process is still active.**
4. When the agent's execution has conclusively settled with successful process status, use the accepted report to route. If it ended without an accepted report, allow exactly **one extra follow-up turn** in the *same persisted session*, if the adapter supports it.
5. Follow-up prompt: clearly state that the prior report was missing/invalid, list valid outcomes and schema, request only a compliant report, and explicitly say not to modify source files during correction. The engine can constrain the correction turn with a short timeout; no second correction.
6. If the correction produces a valid report and the harness settles cleanly, route normally. Otherwise emit `system.report_error` and **pause by default** unless the workflow explicitly routes that outcome elsewhere. A failed correction invocation (including timeout/process/provider failure) also follows this rule; retain its technical cause in invocation history and preserve any earlier report for diagnosis.
7. If session resume isn't supported or possible, emit `system.report_error` immediately (do not invent a new session that lacks context).
8. An agent **process/provider failure** (nonzero crash, impossible launch, rate limit, timeout) is **not** treated as a mere formatting mistake; route to `system.process_error`, `system.spawn_error`, `system.timeout`, or another technical error without automatically asking the model to repair a report.

This correction is separate from user-configured workflow retries. `defaults.report_correction_attempts` is `1` by default, optionally `0`, never unlimited.

### 4.4 Precedence of observable outcomes

- Cleanly settled agent + accepted report => agent's reported outcome.
- Cleanly settled agent + no accepted report => bounded correction, then `system.report_error` if unresolved.
- Original invocation nonzero process exit, terminated process, timeout, or adapter-level failure => corresponding **system** error, even if a report was submitted earlier. Preserve earlier report for diagnosis; never silently call the step successful.
- User stop request => `cancelled`/`stopped` run control, not a fabricated agent success.
- Crash before the engine can know whether a subprocess completed => `interrupted` / uncertain state on restart; do not automatically re-run side-effectful work.

## 5. System errors and default policy

Minimum normalized codes: `system.spawn_error`, `system.process_error`, `system.timeout`, `system.report_error`, `system.resume_unavailable`, `system.task_state_error`, `system.retry_exhausted`, `system.interrupted`, `system.internal_error`. Adapters may attach a detailed vendor code in metadata, but routing is based on stable normalized codes.

Every system error has a safe deterministic path: matching explicit rule, matching `system.error`, or built-in pause. No silent ignore. A failed attempt is visible in the human queue. The engine does not automatically retry an outage, token-limit failure, or broken command unless the workflow explicitly says so.

## 6. Lifecycle and safety of user control

Run states: `draft`, `ready`, `running`, `pausing`, `paused`, `completed`, `stopped`, `interrupted`. Individual attempts have `created`, `starting`, `running`, `settling`, `succeeded`, `failed`, `interrupted` states. No concurrent active attempts in MVP.

- **Pause after current step:** sets `pausing`; after current step settles, persist pause instead of dispatching next. If no step is active, pause immediately.
- **Stop now:** terminate active process tree, record that files may have partial changes, mark run `stopped`. Stop is not a Git rollback.
- **Resume:** management accepts only paused runs, after validating selected revision/cursor and resolving process barriers. Interrupted runs first require an explicit reasoned recovery disposition, which leaves non-ending choices paused; resume is a separate action.
- **Manual advance/skip:** may override the run cursor or mark a task complete; requires an explicit user action and reason, recorded in history. The UI should explain that it does not alter the codebase automatically.
- **Edit while paused:** create a revised workflow snapshot; reject invalid revisions or edits referring to now-missing active step without an explicit new cursor.
- **Run retention:** durable history remains inspectable. Run deletion/archive/hide controls are deferred (§8); ending a run does not delete its project or undo external side effects.

Permissions: the runner executes processes on the user's machine, using the chosen harness options (including unrestricted or 'yolo' permissions where supported). It must not impose approval gates. The UI should clearly display the selected permission mode because arbitrary shell commands and unrestricted agents can modify any files accessible to the user. No claims of sandboxing or guaranteed rollback.

**Implemented headless recovery (Phase 7.1):** A writer holds an exclusive lease for its canonical state database; competing writers fail before migration or execution, while explicitly read-only inspection remains available. The first runner service on that connection reconciles persisted running/pausing runs, including between-step cursors, into `interrupted` with transactional history and blocking attention. It never signals a recovered process, routes a retained report or replays work automatically.

Commands and all agent/correction invocations record Linux boot/start identity with PID/PGID/session. Invocation intent is committed before spawn and clears stale process identity. A restart in that gap is unknown, not proof that nothing ran. Surviving, mismatched or unverifiable process evidence blocks new execution until observed absence or an explicit operator cleanup confirmation. Identified process exit does not establish side-effect success; explicit interrupted resume still needs a reason acknowledging uncertain effects.

**Implemented headless decisions (Phase 7.2):** Inspect durable recovery evidence, explicitly terminate a verified orphan, or attest independent external cleanup for unidentified/mismatched operations. Confirmation cannot override fresh evidence of a surviving owned group and never relabels unknown evidence as observed absence. It trusts the operator's assertion, not an automatic proof that all descendants/effects are settled. Termination records intent before signalling, rechecks identity and waits boundedly for group absence; startup never replays it. Every action requires the exact inspected attempt/event cursor and a reason. State, resolution and audit events commit together.

After process resolution, explicitly retry the interrupted stage, continue a committed between-step cursor, skip via a declared outcome, jump to a task-compatible step, or end as stopped. Non-ending decisions leave the run paused for separate resume/drive. No retained report routes the interrupted attempt; no recovery action declares its side effects successful. Reports, frozen inputs, sessions, correction counts and historical transitions remain intact. No daemon manager, management CLI/UI, provider usage or mandatory workflow quality gate is added.

### 6.1 Implemented management surface (Phase 7.3)

The explicit foreground `wf daemon start` owns the database and one drive at a time. Separate CLI invocations share its authenticated loopback API; closing a client has no effect on execution. State selection is `--state-dir` > `WF_STATE_DIR` > `${XDG_STATE_HOME:-~/.local/state}/workflowz`, using a current-user directory with mode 0700. Graceful daemon shutdown pauses after the current step and awaits settlement; `run stop` explicitly terminates the owned operation. Startup reconciles uncertainty without replay or automatic resume.

`wf workflow validate/import/list`, `wf tasks preview`, and `wf run create/list/start/status/events/tasks/reports/pause/stop/resume/override/revise/task-overrides` expose the existing engine contracts. Import stores an immutable definition/source-directory revision; create from a file or imported revision freezes the checklist read at creation and returns a ready run. Start/resume return admission and the run ID, with execution in the daemon; status is polled separately. Every existing-run mutation supplies the inspected `expectedEventId`; stale requests fail before control, with no automatic retry. Resume requires paused state; interrupted runs first require a recovery decision. Overrides are explicit reasoned jump/skip/mark-task-complete actions; task settings and revisions retain their existing constraints.

`run recovery/reconcile/recovery-terminate/recovery-confirm/recovery-decide` expose the unchanged strict Phase 7.2 requests and durable evidence. Exact event/attempt/reason checks, unresolved-process barriers, and retained-report rules remain enforced. Decisions do not automatically resume execution.

Existing runs start, resume and revise using their immutable task snapshot without requiring the original checklist file. Other live referenced inputs retain their path checks. Paused status applies the active task's saved model settings; an active attempt reports its frozen settings.

Event listing returns increasing IDs after an exclusive cursor, with a limit of 1–1000 (CLI default 100), `nextAfter` and `hasMore`. Status includes cursor/task, active attempt, selected executor/harness/model, elapsed time, latest report, attention and accepted task progress when a task source exists. `--json` returns one JSON result or error; management exits 0/1/2 for success, validation/control/transport rejection, and CLI/input-file errors respectively. Local validation works without a daemon and uses the same validator as the API. `wf report` retains its separate attempt-scoped endpoint/options/acknowledgment and cannot authorize management. No UI/SSE, detached service, job queue, retry/backoff extension or provider execution is part of 7.3 acceptance. See [CLI usage](README.md#management-cli-and-local-daemon-phase-73).

### 6.2 Run limits and bounded stage retries (Phase 7.4)

The existing v1 fields are enforced without adding mandatory limits or retry rules:

- `max_step_executions` counts committed transitions, including engine primitives/skips. `max_wall_time_seconds` uses the original run start, including pauses, downtime and backoff. Counts and start time survive revisions/restarts. Exhaustion pauses with an attention item. Resume does not replenish limits; a paused revision can change them.
- Remaining run wall time caps each command/agent/correction invocation. Expiry requests supervised process-group termination; settlement/reaping/log closure still precede routing or another operation. No new invocation/correction starts with an exhausted wall budget. A run limit pauses even if its observed timeout has an explicit route. An original timeout bypasses correction; a failed correction retains `system.report_error` and its diagnostic timeout cause.
- A transition retry counts all logical attempts of that step in the current task, or the entire taskless run, including the first. `max_attempts: 2` permits a retry only while that count is below two. Counts do not reset on revision or manual continuation. Explicit `goto` loops remain governed by the graph and run limits. Correction and harness-native retries do not consume an additional stage attempt.
- `backoff_seconds` establishes a durable admission deadline when the retry transition commits. No attempt is created until due. Pause/shutdown preserve the deadline and wake the wait; resume waits only the remainder. Startup never drives a saved wait. A between-step crash requires explicit recovery continuation plus resume. Manual jump/skip/end, completing the active task, or changing the revision cursor cancels the wait. A revision keeping the cursor retains it.
- `agent_idle_timeout_seconds` measures no stdout/stderr bytes on either stream since invocation launch/latest output, before redaction/capture bounds. It applies to original and correction invocations, never commands. Silence routes `system.timeout` after owned cleanup; correction failure remains `system.report_error`. Any output resets idle regardless of usefulness. Silent provider work can time out; OpenCode's minimal API transport has less observable activity. This optional setting is not semantic progress detection.

No global retry-budget field, provider call, automatic recovery replay or workflow quality gate is introduced. Backoff delays are not permissions to overlap work or roll back prior effects.

## 7. UI requirements


**Workflow editor:** explicit project/instruction/checklist paths, task preview, immutable revision save/load, stage list/connectors, stage details (type, harness, model, prompts, cwd, outcomes), outcome-to-next-step controls, global/tag/step policies with effective-transition preview, canonical YAML validation and ready-run creation. No filesystem picker/browsing or named-workflow CRUD.

**Runner dashboard:** run status; active task/stage and harness; progress when known; paginated events, report details and attention; pause/stop/resume; paused revision/manual intervention. Inspect raw bounded logs locally using invocation paths; no browser log tail. Per-task settings and interrupted recovery remain CLI-only.

The browser UI is a client; closing the tab does not terminate the runner. UI is served locally, with no required cloud account. Prefer localhost binding and no open remote administrative interface by default.

**Implemented preparation/editor (Phases 8.1–8.2):** `wf ui` pairs a separate browser session with the explicit foreground daemon. Upload a workflow with its original absolute directory, select a saved revision, or create a new draft. Project/instruction/checklist selections, all five stage kinds, direct outcome actions, defaults and all/tag/explicit-step policies share the canonical YAML model. Stable IDs and start/goto define execution; reordering only changes display. Compiler/router output displays effective normal/system transitions, precedence and provenance, including catch-all/built-in fallback. YAML input invalidates prior visual state immediately; explicit validation retains invalid text and supplies parse/schema/compile/path diagnostics with available locations. Parse/schema failures disable visual mutations; shape-valid semantic/path failures remain visually correctable. Save/create require a currently valid draft and revalidate on the daemon. Visual/input edits may normalize comments/formatting/defaults, never rewrite original files. Saving creates/reuses an immutable revision; task preview creates nothing, and creation rereads/freezes actual tasks into a ready run without execution. Old revisions and runs remain unchanged. Browser reload discards unsaved inputs, not daemon state. Dashboard controls and paused-run editing are implemented separately in 8.3–8.4; the full Phase 8 gate passed permanent offline Chromium coverage in 8.5. Phase 9/MVP remain incomplete. See architecture §8 for authorization, drafts and run intervention.

## 8. MVP scope and non-goals

### Included

- Engine; schema parser/validator; persisted one-at-a-time stage execution.
- Markdown checklist import and engine-owned task queue.
- Harness adapters for `codex`, `pi`, `omp`, `opencode`, and `claude` (Claude Code), plus a deterministic command executor. The `codex` and `pi` adapters are implemented first; the rest follow the same interface and must pass the same conformance suite.
- `wf report` CLI and strict outcome validation with one correction turn.
- Explicit transition graph, scoped rules, loops, error routing, run revisions.
- Pause, stop, resume, manual override, event/report/log history.
- Small local UI + CLI commands for headless testing and control.

### Deferred features and permanent non-goals

This is the canonical scope boundary; "deferred" is not a promise to implement.

| Area | Not implemented / not claimed |
| --- | --- |
| Workflow authority (non-goal) | No supervisor LLM, automatic quality gate, mandatory reviewer/test/approval, repository repair or automatic rollback. The author may explicitly add review/test/Git steps. |
| Scheduling | No parallel workers/agents, job queue, distributed or multi-host scheduling, complex dependency scheduler or worktree-merge orchestration; one active operation/run per state database. |
| Service lifecycle | No service manager, detachment, auto-start/restart, daemon log rotation or automatic driving/resume after restart. Start the foreground owner explicitly; uncertainty requires a decision. |
| Task source | No manual re-import into an existing run, Markdown auto-sync or completion write-back. Create another run for another immutable snapshot. |
| Workflow library | No mutable named-workflow CRUD, named duplicate/delete/export commands, or run delete/archive/hide controls. Import/list/save immutable revisions and create/revise runs; copy/save YAML externally. |
| Inspection transports | No SSE/event stream, raw-log endpoint, UI log tail or filesystem-browsing endpoint. Use polling, paginated events/reports and local bounded log files. |
| Per-task settings | CLI/service only; no task-settings editing UI. Whole per-task graph rewrites are also deferred. |
| Interrupted recovery | CLI/service only; no browser recovery decisions. Resolve processes, choose a disposition, then separately resume. No automatic replay. |
| Extensions | No dynamic third-party plugin loading/marketplace. In-tree adapter additions and their conformance suite are supported. No nested subworkflow interpreter or arbitrary transition code/expressions/dynamic running-graph rewriting. |
| Reporting | No stdout/file/structured-final-output report fallback. `wf report` is mandatory; one bounded exact-session correction is not an unlimited retry policy. |
| Presentation/integrations | No polished drag/drop graph canvas, notifications/integrations, cloud sync, enterprise RBAC or autoscaling. AI-generated workflows without review are outside scope. |
| Isolation (non-goal) | No sandbox/isolation or guaranteed rollback claim. Unrestricted harnesses and explicit commands can modify any user-accessible files; escaped descendants and arbitrary external effects remain outside process-group guarantees. |

**Rationale (Phase 9.5):** These boundaries reconcile the early design sketches
with the already implemented immutable snapshot/revision model and narrow
management/browser allowlists. Adding re-import identity merging, mutable
workflow entities or another transport solely to satisfy aspirational prose
would expand state authority and recovery obligations without improving the
accepted MVP path. This is a documentation cutover, not a schema, migration,
report, CLI/RPC or recovery behavior change.

## 9. End-to-end acceptance scenarios

1. **Happy path:** Mock agent reports `complete`; optional command exits 0; explicit `task.complete` increments progress; next task begins; run reaches `end`.
2. **Custom branching:** Mock agent reports `needs_debugging`; debugger stage executes; defined branch resumes requested stage.
3. **Undeclared outcome:** `wf report not_declared` receives rejection; engine does not change step. If agent then submits valid outcome before exit, run proceeds.
4. **Missing report:** Agent exits cleanly without report; exactly one correction turn is issued; valid correction proceeds; invalid correction triggers `system.report_error` -> paused by default.
5. **Provider unavailable:** Agent spawn/transport fails; report correction is **not** invoked; matching system error policy runs.
6. **Command failure:** Exit code !=0 becomes `failed`; configured transition executes; no engine-imposed verification.
7. **Session/context:** Fresh review step sees current task and selected preceding report only; resume step uses correct prior session identity.
8. **State persistence:** Stop/restart runner after completed stage; no duplicate automatic execution of committed stage.
9. **Crash uncertainty:** Kill runner during agent or command; recovery identifies in-flight attempt as uncertain and pauses rather than replaying automatically.
10. **Manual edits:** Pause, modify workflow, validate new revision, manually choose next step, resume; history remains tied to previous revision.
11. **Policy precedence:** Tagged policy works across steps; direct step override wins; ambiguous equal-precedence policies are rejected.
12. **No-task workflow:** Standalone agent/command graph runs without a task source.
13. **UI disconnect:** Close browser while runner is active; run continues and can be reconnected to.

## 10. Engineering choices explicitly delegated to implementation

Use boring, widely supported libraries. Keep database schema migrations modest and testable. Choose exact package versions after checking the installed Node and harness CLI versions. Favor real process-boundary tests with a fake harness over elaborate in-process mocks only. Implement core execution and CLI end-to-end before building a polished visual editor.
