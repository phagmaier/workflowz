# Implementation Plan — Agent Workflow Runner

**How to use:** Complete in order. Check a box only after its tests pass and its acceptance criteria are demonstrably met. Prefer a simple working vertical slice to speculative abstractions. See [spec.md](spec.md) and [architecture.md](architecture.md) for contracts.

## Phase 0 — Project bootstrap and compatibility probe

- [x] 0.1 Initialize a project-local TypeScript / Node.js repository with reproducible package manager lockfile, `tsconfig` strict mode, formatter, lint, test runner, typecheck, and documented dev commands.
- [x] 0.2 Decide concrete libraries for YAML parsing (must detect duplicate keys), runtime type validation, and SQLite; record versions in README/dependency lockfile. Keep dependency count modest.
- [x] 0.3 Set up module/package boundaries for shared contracts, engine, adapters, CLI/daemon, and future web app. No microservices.
- [x] 0.4 Add smoke tests that can run entirely offline, and a CI-friendly `test`/`lint`/`typecheck` script.
- [x] 0.5 Probe the installed harness binaries — `codex`, `pi`, `omp`, `opencode`, and `claude` — for versions, supported flags, authentication availability (without exposing secrets), and session/resume behavior. Record a per-harness compatibility note; **do not** modify the user's global harness configuration.

  The earlier [remaining-harness pass](docs/harness-compatibility.md#remaining-milestone-05-results--stopped-at-omp-authentication) stopped at omp's missing OpenAI credential after Claude/OpenCode reporting passed. The later explicitly authorized [Meta Contributor pass](docs/harness-compatibility.md#authorized-meta-contributor-live-results) passed omp/OpenCode direct reporting and exact-session correction. The separately authorized [Claude Haiku/low correction](docs/harness-compatibility.md#authorized-claude-correction--milestone-05-complete) now passed with exact-session identity, real acknowledgment, sequential settlement, durable reopen and target removal. **All milestone 0.5 acceptance evidence is reviewed.** No successful scenario or failed OpenAI path was repeated.

  Standing choice: Meta Muse Spark 1.3 Contributor/low for OpenCode/omp, using `MUSE_SPARK_API_KEY` in `~/.config/secrets.zsh` through `smoke:meta`. Local loading and live use are verified; do not request the key/source again. Completed live passes do not authorize additional paid execution. Milestone 0.5 and the Phase 6 gate are complete; Phase 7 remains unauthorized.

**Gate:** Fresh clone installs, typechecks, tests, and has a short local development README; version probe works or explains missing binaries.

## Phase 1 — Workflow data contract and compiler

- [x] 1.1 Implement typed YAML v1 schema for project, start, defaults, policies, steps, optional task source, and limits; reject unknown/duplicate keys.
- [x] 1.2 Define supported step kinds (`agent`, `command`, `task.next`, `task.complete`, `end`) and per-kind allowed fields.
- [x] 1.3 Define explicit normal outcomes and reserved `system.*` outcomes; validate declared agent outcomes against `on` transitions.
- [x] 1.4 Compile effective transition policy: step > scoped/tag or explicit-step rules > workflow defaults > system catch-all pause; reject ambiguous equal-priority conflicts.
- [x] 1.5 Validate references, start node, reserved names, missing paths, and unsupported templating; warn about unreachable nodes and cycles that might run forever.
- [x] 1.6 Define strict interpolation fields for current task, prior reports, command outputs, run and project metadata. No arbitrary code eval.
- [x] 1.7 Parse and validate [`examples/overnight.yaml`](examples/overnight.yaml) via automated fixture test. Include negative fixtures for malformed definitions.
- [x] 1.8 Define the harness registry contract: `harness` is validated against registered adapter ids (not a closed enum), with graceful validation errors for unknown/unsupported harnesses or unmet required capabilities.

**Gate:** Compiler deterministically resolves transitions for a valid graph; invalid/ambiguous configuration gets precise error location and message; all can run offline.

## Phase 2 — Event store and pure execution reducer

- [x] 2.1 Create SQLite migrations for workflow revisions, runs, tasks, attempts, accepted reports, events, and attention items.
- [x] 2.2 Implement append-only event recording and state mutations in the **same transaction**. Add uniqueness and foreign-key constraints.
- [x] 2.3 Implement pure transition reducer independent of subprocesses or HTTP.
- [x] 2.4 Implement run/attempt lifecycle, cursor, recorded stage outcomes, completed tasks, current workflow revision, limits, and task loop primitives.
- [x] 2.5 Implement revisions/snapshots. Associate every attempt and transition with the appropriate immutable workflow revision.
- [x] 2.6 Unit-test repeated transitions, duplicate events, transaction rollback, restart/reopen and state reconstruction.

**Gate:** A simulated flow executes from task to task, persists across DB reopen, and never commits two transitions for one finalized attempt.

## Phase 3 — Sequential runner + fake executor + command executor

- [x] 3.1 Implement a single active-run scheduler and the common executor/adapter interfaces.
- [x] 3.2 Implement fake harness as a child process or equivalent process-boundary fixture that can report, crash, hang, and resume for a correction turn.
- [x] 3.3 Implement command executor using argv and cwd, bounded logging, exit-code normalization, stdout capture, and optional timeouts.
- [x] 3.4 Implement process start/settle handling with no stage overlap, process-group ownership and termination/reaping on stop.
- [x] 3.5 Add pause-after-current, stop-now, resume and manual cursor/task override operations with durable history.
- [x] 3.6 Test command failure, cancellation, timeout, bad paths, wrong working directory, and output interpolation; no network required.
- [x] 3.7 Define the adapter conformance suite every harness adapter must pass offline (launch, stream parse, settle detection, report accept/reject/duplicate, correction-once, crash/timeout mapping, stop/terminate, no-resume fallback), reusing the fake-harness fixtures.

**Gate:** A headless fake workflow with command steps follows deterministic branches and can be paused/stopped/restarted without concurrent stages.

## Phase 4 — Mandatory reporting and one correction chance

- [x] 4.1 Create `wf report` CLI, private loopback endpoint, attempt-scoped token lookup, and strict input schema.
- [x] 4.2 Reject undeclared outcomes/missing fields synchronously; return allowed values and useful error text. Rejected submissions never mutate state.
- [x] 4.3 Persist at most one accepted report per logical attempt; ignore no timing nuance: **wait until the executor settles before routing**.
- [x] 4.4 When an agent settles cleanly without valid report, issue **one** correction turn in the same session (if supported). Instruction must prohibit code modifications. Limit duration.
- [x] 4.5 On second failure/unavailable resume, emit `system.report_error` and pause unless the configured policy routes it elsewhere; no third turn.
- [x] 4.6 Process/provider crashes and timeouts must **not** trigger report correction; map to appropriate system failures.
- [x] 4.7 Test accepted, invalid, duplicate, missing, late, correction-success, correction-failure, provider-failure, and process-nonzero cases.

**Gate:** Every agent step ends with a valid accepted declared outcome or a routed system error. A test proves only one correction invocation occurs.

## Phase 5 — Task import, handoff, and loop behavior

- [x] 5.1 Import Markdown checkboxes in source order; preserve headings/nesting information and assign durable run-local IDs.
- [x] 5.2 Snapshot task list at run creation; exclude prechecked tasks by default. Expose preview/count of runnable tasks.
- [x] 5.3 Implement `task.next` and `task.complete` semantics with correct `task_ready`/`exhausted`/state errors.
- [x] 5.4 Assemble prompt input from explicitly selected instructions, task description, and last selected reports; handle missing references as errors.
- [x] 5.5 Support per-task parameter overrides in run configuration while paused, and revisions of remaining workflow stages; no arbitrary graph rewriting.
- [x] 5.6 Test imports, preservation of source snapshot, context selection, task progress, looping, and manual task completion.

**Gate:** Fake agents can finish an ordered Markdown checklist via a reusable small stage graph, without rewriting `todo.md`.

## Phase 6 — Harness adapters

- [x] 6.1 Implement Codex CLI adapter: headless launch, JSONL events, exit/settle status, session ID, model/config selection, report endpoint injection, optional permitted unrestricted mode, and same-session follow-up.
- [x] 6.2 Implement Pi CLI adapter: JSON/RPC parsing with **LF-only** record splitting, correct `agent_settled` semantics, session persistence, model/config selection, report endpoint injection, and same-session follow-up.
- [x] 6.3 Implement Claude Code adapter: `claude -p` with `--output-format stream-json`, session-id capture, `--resume` follow-up, permission-mode selection, and settle detection on the terminal `result` message.
- [x] 6.4 Implement OpenCode adapter: private `serve --stdio`/v2 API path with exact persisted-session admission and terminal idle/outcome verification (CLI `run --session` creates missing sessions), plus unrestricted permission selection.
- [x] 6.5 Implement omp adapter as a verified Pi-family variant: shared LF JSON framing/process supervision, omp terminal/retry/compaction semantics, strict non-creating full-path `--resume`, and unrestricted permission selection.
- [x] 6.6 Implement capability probe and user-facing preflight errors when requested modes or resume paths aren't supported by installed version.
- [x] 6.7 Ensure adapter boundary logs are scrubbed of credentials/tokens and that each child process receives only a deliberate environment allowlist; retain useful summaries and raw event files for local inspection.
- [x] 6.8 Add opt-in smoke tests for real locally authenticated harnesses; do not require live usage for core unit or integration tests.

**Gate:** One real Codex step and one real Pi step can each return `complete` through the common reporting contract, and every registered adapter (including Claude Code, OpenCode, and omp) passes the offline conformance suite; session correction behavior is verified or incompatibility is documented clearly.

**Live gate passed (2026-10-19):** Codex `gpt-6-luna` and Pi `openai/gpt-6-luna`, both at low reasoning, passed reporting and exact-session correction through actual `wf report`. The later explicitly authorized omp/OpenCode `meta/muse-spark-1.3-contributor`/low pass also completed reporting and exact-session correction with acknowledgment, sequential settlement, SQLite reopen and target cleanup. Claude's earlier direct report and separately authorized `claude-haiku-5-5`/low correction now complete **milestone 0.5**. The latest all-adapter offline gate passes **704 tests**. Exact [Claude](docs/harness-compatibility.md#authorized-claude-correction--milestone-05-complete) and [Meta](docs/harness-compatibility.md#authorized-meta-contributor-live-results) evidence and limits are recorded with the implementation log; earlier failed OpenAI and successful Luna evidence is preserved. Phase 7 remains out of scope without new authorization.

## Phase 7 — Crash recovery, management CLI, and reliability

- [ ] 7.1 Implement daemon instance lock, process identity tracking (PID+start identity), in-flight attempt reconciliation, and interrupted/uncertain pause semantics.
- [ ] 7.2 On daemon crash, never auto-replay possibly side-effectful stages; expose recovery actions with durable user decision events.
- [ ] 7.3 Implement management CLI: workflow validate/import, run/start/status/events, pause/stop/resume/override/revise, task preview, report submission.
- [ ] 7.4 Implement run limits and bounded stage retries with durable counters; distinguish report correction from stage retry.
- [ ] 7.5 Test daemon kill/restart during command and agent attempts, duplicate launch prevention, process tree termination, and resumed run revisions.

**Gate:** Unattended runner continues without browser; interrupted operation is visible and never silently replayed.

## Phase 8 — Small browser UI

- [ ] 8.1 Create localhost UI shell with project root, instruction selection, Markdown task preview/import, saved workflows, and run list.
- [ ] 8.2 Add visual stage-list editor with outcome-to-transition controls, scoped policy editor, inherited effective-transition view, YAML editing and validation messages.
- [ ] 8.3 Add run dashboard: current task/stage, harness, event stream, progress (when total known), report details, attention queue, pause/stop/resume controls.
- [ ] 8.4 Add paused-run workflow revision editor and explicit manual override actions with warnings that repository files are unchanged.
- [ ] 8.5 Add a few browser smoke tests using fake harness; verify closing/reloading browser never stops run.

**Gate:** A user can configure and run a simple two-stage fake workflow without editing YAML directly, see an error/blocked queue, fix/revise, and resume.

## Phase 9 — Finish MVP

- [ ] 9.1 Run all end-to-end scenarios from `spec.md` (happy path, debugging branch, report correction, outage, stop/resume, crash, UI reconnect).
- [ ] 9.2 Provide sample workflows: minimal single-step, task loop, implement/review/commit, human checkpoint, command-only.
- [ ] 9.3 Verify readable failures, logs, report payload bounds, API validation, local state directory behavior, and startup/shutdown documentation.
- [ ] 9.4 Document how to install, configure, start the daemon, launch UI, run workflows, import tasks, troubleshoot adapters, and recover interrupted runs.
- [ ] 9.5 Remove unused abstractions and known TODOs that undermine reliability. Publish a clear list of deferred features.

**Final MVP gate:** A developer with a spec, `AGENTS.md`, and Markdown tasks can configure a reusable workflow through YAML or UI, leave it running, and reliably inspect or recover state without a supervisor LLM.
