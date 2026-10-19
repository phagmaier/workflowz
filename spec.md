# Product and Behavior Specification — Agent Workflow Runner

**Version:** MVP design v0.1  
**Status:** Ready for staged implementation  
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
- Import is a snapshot: edits to Markdown while the workflow runs do not silently change the active queue. Manual re-import is allowed while paused, with a preview of additions/removals and preserved existing task IDs when resolvable.
- The engine's SQLite run state, not Markdown text or the agent's direct edits, is authoritative for progress. Read-only task import initially; automated `todo.md` write-back is **not required in MVP**.
- The user may also author one-off workflows with **no** task list.

### 2.2 Workflow authoring

- Create, edit, duplicate, delete, import, export, and validate a named YAML workflow.
- Add, remove, reorder visually, and connect stages. Stable **step IDs** are distinct from display order and task numbers.
- Stages: `agent`, `command`, `task.next`, `task.complete`, and `end` in MVP.
- Agent stages specify a harness (see §2.4 "Supported agent harnesses"), optional model and reasoning effort, fresh/resume session policy, prompt/instruction references, permissible custom outcomes, context selection, and working directory.
- Command stages specify an argv array, working directory, environment overrides, timeout, and mapping from exit result to `complete`/`failed`.
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

### 2.4 Supported agent harnesses

The engine is deliberately harness-agnostic: every harness is an adapter behind one interface, and the reporting contract (`wf report`) is identical for all of them. The MVP ships adapters for:

| `harness` value | Product | Headless invocation | Session resume used for report correction |
| --- | --- | --- | --- |
| `codex` | OpenAI Codex CLI | `codex exec` with JSONL events | `codex exec resume` |
| `pi` | Pi coding agent | `pi --print --mode json` or `--mode rpc` | resume by session id/path |
| `omp` | oh-my-pi (Pi-family) | `omp --print --mode json` or `--mode rpc` | `--resume <id>` |
| `opencode` | OpenCode | `opencode run` (or a `serve` session) | `--session <id>` |
| `claude` | Claude Code | `claude -p` with `--output-format stream-json` | `--resume <session-id>` |

- Exactly one harness executes per stage; harness selection is a per-stage field, so a single workflow may mix harnesses (for example, implement with `codex` and review with `pi`).
- `harness` values are validated against a **registry** of installed adapters, not a hardcoded enum. Adding a harness is expected to be an ordinary adapter addition rather than a schema change: implement the adapter interface, register it, and pass the adapter conformance suite. This is **not** a plugin framework; dynamic third-party plugin loading remains deferred (see §8).
- Each adapter reports capabilities (`supportsResume`, `supportsEventStream`, `supportsStructuredFinalOutput`, `supportsPermissionMode`, `supportsModelSelection`). A workflow requiring an unsupported capability fails validation/preflight with a user-facing message rather than silently degrading.
- Harness-specific launch flags, session identity, event framing, and settle boundary live only in the adapter. The engine never assumes provider-specific behavior, such as treating the first streamed agent message as the final result.
- Adapters must not leak report tokens or credentials into logs, and must pass each child process only a deliberate environment allowlist.
- MVP ordering: `codex` and `pi` are implemented first; `claude`, `opencode`, and `omp` follow the same interface and must pass the same conformance suite.

Phase 6.1 now provides an offline-conformant Codex CLI adapter through the headless service API. It uses stdin prompts, explicit persisted session UUIDs, JSONL process/session evidence and the common `wf report` channel. Version and selected unrestricted permission mode are audited. Authentication and provider-backed stream/resume compatibility remain unverified; the other adapters and the full Phase 6 live gate remain unfinished. See `docs/harness-compatibility.md` for evidence and limits.

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
| `limits` | Optional max wall-clock runtime, stage executions, retry budget, agent idle timeout |

The parser must reject duplicate YAML keys, invalid interpolation, unknown outcome names, and conflicting effective transition definitions. The engine's own names are prefixed `system.` and cannot be declared as agent outcomes.

