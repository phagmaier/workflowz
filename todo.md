# Implementation Plan — Agent Workflow Runner

**How to use:** Complete in order. Check a box only after its tests pass and its acceptance criteria are demonstrably met. Prefer a simple working vertical slice to speculative abstractions. See [spec.md](spec.md) and [architecture.md](architecture.md) for contracts.

## Phase 0 — Project bootstrap and compatibility probe

- [x] 0.1 Initialize a project-local TypeScript / Node.js repository with reproducible package manager lockfile, `tsconfig` strict mode, formatter, lint, test runner, typecheck, and documented dev commands.
- [x] 0.2 Decide concrete libraries for YAML parsing (must detect duplicate keys), runtime type validation, and SQLite; record versions in README/dependency lockfile. Keep dependency count modest.
- [x] 0.3 Set up module/package boundaries for shared contracts, engine, adapters, CLI/daemon, and future web app. No microservices.
- [x] 0.4 Add smoke tests that can run entirely offline, and a CI-friendly `test`/`lint`/`typecheck` script.
- [x] 0.5 Probe the installed harness binaries — `codex`, `pi`, `omp`, `opencode`, and `claude` — for versions, supported flags, authentication availability (without exposing secrets), and session/resume behavior. Record a per-harness compatibility note; **do not** modify the user's global harness configuration.

  The earlier [remaining-harness pass](docs/harness-compatibility.md#remaining-milestone-05-results--stopped-at-omp-authentication) stopped at omp's missing OpenAI credential after Claude/OpenCode reporting passed. The later explicitly authorized [Meta Contributor pass](docs/harness-compatibility.md#authorized-meta-contributor-live-results) passed omp/OpenCode direct reporting and exact-session correction. The separately authorized [Claude Haiku/low correction](docs/harness-compatibility.md#authorized-claude-correction--milestone-05-complete) now passed with exact-session identity, real acknowledgment, sequential settlement, durable reopen and target removal. **All milestone 0.5 acceptance evidence is reviewed.** No successful scenario or failed OpenAI path was repeated.

  Standing choice: Meta Muse Spark 1.3 Contributor/low for OpenCode/omp, using `MUSE_SPARK_API_KEY` in `~/.config/secrets.zsh` through `smoke:meta`. Local loading and live use are verified; do not request the key/source again. Completed live passes do not authorize additional paid execution. Milestone 0.5, Phase 6, Phase 8 and the Phase 9.1 offline audit are complete. Current authorization covers offline Phases 9.2 then 9.3, with separate milestone commits and standing commit/push permission. No live providers, downloads or global configuration changes; 9.4–9.5 and the final MVP gate remain outside this pass.

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

**Live gate passed (2026-10-19):** Codex `gpt-6-luna` and Pi `openai/gpt-6-luna`, both at low reasoning, passed reporting and exact-session correction through actual `wf report`. The later explicitly authorized omp/OpenCode `meta/muse-spark-1.3-contributor`/low pass also completed reporting and exact-session correction with acknowledgment, sequential settlement, SQLite reopen and target cleanup. Claude's earlier direct report and separately authorized `claude-haiku-5-5`/low correction completed **milestone 0.5**, whose all-adapter offline gate passed **704 tests**. Exact [Claude](docs/harness-compatibility.md#authorized-claude-correction--milestone-05-complete) and [Meta](docs/harness-compatibility.md#authorized-meta-contributor-live-results) evidence and limits are recorded with the implementation log; earlier failed OpenAI and successful Luna evidence is preserved. The subsequent Phase 7.1 authorization covers only the headless lifecycle slice below, not further paid usage.

## Phase 7 — Crash recovery, management CLI, and reliability

Authorized scope: Phase 7 milestones and Phases 8.1–8.4 were separately implemented, accepted and committed/pushed. The current authorization covers offline Phase 8.5, actual-browser verification with disposable fake adapters, and commit/push. No live provider execution is authorized.

- [x] 7.1 Implement daemon instance lock, process identity tracking (PID+start identity), in-flight attempt reconciliation, and interrupted/uncertain pause semantics.

  Verified on Node.js v26.8.2: full offline gate **717 tests / 79 suites**, typecheck/lint passed; independent `smoke:recovery`, `smoke:reporting` and `smoke:boundaries` passed with durable reopen and explicit owned cleanup. The example validates with 8 steps and zero warnings. Kernel-backed ownership, PID/start mismatch refusal, correction spawn uncertainty, no replay and transactional interruption are covered. [Implementation evidence and limits](docs/implementation-log.md#phase-71--state-ownership-linux-identity-and-conservative-restart-reconciliation).
- [x] 7.2 On daemon crash, never auto-replay possibly side-effectful stages; expose recovery actions with durable user decision events.

  Separately authorized headless recovery API verified on Node.js v26.8.2: **736 tests / 81 suites**, typecheck/lint passed; real-process recovery/reporting/boundary smokes and durable reopen passed; example valid with 8 steps and zero warnings. Operator cleanup confirmation stays distinct from OS absence and interrupted-stage success. Termination intent/result crash boundaries, stale/duplicate decisions, audited dispositions, historical interruption context and transactional rollback are covered. [Acceptance evidence and limits](docs/implementation-log.md#phase-72--explicit-headless-recovery-decisions).
- [x] 7.3 Implement management CLI: workflow validate/import, run/start/status/events, pause/stop/resume/override/revise, task preview, report submission.

  Explicit foreground owner with private state/discovery and shared typed loopback RPC; separate CLI processes control the actual drive owner. Final review verification on Node.js v26.8.2: **752 tests / 85 suites**, typecheck/lint passed; earlier recovery/reporting/boundary smokes passed; example valid with 8 steps and zero warnings. Real-process tests cover stale controls, competing owners, one active run/attempt, graceful drain, stop/reuse, paused edits, cross-token refusal and conservative crash/reopen. [Phase 7.3 acceptance evidence and limits](docs/implementation-log.md#phase-73--management-cli-and-its-local-daemonapi) and [review fixes](docs/implementation-log.md#phase-73-review-fixes). Owner approval to commit/push received after review.
- [x] 7.4 Implement run limits and bounded stage retries with durable counters; distinguish report correction from stage retry.

  Separately authorized offline implementation verified on Node.js v26.8.2: **777 tests / 87 suites**, typecheck/lint passed; recovery/reporting/boundary smokes passed; example valid with 8 steps and zero warnings. Reuses durable attempt/transition counts and adds only migration 9's retry admission deadline. Covers backoff/reopen/revision/control boundaries, task-scoped budgets, active invocation wall caps, idle silence across all five adapters, no correction after timeout/exhaustion and transactional rollback. [Acceptance evidence and limits](docs/implementation-log.md#phase-74--run-limits-and-durable-bounded-stage-retries). Owner subsequently committed/pushed as `f9bd2b9`.
- [x] 7.5 Test daemon kill/restart during command and agent attempts, duplicate launch prevention, process tree termination, and resumed run revisions.

  Separately authorized offline coverage audit and six foreground-daemon scenarios verified on Node.js v26.8.2: focused **88 tests / 11 suites**; full gate **783 tests / 87 suites**, typecheck/lint passed, zero failures/cancellations/skips. Recovery/reporting/boundary smokes passed; example valid with 8 steps, zero warnings and unchanged hash prefix `8a4912284968`. Covers command/agent/correction SIGKILL, committed cursor and expired backoff, concurrent duplicate admission, TERM-resistant descendant reaping, and paused revisions/task progress/frozen settings/session scope across restart. No production changes or migration edits were needed. [Bounded matrix, evidence and limits](docs/implementation-log.md#phase-75--daemon-crash-boundaries-and-resumed-revisions). Fixture-owned processes settled; pre-existing temporary evidence preserved. Owner approved committing and pushing after review.

**Gate:** Unattended runner continues without browser; interrupted operation is visible and never silently replayed.

## Phase 8 — Small browser UI

Phase 8 is accepted and committed/pushed, including its permanent offline Chromium suite and full visual-authoring gate. Historical acceptance notes below describe scope at each milestone. Phase 9.1 is accepted; current bounded authorization is offline 9.2–9.3 only. No paid/live providers or Phase 9.4–9.5/final MVP gate work.

- [x] 8.1 Create localhost UI shell with project root, instruction selection, Markdown task preview/import, saved workflows, and run list.

  Verified on Node.js v26.8.2 / npm 11.19.1: actual Chromium against a disposable foreground daemon covered selection/save/reload, nested/prechecked preview/import, ready-only immutable snapshots, graph-only workflows, validation/path/daemon failures, tab disconnect, restart/re-pairing and logout. Phase 8.1 gate: **790 tests / 88 suites**, typecheck/lint passed; required recovery/reporting/boundary smokes and canonical example passed. [Design, browser evidence, cleanup and limits](docs/implementation-log.md#phase-81--localhost-workflow-preparation-shell). Owner accepted and committed/pushed as `8a2caf0`; 8.2 acceptance is recorded below.
- [x] 8.2 Add visual stage-list editor with outcome-to-transition controls, scoped policy editor, inherited effective-transition view, YAML editing and validation messages.

  Offline acceptance on Node.js v26.8.2 / npm 11.19.1: **793 tests / 88 suites**, typecheck/lint passed; recovery/reporting/boundary smokes and unchanged canonical example passed. Actual Chromium exercised every stage kind, goto/pause/retry, defaults and all/tag/explicit-step policies, compiler provenance/system fallback, YAML/visual synchronization and delayed responses, located errors, immutable save/ready snapshots, preserved selections/preview/import/upload/reload, and desktop/mobile layout. All three fixture daemons exited 0, listeners/discovery were gone, tabs closed and owned root removed. [Design, evidence and limits](docs/implementation-log.md#phase-82--canonical-visual-stage-and-policy-editor). No dependency/migration/provider execution; full Phase 8 gate and 8.3–8.5 remain open. Commit/push awaits separate owner approval.
- [x] 8.3 Add run dashboard: current task/stage, harness, event stream, progress (when total known), report details, attention queue, pause/stop/resume controls.

  Offline acceptance: **795 tests / 88 suites**, typecheck/lint passed; recovery/reporting/boundary smokes and canonical example passed. Actual Chromium controlled a disposable daemon with fake adapters: accepted report before settlement left progress at 0/2; pause retained the routed cursor; resume reached blocked attention at 1/2; stale controls were rejected without retry; tab closure left execution running and it completed at 2/2. Stop-now reaped the fake descendant; exclusive refresh retained ordered unique events. Desktop/mobile surfaces, reload, daemon-unavailable handling and durable SQLite reopen passed. Fixture owner exited 0; listener/discovery, managed tabs and owned root were removed. [Design, evidence and limits](docs/implementation-log.md#phase-83--run-dashboard-and-explicit-execution-controls). No provider/dependency/migration changes; **8.4–8.5, the full Phase 8 gate and MVP remain incomplete**.
- [x] 8.4 Add paused-run workflow revision editor and explicit manual override actions with warnings that repository files are unchanged.

  Offline acceptance: **800 tests / 88 suites**, typecheck/lint passed; recovery/reporting/boundary smokes and canonical example passed. Actual Chromium revised a blocked paused run with its consumed checklist removed, rejected invalid YAML/incompatible cursors without partial mutation, explicitly resumed into the new revision and retained history/task progress. Jump, declared skip and manual task completion produced durable reasoned audits without reports/automatic completion/resume. Delayed validation, selection/lifecycle changes and stale controls preserved drafts; interrupted recovery stayed blocked. Desktop/mobile, reload/closure independence, durable SQLite reopen and owned fixture cleanup passed. [Design, evidence and limits](docs/implementation-log.md#phase-84--paused-run-revisions-and-explicit-manual-intervention). Phase 8.5, the full Phase 8 gate and MVP remain incomplete.
- [x] 8.5 Add a few browser smoke tests using fake harness; verify closing/reloading browser never stops run.

  Permanent Chromium suite passed twice from fresh disposable state: **3 scenarios**, no retries, separate foreground daemon per scenario, explicit fake-only harness registry, actual supervised children and `wf report`. Visual two-stage authoring/save/ready/start/blocked/revision/explicit-resume completes both imported tasks with historical reports and frozen inputs preserved. Mobile intervention, genuine stale rejection/fresh inspection, delayed-validation/polling/selection draft pinning, and file-gated reload/last-tab closure pass. Durable reopen and owned process/listener/discovery/state cleanup pass, including an intentional active-operation assertion failure. Full offline gate: **800 tests / 88 suites**, typecheck/lint; requested recovery/reporting/boundary smokes and canonical example passed. [Exact evidence and limits](docs/implementation-log.md#phase-85--permanent-offline-chromium-smoke-coverage).

**Gate (satisfied):** A user can configure and run a simple two-stage fake workflow without editing YAML directly, see an error/blocked queue, fix/revise, and resume. Proven through the permanent visual-authoring scenario, including separate explicit Resume and subsequent new-revision execution. Phase 9 and MVP remain incomplete.

## Phase 9 — Finish MVP

- [x] 9.1 Run all end-to-end scenarios from `spec.md` (happy path, debugging branch, report correction, outage, stop/resume, crash, UI reconnect).

  Offline acceptance audit covers all **13 spec §9 scenarios plus pause/stop/resume**. Reused existing process/CLI/browser coverage; added one integrated custom-debugging/tag-policy/ambiguity scenario and strengthened the real CLI rejection's unchanged-state assertion. **801 tests / 88 suites**, typecheck/lint, **3 Chromium scenarios**, recovery/reporting/tasks/capabilities/boundary smokes and canonical validation passed. Durable reopen and owned process/listener/discovery/state cleanup passed. No production defect or contract change; no paid providers. [Exact evidence matrix, commands and limits](docs/implementation-log.md#phase-91--offline-end-to-end-acceptance-audit). Phases 9.2–9.5 and MVP remain incomplete.

- [x] 9.2 Provide sample workflows: minimal single-step, task loop, implement/review/commit, human checkpoint, command-only.

  Five focused samples plus the unchanged canonical example validate with zero warnings. Parameterized real-CLI coverage discovers all YAML examples; original overnight eight-step assertion retained. `npm run check`: **807 tests / 88 suites**, typecheck/lint pass. No production changes. [Inventory and exact commands](docs/implementation-log.md#phase-92--focused-sample-workflows).
- [ ] 9.3 Verify readable failures, logs, report payload bounds, API validation, local state directory behavior, and startup/shutdown documentation.
- [ ] 9.4 Document how to install, configure, start the daemon, launch UI, run workflows, import tasks, troubleshoot adapters, and recover interrupted runs.
- [ ] 9.5 Remove unused abstractions and known TODOs that undermine reliability. Publish a clear list of deferred features.

**Final MVP gate:** A developer with a spec, `AGENTS.md`, and Markdown tasks can configure a reusable workflow through YAML or UI, leave it running, and reliably inspect or recover state without a supervisor LLM.
