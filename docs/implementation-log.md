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


## Phase 6.1 — Codex CLI adapter, offline conformance

The previously uncommitted reporting/task/revision implementation was committed and pushed to `origin/main` as `d8ec593`; matching spec synchronization was committed/pushed as `0cd02da`. Development then continued in checklist order with the Codex adapter. This section and `docs/handoff.md` accompany the subsequent adapter commit.

Added `adapters/codex.ts`, an offline-probed factory, bounded UTF-8/LF event decoder, and a synthetic Codex CLI fixture that exercises the real adapter through the existing HTTP/CLI reporting channel. It forwards model/reasoning effort, captures UUID session identity, requires terminal turn evidence for a clean invocation, resumes only the supplied session, and waits for shared group/pipe settlement rather than interpreting streamed messages as completion. Missing/failed reporting retains the same one-correction policy; protocol/provider failures bypass correction. Versions/permission mode are audited, and the deliberate environment includes only base names, selected Codex home/key and report access. Runtime config disables shell snapshots and preserves report environment for tools without writing global config. No workflow schema fields, migrations, new mandatory gates or daemon/UI work were introduced.

The shared process supervisor gained optional stdin and a continuous scrubbed stdout observer; other executors keep ignored stdin. The shared conformance factory can now probe adapters asynchronously. Session matching compares original settlement identity to correction-start identity, allowing harnesses that learn the session ID from streaming output after launch. Codex now has `conformance_passed` registry status after passing the full common suite.

Verification using Node.js **v26.8.2** with the explicit mise PATH:

- `npm run check`: typecheck/lint passed; **336 tests passed, 0 failed/cancelled/skipped**. This includes the complete existing suite, Codex conformance, malformed/oversized/UTF-8 event framing, capture-limit independence, stdin/closed-pipe handling, terminal-before-exit behavior, env/argv selection, wrong-session rejection and durable launch metadata.
- `createCodexAdapter()` against the installed binary performed only version/help probes and returned `{version: "codex-cli 0.163.0", supportsResume: true}`.
- Installed `codex --version`, `codex exec --help`, `codex exec resume --help` confirmed advertised launch/resume flags. Official CLI/non-interactive/config references were fetched and are linked in `docs/harness-compatibility.md`.
- `git diff --check`: passed.

The loopback/process suite ran through approved execution outside the sandbox; fixtures remove their temporary project/log/session/database data. No live provider/model calls were made, no credential files were read, and no global harness configuration was changed. The fixture is synthetic, not a recorded live stream. Authentication, actual provider framing/session persistence, managed-config interactions and tool environment propagation remain live-smoke checks. Milestone 0.5 and the full Phase 6 gate stay unchecked. Phase 6.2 (Pi) is next; 6.6–6.8 have partial foundations but remain unchecked for the other harnesses and live coverage.

## Phase 6.2 — Pi CLI adapter, offline conformance

Started from a clean `main` checkout at `f0d439b` (Codex adapter), following `0cd02da` and `d8ec593`. Reverified installed Pi **1.3.0** and identified its adjacent package metadata as **`@earendil-works/pi-coding-agent`** from `earendil-works/pi`. Read bundled JSON/RPC, CLI, session and message docs and verified v1.3.0 official CLI/print/session-manager source. An initial direct help invocation reported a settings-lock warning in the restricted environment; adapter probes subsequently used isolated temporary Pi config, offline mode and disabled resource discovery. No paid calls or global harness config edits were made.

Added the asynchronous `createPiAdapter` factory, one-shot JSON adapter, bounded UTF-8/LF parser, and synthetic `fake-pi.mjs` CLI fixture over the existing real `wf` report fixture. Prompts use stdin; model and validated thinking level use the installed flags. Normal unrestricted tools use no invented permission flag. Version and selected mode are audited. The runtime inherits the base allowlist plus explicitly selected Pi/provider environment and report access; known injected authorization is scrubbed by the common supervisor. Compatibility details include the exact environment list and remaining live checks.

