# Implementation verification

## Phase 4 — mandatory reporting and bounded correction

Implemented strict report v1, the private loopback endpoint, project-local `bin/wf`, transactional acceptance, invocation-scoped authorization, persisted fake sessions and correction budget, distinct invocation logs, and expanded offline adapter conformance. Stdout has no report authority. No installed harness configuration or credential files were read or changed; no model calls were made. Milestone 0.5 remains incomplete: offline version/help markers do not prove authentication, stream framing or session compatibility.

Verification on Node.js v26.8.2:

- `npm run check`: typecheck and lint passed; 259 tests passed, 0 failed/cancelled/skipped. Biome informational suggestions are not errors.
- `npm run smoke:reporting`: independent headless workflows invoked the real `wf` CLI, observed acknowledgment and one accepted SQLite report before process settlement without cursor movement, then routed after settlement. Correction success: one correction, one accepted report, completed. Correction failure: one correction, no accepted report, paused with `system.report_error`. SQLite reopen verified all three results. Smoke-created databases, sessions, logs and project files were removed.

The tests and smoke require localhost listening and real process-group supervision. The execution sandbox denied loopback binding; verification was run through the approved unsandboxed tool path. No live provider access was needed.

## Phase 5.1–5.4 — immutable task import and selected context

Continued in checklist order after the Phase 4 gate passed. Added typed Markdown preview/import, original source text/hash and task source metadata, atomic import persistence, and a real fake-agent task loop. Added explicit ordered instruction content, current task body/headings, latest selected same-task reports, report interpolation, and immutable per-attempt input snapshots without report authorization. Per-task overrides and paused workflow revisions (5.5) remain next; 5.6 stays unchecked because the full phase is not complete.

Final verification on Node.js v26.8.2:

- `npm ci --offline --ignore-scripts`: reproducible local installation succeeded; no dependency version changes.
- `npm run check`: strict typecheck and lint passed; **273 tests passed, 0 failed, 0 cancelled, 0 skipped**. Biome checked 69 files with 99 informational suggestions and no errors.
- `npm run validate -- examples/overnight.yaml`: valid, 8 steps, 0 warnings.
- `npm run probe:harnesses`: all five installed harnesses passed offline version/help markers, with the same versions recorded in `harness-compatibility.md`. Authentication, actual stream framing and real session resume were not verified; 0.5 remains unchecked.
- `npm run smoke:reporting`: final build again verified durable acceptance before settlement without routing, exactly one correction for success/failure, and SQLite reopen. All smoke artifacts removed.
- `npm run smoke:tasks`: preview showed 3 total / 1 prechecked / 2 runnable; both runnable tasks completed in source order through real `wf` reports; original Markdown remained unchanged and task context was persisted. All smoke artifacts removed.
- `git diff --check`: passed.

No live model calls, global harness changes, daemon/UI work or real adapter integration were introduced. Phase 7 process identity/daemon-lock limitations remain as documented in the architecture.


## Phase 5.5–5.6 — run-local parameters, paused revisions and full task coverage

Added strict run-local edit contracts and pure specialization/cursor checks. `RunService.setTaskOverrides` replaces unfinished-task model/prompt, explicit declared-outcome skip and selected transition parameters without putting task IDs in reusable YAML. `reviseWorkflow` validates replacement YAML and all remaining task settings, preserves task identity/progress/source/history, and requires an explicit compatible cursor when necessary. Both operations require ready/paused state with no active attempt and transactionally write audit events with reasons. Interrupted runs retain the existing explicit recovery flow.

Migration 6 appends task settings and frozen attempt parameters; migrations 1–5 are unchanged. Agent preparation now forwards model/reasoning effort and records them with harness in the immutable input. Subsequent attempt preparation/settlement reconstruct effective settings from the attempt revision and frozen parameters. Sessions retain their same-harness/run/task/revision scope: parameter edits preserve scope; new revision IDs cannot reopen old sessions or silently start fresh. Concrete skip, override, cursor and identical-revision deduplication decisions are documented in schema decisions 33–37 and synchronized with spec/architecture.

Phase 5.6 coverage is complete across:

- `contracts/task-import.test.ts` and `runner/task-import.test.ts`: nested/source-ordered import, headings/positions/body/check-state, prechecked exclusion and explicit inclusion, empty queue, source immutability, read-only preview and atomic persistence.
- `runner/context.test.ts`: ordered instruction content, selected same-task reports, missing explicit references, immutable input snapshots and failed-event rollback.
- Existing reducer/coordinator tests plus `engine/run-configuration.test.ts`: task loops/progress/manual completion, strict edit rejection, task-local routing, prompt-file replacement/clearing, bounded skip cycles, retry exhaustion versus observed failure, compatible cursors, active-task preservation, pending override validation, historical revision/attempt/report/input preservation and SQLite reopen. Audit-write failure tests include caught nested failures and later revision-cache correctness.
- `runner/run-configuration.test.ts`: real `wf` reports across pause/edit/revise/resume, task-specific model/prompt propagation, command skip, manual completion, remaining task loop, changed filesystem inputs without queue mutation, historical input preservation and reopen. A revised resume stage fails before launch when its revision has no session, with no correction/fresh fallback.
- `store/database.test.ts`: a schema-5 database upgrades while preserving reports, sessions and input snapshots; old attempts receive empty task parameters.

Final verification using Node.js **v26.8.2** via the explicit mise PATH:

- `npm run check`: strict typecheck/lint passed; **294 tests passed, 0 failed/cancelled/skipped**. Biome checked 73 files, with 102 informational suggestions and no errors.
- `npm run validate -- examples/overnight.yaml`: valid, 8 steps, 0 warnings.
- `npm run smoke:reporting`: durable acknowledgment before settlement without routing, exactly one correction on success/failure, and SQLite reopen passed; temporary artifacts removed.
- `npm run smoke:tasks`: 3 total / 1 prechecked / 2 runnable; fake agents completed both through real reports, preserved Markdown and persisted context; temporary artifacts removed.
- `git diff --check`: passed.

Loopback/process checks used the approved execution path outside the sandbox. Graph coverage still reports source files as `not_tracked`; implementation findings were verified with direct source reads. Phase 5.5 and 5.6 are checked only after their acceptance coverage and the full gate passed. Milestone 0.5 stays unchecked; no live model calls, credential reads, global harness changes, real adapters, daemon management or UI work were introduced. All earlier uncommitted implementation remains in place; this session made no commits or pushes.
