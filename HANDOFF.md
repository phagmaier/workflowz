# Fresh-agent handoff

## Starting point

Continue implementation of the deterministic local Agent Workflow Runner, not another broad review or a visual editor. Correctness review fixes are committed and pushed to `origin/main` as `9cde100` (`Fix workflow validation, transactional state, and process lifecycle`).

Before designing or editing, follow `AGENTS.md` and read these files in order:

1. `README.md`
2. `spec.md`
3. `architecture.md`
4. `todo.md`
5. `examples/overnight.yaml`

Then read `docs/schema-v1.md` for concrete schema/runtime decisions and `docs/harness-compatibility.md` before touching harness integration. These documents distinguish the design contract from implemented behavior.

## What exists

- Project-local TypeScript on Node.js; strict compiler settings, Biome, npm lockfile, built-in `node:test` and `node:sqlite`.
- Strict YAML parser, typed v1 schema, policy compiler, interpolation grammar, graph diagnostics, and referenced-path validation.
- SQLite migrations and run repository, pure reducer, transactional coordinator, task-loop primitives for already-supplied task snapshots, run controls, and durable events/transitions.
- Sequential `RunService`, command executor, process-group supervision, bounded logs/output, and a real-child-process scripted agent fixture.
- Executable CLI entry points for workflow validation and offline harness probing. There is no management daemon/CLI, reporting endpoint/CLI, or UI yet.

The parser accepts more configuration than the current runner implements. In particular, Markdown import, selected report/context assembly, real harness/model integration, report correction, idle-timeout enforcement, and retry backoff remain incomplete. Do not infer runtime support from a schema field or registry capability.

## Next work, in order

### 1. Reconcile the remaining prerequisites

- `todo.md` 0.5 remains unchecked: the offline probe verifies version/help markers, not authentication, actual stream framing, or same-session behavior. Keep this distinction explicit. Do not read credential files or change global harness configuration. Live model calls are not required for core development; use opt-in verification for real adapters later.
- Finish 3.2's fake-process session/resume/correction capability as the prerequisite for Phase 4. Current `test/fixtures/fake-agent.mjs` and `src/test-support/scripted-agent.ts` report through an `OUTCOME <name>` stdout line and cannot perform same-session correction.
- 3.7 is currently checked, but `src/test-support/adapter-conformance.ts` only exercises the existing launch/outcome/crash/timeout/stop subset. Extend it with reporting lifecycle, duplicate/late submissions, correction-once, and no-resume cases as Phase 4 becomes executable. Do not treat that checkbox as proof those cases exist.

### 2. Implement Phase 4 as the next runnable vertical slice

Follow `spec.md` §4 and `architecture.md` §5. Define strict typed contracts first, then drive a fake agent through the real reporting path:

1. Bounded report schema and declared-outcome validation; model-authored payloads cannot choose authoritative run/attempt IDs or transitions.
2. Private loopback `POST /internal/reports`, attempt-scoped opaque tokens, and a real `wf report` client that waits for synchronous acknowledgment. Keep tokens out of args, URLs, logs, events, and user-visible output.
3. Persist at most one accepted report per logical attempt, transactionally. Invalid submissions must not mutate canonical state. Accepted submissions must not advance the cursor while a process is still active. Reject duplicates, expired/late submissions, and invalid payloads clearly.
4. On clean settlement without an accepted report, permit at most one bounded correction invocation in the same persisted session, only when configured and supported. It is part of the same logical attempt and must not overlap the original process. The correction prompt must forbid source modifications.
5. Missing/unavailable resume or failed correction produces `system.report_error`, pausing by default unless explicitly routed. Provider/process errors and timeouts bypass correction even if a report arrived earlier.
6. Migrate the fake fixture and conformance tests to exercise the real endpoint/CLI. Keep stdout `OUTCOME` handling test-only until replaced; never promote it to the reporting contract for real harnesses.

Acceptance: a headless fake workflow invokes the real report CLI, persists exactly one accepted report, waits for process settlement before routing, and demonstrates correction success/failure with exactly one correction invocation. Cover invalid, duplicate, late, missing, unavailable-resume, crash, and timeout behavior without API calls. Update milestone checkboxes only when their acceptance criteria actually pass.

Do not jump ahead to Phase 5 task import, Phase 6 real adapters, or Phase 8 UI. Once Phase 4 is complete, continue in `todo.md` order.

## Relevant code and invariants

- `src/contracts/`: parsing, schema, identifiers, diagnostics; no runtime I/O.
- `src/engine/run-coordinator.ts`: canonical state owner. Coordinator mutations and corresponding events share transactions. Report acceptance must not introduce a second cursor writer.
- `src/store/database.ts`: nested transactions join the outer transaction; any inner failure marks the whole transaction rollback-only, even if caught.
- `src/store/run-store.ts`, `migrations.ts`: persisted state and constraints. Extend migrations using existing conventions; do not rewrite migration history.
- `src/runner/{run-service,prepare,settlement}.ts`: preparation, execution, control ownership, and error/report precedence. `session: resume` currently fails explicitly with `system.resume_unavailable`; replace this guard only when persisted-session support is real, never by silently launching fresh.
- `src/adapters/agent-adapter.ts`: intentionally small current interface; session identity, accepted-report integration, and correction lifecycle still need implementation. Keep harness-specific behavior outside the engine.
- `src/adapters/process.ts`: owned process groups, TERM/KILL escalation, bounded stdout/stderr and logs. Completion rejects if group/pipe settlement cannot be confirmed. Do not dispatch another operation after uncertain cleanup.
- `src/test-support/` and `test/fixtures/`: offline integration seams; reuse them rather than introducing a second fake-executor convention.

Preserve one globally running/pausing run and one active attempt. A report is not process settlement. Stop affects only its requested owned run, and live operations cannot be reconciled as crashes. Keep the observed attempt outcome distinct from a routed `system.retry_exhausted` transition.

Known process limits: PID/start-identity checks and daemon locking remain Phase 7 work. Descendants that deliberately escape their process group are not contained; retained pipes cause an uncertainty error. The tool provides no sandbox or rollback. Do not hide these limits with retries or fabricated successful settlement.

## Verification baseline

Verified on Node.js `v26.8.2` and npm `11.19.1` before the review commit:

```sh
npm ci
npm run check
npm run validate -- examples/overnight.yaml
npm run probe:harnesses
```

Results: 215 tests passed, zero failures/skips; typecheck and lint passed. Biome reported 63 informational `useLiteralKeys` suggestions, not errors. The example validates with 8 steps and zero warnings. All five installed harnesses passed the offline version/help-marker probe; this does not establish authentication or live adapter compatibility.

Separate runtime smoke checks exercised cross-run stop isolation, real command execution/output interpolation, SQLite reopen, caught-inner-error rollback, capped log retention, separate stderr capture, and nonzero probe results. No live model calls were made.

After implementation, run the gate and exercise the new path outside unit tests: launch a fake workflow, invoke `wf report`, observe acknowledgment, persisted report, process settlement, and transition. Keep temporary databases/logs/scripts isolated and remove them afterward. Update pertinent docs and report exact verification results.

The codebase graph index inspected during review contained documentation but did not track the source paths. Recheck coverage before using graph results; use source reads and LSP references rather than treating absent graph symbols as evidence of absent code.