`agent_end` is never sufficient for settlement. Native automatic retry/compaction can recover transient assistant failures; a final non-aborted `agent_settled` and confirmed process/group/pipe settlement are required. Unrecovered provider failures, abort/truncation, malformed/oversized/truncated records and missing settlement become technical errors without report correction, even on exit zero. No streamed content becomes a report.

Fresh sessions use dedicated persistent directories below attempt logs or explicit adapter `sessionDir`. A streamed UUID must match a persisted bounded v3 header before an absolute session-file path is eligible for durable identity. Resume checks the file/header/UUID/cwd, then uses its full UUID with that file's dedicated directory. This avoids Pi's missing-path and `--session-id` create-if-missing behavior. Missing/incompatible sessions fail explicitly; mismatched returned identity cannot replace the persisted target. Runner-owned same-task/run/revision scoping, rotated reporting access and one bounded sequential correction are unchanged. No migrations or workflow fields were added.

The common probe runner now accepts an explicit environment, retaining existing defaults. The shared async conformance helper accepts a harness id so Pi runs as `pi`. Pi is registered `conformance_passed` only after the complete shared offline suite passed. Graph source coverage remained `not_tracked`; source was read directly. A concurrent user deletion of `docs/handoff.md` was preserved.

Final verification using Node.js **v26.8.2** via the explicit mise PATH:

- `npm run check`: typecheck/lint passed; **388 tests passed, 0 failed/cancelled/skipped**. Biome checked 83 files with 108 informational suggestions and no errors. The first gate stopped on fixture formatting; that was corrected before this passing gate.
- Pi-specific coverage comprises all 23 shared conformance cases, 13 invocation/service cases and 16 framing/settlement cases: real report acknowledgment/uniqueness, same-session correction once without overlap, unavailable resume, timeout/stop/process-tree cleanup, native retry recovery, final provider failure at exit zero, abort with report retained, `agent_end` without settlement, `agent_settled` before process exit, UTF-8/CRLF/Unicode separators, oversize/malformed/truncated framing, parsing beyond stdout capture, persisted session-file validation and launch metadata.
- Installed `createPiAdapter()` performed isolated offline probes and returned `{version: "1.3.0", supportsResume: true}`.
- `npm run validate -- examples/overnight.yaml`: valid, 8 steps, 0 warnings.
- `git diff --check`: passed.

Loopback/process tests used approved execution outside the sandbox. Fixtures remove temporary databases, logs, sessions and projects. Provider authentication, real stream/session compatibility, tool environment and user-resource interactions remain opt-in live-smoke work. No dependencies, daemon management or UI were added; no commit or push was made. Phase 6.2 is checked after its offline acceptance gate; milestone 0.5, 6.6–6.8 and the full Phase 6 live gate remain unchecked. Claude Code (6.3) is next.


## Phase 6.3 — Claude Code adapter, offline conformance

Checkout verification found a clean `main` at **`e937306` (`6.2 pi`)**, already matching `origin/main`, rather than the prior handoff's uncommitted Pi state. Earlier log entries were `f0d439b` and `0cd02da`. All Pi work was preserved. The previously deleted `docs/handoff.md` stays absent; no handoff document was recreated. Source graph coverage still reports `not_tracked`; implementation findings use direct source reads following graph-first discovery and coverage checks.

Reverified installed **Claude Code 2.1.303** and read current official CLI, programmatic usage and environment references (linked in the compatibility note). Isolated local checks with temporary config/home, no credentials and a loopback-only provider URL confirmed that stream-json requires verbose, and exact missing-UUID resume exits with a terminal error and zero turns/cost instead of starting fresh. The completed real adapter repeated the missing-UUID check with its normal `bypassPermissions` argv and returned `{exitCode: 1, resumeUnavailable: true}` while retaining the requested identity. Factory version/help probes returned `{version: "2.1.303 (Claude Code)", supportsResume: true}`. A sandboxed native-help check returned empty output; approved outside-sandbox execution produced the expected help evidence.