### 3.2 Types of steps

**`agent`**: fields `harness`, optional `model`, optional `reasoning_effort`, `session: fresh | resume`, `prompt` or `prompt_file`, `instructions`, `cwd`, `outcomes`, `on`, optional `tags`, `timeout`, `context`. An agent stage receives the current task if present. A resume stage must have a valid persisted session identity or fail with `system.resume_unavailable`.

**`command`**: fields `argv: string[]`, `cwd`, optional `env`, `timeout`, `on`, optional `tags`. Spawn without a shell by default. Shell syntax is allowed only through an explicit shell executable in `argv` (e.g., `['sh','-lc','...']`). Exit code 0 maps to `complete`; a nonzero exit maps to `failed`. Spawn errors map to engine outcomes.

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

A file/structured-final-response **adapter fallback** may normalize a harness's returned final message into the exact same report schema; it must obey the same validation and uniqueness rules. Do not launch a separate formatting LLM. For initial adapters, CLI reporting is preferred. Schema-constrained output is an optimization, not a reason to trust unchecked model text.

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
- **Resume:** only from paused/interrupted, after resolving any uncertain operation and validating selected workflow revision and step pointer.
- **Manual advance/skip:** may override the run cursor or mark a task complete; requires an explicit user action and reason, recorded in history. The UI should explain that it does not alter the codebase automatically.
- **Edit while paused:** create a revised workflow snapshot; reject invalid revisions or edits referring to now-missing active step without an explicit new cursor.
- **Delete run:** requires a separate explicit action; does not delete the project directory or undo external side effects. Archive/hide rather than destructive delete initially.

Permissions: the runner executes processes on the user's machine, using the chosen harness options (including unrestricted or 'yolo' permissions where supported). It must not impose approval gates. The UI should clearly display the selected permission mode because arbitrary shell commands and unrestricted agents can modify any files accessible to the user. No claims of sandboxing or guaranteed rollback.

## 7. UI requirements

**Workflow editor:** project picker, task import/preview, stage graph/list, stage detail panel (type, harness, model, prompts, cwd, outcomes), outcome-to-next-step picker, global/tag/step policy panel with effective-transition preview, YAML view, validation errors, save/duplicate, Start. Avoid a large node-editor library until needed; a clean stage list + connectors is sufficient in MVP.

**Runner dashboard:** run status; active task/stage and harness; progress when known; elapsed duration; readable logs and outcome reports; pause/stop/resume controls; task history; pending human-attention items; manual override/revision controls when paused.

The browser UI is a client; closing the tab does not terminate the runner. UI is served locally, with no required cloud account. Prefer localhost binding and no open remote administrative interface by default.

## 8. MVP scope and non-goals

### Included

- Engine; schema parser/validator; persisted one-at-a-time stage execution.
- Markdown checklist import and engine-owned task queue.
- Harness adapters for `codex`, `pi`, `omp`, `opencode`, and `claude` (Claude Code), plus a deterministic command executor. The `codex` and `pi` adapters are implemented first; the rest follow the same interface and must pass the same conformance suite.
- `wf report` CLI and strict outcome validation with one correction turn.
- Explicit transition graph, scoped rules, loops, error routing, run revisions.
- Pause, stop, resume, manual override, event/report/log history.
- Small local UI + CLI commands for headless testing and control.

### Deferred

- Parallel agents; distributed workers; multi-host scheduling; worktree merging orchestration; enterprise RBAC; cloud sync; autoscaling; a marketplace or dynamic third-party plugin loader (adding new in-tree harness adapters is in scope; a plugin framework is not).
- AI-generated workflows without review; LLM supervisor; automatic 'quality gating'; automatic code rollback.
- General-purpose arbitrary JavaScript/Python in transition expressions; arbitrary dynamic graph rewriting while running.
- True nested subworkflow interpreter and complex dependency scheduler.
- Markdown checklist auto-sync/write-back; polished graph-canvas drag-and-drop; notifications/integrations.

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