Added `adapters/claude.ts`, bounded streaming `claude-events.ts`, their tests and synthetic `test/fixtures/fake-claude.mjs`. Prompts use stdin; launch uses print/text input/stream-json/verbose and `--permission-mode bypassPermissions`. Existing model and validated reasoning effort map to `--model` and `--effort`. Default CLI persistence remains enabled; only full persisted UUIDs reach `--resume`, with no selector, fork or fresh fallback. Init/result mismatch, invalid identity and unavailable resume fail explicitly and never replace the requested durable identity.

Only a final successful `result` with `is_error: false` plus confirmed supervisor process/group/pipe settlement permits clean completion. Native API retry progress may recover; terminal/provider/protocol errors bypass correction even at exit zero. The bounded LF/UTF-8 decoder handles CRLF and Unicode separators, parses beyond stdout capture and rejects malformed/oversized/unterminated/nonfinal terminal evidence. Reports remain exclusively authorized through `wf`; existing one-correction and same-run/task/revision rules are unchanged. Deliberate Claude/Anthropic environment selection, injected secret scrubbing and launch metadata reuse the common boundary. No coordinator logic, workflow fields, migrations or dependencies changed.

Final verification with the explicit Node.js **v26.8.2** mise PATH:

- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run check`: typecheck/lint passed; **446 tests passed, 0 failed/cancelled/skipped**. Biome checked 88 files with 111 informational suggestions and no errors. Output: `/tmp/workflowz-claude-check.log`.
- Claude coverage: all **23 shared conformance cases**, **14 invocation/service cases** and **21 stream framing/terminal cases**. These cover real reporting acknowledgments/uniqueness, correction once without overlap, token rotation/revocation, failure/timeout/stop/process-tree handling, exact/unavailable/mismatched sessions, environment/credential scrubbing, launch metadata, parser bounds, terminal-before-process-exit and timeout precedence after an unavailable-session result.
- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run validate -- examples/overnight.yaml`: valid, 8 steps, 0 warnings.
- `git diff --check`: passed.

Loopback/process tests used the approved execution path outside the sandbox, with synthetic CLI streams and no provider calls. Fixtures remove temporary projects, databases, logs and sessions. No credential files were inspected and no global harness settings were edited. Registry status is now `conformance_passed`, and Phase 6.3 is checked after its offline acceptance gate. Authentication, successful live persistence/resume, actual provider framing, managed/user-resource interactions and tool environment propagation remain unverified. Phase 0.5, 6.6–6.8, the full Phase 6 live gate and all daemon/UI milestones remain unchecked. OpenCode (6.4) is next. The user authorized committing and pushing this milestone after the passing gate and final diff review.

## Phase 6.4 — OpenCode v2 private API adapter, offline conformance

Started from clean `main` at **`8843be3`**, following `e937306` and `f0d439b`; the requested log/status check matched the recorded checkout. `docs/handoff.md` remains absent and no replacement handoff was created. Followed graph-first discovery/coverage checks for `home-phagmaier-Code-workflowz`; source remained `not_tracked`, so contracts and callers were read directly with LSP references for shared exports. No subagents were used.

Reverified installed **opencode v2.0.32**, current run/session/API/serve help, official v2 CLI docs and exact-version official source (links in the compatibility note). Context7 was attempted but its configured key was rejected; direct official sources supplied the evidence. Current help lists both `service` and `serve`. Isolated installed checks with temporary home/config/data/state/cache, no provider credentials and an invalid provider confirmed that CLI `run --session` actually creates a missing ID, whereas exact API GET/prompt admission returns 404 and leaves it absent. No paid calls or user auth-file inspection were needed.

**Documented design adjustment:** use the architecture-permitted private server/API integration rather than a lookup followed by create-or-continue CLI launch. This closes the deletion race and avoids treating per-model `step_finish` as execution completion. `createOpenCodeAdapter` probes offline, then a common-supervised invocation-local bridge launches `serve --stdio --hostname 127.0.0.1 --port 0` with a random private Basic-auth credential and stdin ownership lease. It never touches the shared OpenCode service. Fresh only may create; resume addresses the exact persisted ID throughout lookup, updates and prompt admission. Returned identity/cwd cannot replace a persisted target.

The bridge validates bounded fatal-UTF-8 readiness/API JSON, exact generated message/session acknowledgment, 204 wait-for-idle and matching fresh persisted terminal outcome. Failed/interrupted/stale/missing evidence and framing/identity failures are technical failures at exit zero. It releases the lease and awaits server exit; the common supervisor still requires process/group/pipe settlement and preserves timeout/stop precedence. Only authorized `wf report` supplies outcomes. One sequential same-session correction, strict report bounds, token rotation/revocation, coordinator state ownership, transactions, revision scope and migrations 1–6 are unchanged.

Existing model/reasoning fields select provider/model and named variant, rejecting conflicting variant selections. The supported session-level wildcard allow rules explicitly choose unrestricted permissions, audited as `session-allow-all` plus version. These override session denials, unlike CLI `--auto`; no global setting is changed. Deliberate OpenCode/provider environment selection and common scrubbing cover known injected credentials/report authorization and the private lease password. This minimal API path does not consume provider text/tool event streams (`supportsEventStream: false`); interactive forms are not automatically answered. Both limitations are explicit in the compatibility note.

Added synthetic `test/fixtures/fake-opencode.mjs`, real-adapter full conformance as `opencode`, and adapter-specific framing, provider/terminal, missing/deleted/mismatched session, invalid admission/idle acknowledgment, stale evidence, secret/environment and process-settlement coverage. The common missing-identity case accepts technical protocol failure where API identity is required, while continuing to require zero correction/fresh fallback; optional stream identities retain their existing report-error behavior. No shared cases were omitted. OpenCode is `conformance_passed` only after all 23 shared cases passed.

Final verification using Node.js **v26.8.2**:

- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run check`: typecheck/lint passed; **503 tests passed, 0 failed/cancelled/skipped**. Biome checked **94 files**, with **113 informational suggestions** and no errors. Check stdout: `/tmp/workflowz-opencode-check.log`. Earlier targeted runs exposed synthetic HTTP-header, asynchronous fixture-admission and direct-resume correction-marker issues; those fixtures were corrected before this full passing gate.
- OpenCode coverage: **23 shared conformance cases**, **9 invocation/session/settlement cases**, **11 provider/protocol service cases**, **14 bridge framing cases** — **57 tests** in total. Actual EOF/process-tree handling, real loopback reporting and the real `wf` executable are exercised without providers.
- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH node /tmp/wf-opencode-service-smoke.mjs`: independent throwaway service smoke completed with one logical attempt, one accepted `complete` report, exactly one correction and ordered `started/settled/started/settled` invocations. Temporary SQLite/project/session/log data was removed.
- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH node /tmp/wf-opencode-adapter-smoke.mjs`: real installed factory returned `{version: "opencode v2.0.32", supportsResume: true}`; missing explicit identity returned `resumeUnavailable: true` with the same ID retained, and invalid-provider execution produced persisted `outcome: failed`/`providerError` with process exit zero. Both private-server checks settled without timeout; temporary data was removed.
- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run validate -- examples/overnight.yaml`: valid, **8 steps, 0 warnings**.
- `git diff --check`: passed. Throwaway probe/smoke scripts were removed after verification.

Phase 6.4 is checked after this offline acceptance gate. No dependencies, paid model calls, global harness settings, runner daemon management or UI were added. Authentication, successful live session/resume, actual provider behavior, managed/user resources and tool environment propagation remain unverified. Phase 0.5, 6.6–6.8 and the full Phase 6 live gate stay open; omp (6.5) is next. Existing PID-reuse/escaped-descendant supervision limitations remain Phase 7 work. The user authorized final complete-diff review, commit and push of this milestone.
