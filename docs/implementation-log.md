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

## Phase 6.5 — omp Pi-family dialect, offline conformance

Started from clean `main` at **`024e348`** (`Implement OpenCode adapter with exact API resume`), following `8843be3` and `e937306`; the requested `git log -3 --oneline` / `git status --short` matched the recorded checkout. Preserved the absence of `docs/handoff.md`. Read the required contracts in order, used the installed codebase-memory skill, graph-first discovery and exact-path coverage checks for `home-phagmaier-Code-workflowz`. Graph source coverage remained `not_tracked`, so source was read directly; LSP references preceded shared exported-symbol changes. No subagents were used.

Reverified installed standalone **`omp/18.12.2`** at `/home/phagmaier/.local/share/mise/installs/github-can1357-oh-my-pi/18.12.2/omp`. Official versioned package identity is **`@oh-my-pi/pi-coding-agent` 18.12.2** from `can1357/oh-my-pi`. Read installed root/read help and bundled CLI/approval/session docs with `omp read omp://...`; the embedded index listed 134 files. Read current official versioned CLI, print, session/event, retry, RPC and environment sources linked in the compatibility note. Context7 lookup was attempted but rejected its configured API key, so direct official sources supplied the documentation.

**Verified dialect adjustment:** reuse `PiAdapter` and bounded LF framing as a closed `pi`/`omp` variant, not a separate supervisor or broad harness abstraction. omp has no Pi `agent_settled`, uses `agent_end.isTerminal`, `auto_compaction_*` and compact incremental message updates, supports thinking `auto`, and persists a physical title slot ahead of the logical v3 header. The omp dialect requires successful final assistant/terminal evidence, permits native retry/compaction recovery, and fails malformed/oversized/truncated/invalid-UTF-8 or terminal/provider evidence even on exit zero. Common process/group/pipe settlement still owns completion; reports remain exclusively authorized `wf` submissions.

Added isolated async `createOmpAdapter`, deliberate omp/provider environment selection and common injected-secret scrubbing, model/thinking/stdin selection, and audited `--approval-mode yolo` plus version. Explicit tool/user restrictions and provider safety policies remain effective. Dedicated persistent directories default to `omp-sessions` beside logs. Exact journal paths are validated against UUID/header/cwd; `omp-session.ts` accepts legacy/header-first and current title-slot journals, checks bounded records and refuses latest departed transfer markers because the CLI would otherwise implicitly fork.

**Resume evidence:** installed-version strict path open uses `throwIfMissing: true` and rereads after asynchronous cwd checks. ID lookup allows prefixes/global discovery and a permissive later open, so Pi's UUID strategy is intentionally not reused. Missing, mismatched, malformed or moved-away identities fail without fresh/latest/restore/fork fallback. Existing runner session scope, one bounded sequential correction, token rotation/revocation, canonical state ownership, strict reports and append-only migrations 1–6 remain unchanged. OpenCode was not modified.

Installed isolated negative checks first encountered fresh `agent.db` initialization failures before session lookup (missing auth tables). To reach the actual missing-path branch without user auth/config access, experiments constructed a temporary **empty schema fixture from official DDL**, containing zero credentials. The installed CLI then exited 1 with `Session "<path>" not found.` and no session creation. This is an observed installed-startup limitation, not an adapter workaround; no initialization fix or global harness changes were made.

Independent smokes using Node.js **v26.8.2**:

- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH node /tmp/wf-omp-service-smoke.mjs`: real adapter as `omp` completed one logical attempt with one accepted `complete` report, exactly one correction, matching durable identity and ordered `invocation_started / invocation_settled / invocation_started / invocation_settled`; SQLite reopen passed. Synthetic CLI only, no provider calls.
- `/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin/node /tmp/wf-omp-installed-smoke.mjs <isolated-root>` (Python temporary-directory/empty-schema setup): real installed factory returned `{version: "omp/18.12.2", supportsResume: true}`. Missing persisted identity was refused before launch. A valid journal was then deleted by an invocation-local launcher after adapter validation but immediately before installed CLI admission: **exit 1, requested identity retained, no replacement created, no timeout**. The actual adapter/supervisor path, not only a parser test, was exercised. Temporary project/database/session/log data was removed.

Final verification with the explicit Node.js **v26.8.2** mise PATH:

- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run check`: strict typecheck/lint passed; **576 tests passed, 0 failed/cancelled/skipped**. Biome checked **100 files**, with **115 informational suggestions** and no errors.
- omp coverage: **23 shared conformance cases**, **10 invocation/persistence/secret cases**, **12 service/settlement cases**, **22 framing/terminal cases**, and **6 persisted-journal cases** — **73 additional tests**. The entire existing suite, including Pi and unchanged OpenCode conformance, also passed. An earlier targeted run exposed a synthetic `report-then-hang` mode incorrectly mapped to `hang`; the fixture dispatch was corrected before the passing shared suite and full gate.
- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run validate -- examples/overnight.yaml`: valid, **8 steps, 0 warnings**.

Phase 6.5 is checked after its offline acceptance gate; omp is `conformance_passed` only after all shared cases passed. No dependencies, paid calls, user credential-file inspection, global configuration changes, daemon management or UI were introduced. Documentation/example contracts are synchronized. Authentication, successful live session/resume and provider streams, tool environment/permissions and resource interactions remain unverified; 0.5, 6.6–6.8 and the full Phase 6 live gate stay open. Existing process PID-reuse/escaped-descendant limits remain Phase 7 work. The user authorized final complete-diff review, commit and push to `origin/main`.

`git diff --cached --check`: passed after removing newly appended blank EOF lines flagged by the initial check. The complete 17-file staged diff was reviewed. Throwaway smoke scripts and their temporary data were removed after verification.


## Phase 6.6 — installed capability snapshots and user-facing preflight

Verified clean `main` at **`b8b6d9d`**, following `024e348` and `8843be3`, with the requested log/status checks. Preserved all adapter work and the absence of `docs/handoff.md`; no replacement document was created. Read repository guidance in order, used the installed codebase-memory skill with graph-first discovery and coverage checks, and read source directly for `not_tracked` gaps/stale documentation. Installed TypeScript 7.0.2 LSP references preceded shared exported-contract changes. No subagents were used.

The remaining gap was the connection between existing offline factory evidence and execution: `AgentAdapter` exposed no effective installed capabilities, optional model/reasoning selectors were treated as factory-wide requirements, the inventory maintained a separate marker convention, and service launch handling discarded useful option-validation messages. This milestone reuses those factories and the common supervisor rather than adding another probe/registration system.

Each adapter now exposes a frozen `capabilities` snapshot for its selected CLI and implemented transport, with version/selector evidence in `compatibility`. Required launch/probe failures and truncated evidence fail closed; optional model/reasoning/resume selectors gate only requested features. Codex config remains required because invocation always uses environment overrides; resume-model selection is checked separately. OpenCode optional run/session probe failures disable their features without prohibiting the fresh API path, and embedded model variants also require reasoning support. All current transports report structured-final-output false because no stdout reporting fallback is implemented; OpenCode event-stream support remains false. Static registry capability validation stays pure and now covers reasoning effort for the existing field.

The headless service checks the selected snapshot during effective attempt preparation, including task/revision settings: unsupported model/reasoning selection routes existing `system.spawn_error`, unsupported explicit resume routes `system.resume_unavailable`, with useful durable failure/attention details before provider execution. Known adapter-authored option/session errors retain credential-free explanations; unexpected exceptions remain generic. Correction requires both resume capability and its callback, and unavailable correction never prohibits fresh work. Runtime journal/identity/cwd checks and exact non-creating admission remain adapter-owned; help markers cannot establish session existence or provider access. The coordinator, transactional events, process/group/pipe settlement, report token lifecycle, one bounded correction, revision scope and migrations 1–6 remain unchanged.

**Documented design adjustment:** the architecture's illustrative per-invocation `probe()` API is replaced by the actual async-factory/snapshot contract. `probeHarness`/`probeHarnesses` call those same built-in factories instead of `HELP_PROBES`; this is inventory only, not automatic RunService registration. Preflight occurs immediately before the affected attempt, not exhaustive run-creation rejection of every future branch/task. Callers recreate adapters after replacing/upgrading a CLI. No YAML fields or new system outcomes, mandatory gates or broad plugin framework were introduced.

Final validation using explicit Node.js **v26.8.2**:

- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run check`: typecheck/lint passed; **632 tests passed, 0 failed/cancelled/skipped**. Biome checked **103 files**, with **115 informational suggestions** and no errors. Output: `/tmp/workflowz-capabilities-check.log`. All existing adapter conformance cases remain included. The 56 additional capability cases cover missing required/optional flags, failed and genuinely oversized/truncated synthetic probes, exact flag boundaries, inventory/factory agreement, useful durable service failures, fresh execution without optional selectors, unavailable workflow/correction resume, OpenCode variants and Codex resume-model distinctions.
- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run smoke:capabilities`: independent checked-in smoke through the real Claude adapter and synthetic CLI. Required-feature and unsupported-model rejection launched zero invocations; supported fresh `wf` reporting completed; unavailable correction produced `system.report_error` without a correction; a later unsupported workflow resume produced `system.resume_unavailable` after only the original fresh invocation. SQLite reopen preserved each result; temporary databases/projects/logs/sessions were removed. Repeated against the final build after the complete gate.
- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run probe:harnesses`: all five isolated installed factory probes passed: Codex `0.163.0`, Pi `1.3.0`, omp `18.12.2`, OpenCode `2.0.32`, Claude Code `2.1.303`. All advertised effective resume/model/reasoning support; OpenCode alone reported event-stream false. Version/help only: no authentication/session/provider execution was attempted.
- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run validate -- examples/overnight.yaml`: valid, **8 steps, 0 warnings**.
- `git diff --check`: passed.

Process/loopback tests and installed probes used the approved outside-sandbox execution path. No paid/provider calls, credential-file inspection, global harness edits or dependencies were added. Phase 6.6 is checked after its offline acceptance gate. Phase 0.5 and 6.7–6.8 remain unchecked: authentication, successful live sessions/provider framing, resource/managed-config interactions and tool environment propagation remain unverified. No daemon management, management CLI or UI work was added; existing process-identity/escaped-descendant limitations remain Phase 7 work. The user authorized final complete-diff review, commit and push to `origin/main`.


## Phase 6.7 — deliberate child environments, credential scrubbing and bounded diagnostics

Started from clean `main` at **`f7978ee`**, following `b8b6d9d` and `024e348`; the requested `git log -3 --oneline` / `git status --short` matched the handoff. Read AGENTS and the requested documents in order. Used the installed codebase-memory skill with graph-first discovery, trace/snippet attempts and exact-path coverage checks for `home-phagmaier-Code-workflowz`; source remained `not_tracked`, so source and callers were read directly. Installed TypeScript 7.0.2 LSP references verified shared contract callers, with server requests acknowledged. No subagents were used. No replacement handoff document was created.

The audit confirmed deliberate top-level environments and common supervision already existed for all five adapters and their offline probes. OpenCode's nested server previously spread the already-reduced bridge environment; it now reselects the same existing base/OpenCode names, reporting access and fresh private password, including when the bridge is unexpectedly polluted. Existing harness configuration/authentication variables, unrestricted permission selections, session admission and capability snapshots are preserved. No new environment convention, harness flags, provider interpretation in the runner, global configuration changes or command restrictions were introduced. Synthetic CLI fixtures now use explicit temporary HOME/config plus PATH instead of inheriting actual parent provider credentials.

Concrete scrubber gaps were literal-only matching, overlapping values/replacement suffixes, UTF-8 boundaries, nested stream multiplexing and retirement of known report tokens between attempts. The existing filter is now shared in `adapters/secrets.ts`, matching original bytes and known literal/canonical JSON/URL component/form/Base64/Base64url representations. URL passwords/userinfo pairs and the private OpenCode Basic representation are included; public Basic usernames alone are not unnecessarily scrubbed. Each stream is filtered before observation/capture, and the combined log is filtered again after merging. OpenCode separately filters nested server streams before merging them, retaining short readable diagnostic lines with 4-KiB bounded buffering; long lines may interleave. Invalid byte/protocol evidence is not normalized away.

Known process secrets are exposed only as memory-only `AgentHandle` metadata and registered synchronously with the reporting channel before handlers can run. This closes encoded provider/private credential leakage through accepted report content as well as durable diagnostics. Rejected reports do not mutate state. The channel keeps known values/retired tokens solely for redaction/rejection until close; authorization still expires and rotates per invocation. Redaction history never enters argv, persistent input or harness tool environment; the private OpenCode bridge receives it through stdin. No report body fields, workflow fields, migrations or reporting authority changed. Token/history memory grows with distinct values/invocations and is released by channel shutdown.

All built-in adapters now preserve scrubbed stderr heads (at most **4096 UTF-8 bytes**) and stdout/stderr capture-truncation flags in the existing transactional invocation-settled event. The runner rechecks registered secrets before durable output/metadata and caps diagnostic bytes without splitting Unicode. Existing **64-KiB** process capture heads, **16-MiB** combined raw stream files plus cap markers, continuous terminal/session parsing and separate `.log.correction` files remain. Diagnostic data never settles a process or changes routing. Ordinary command steps retain the original base environment plus every workflow override and their ordinary output semantics.

Final verification with explicit Node.js **v26.8.2**:

- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run check`: strict typecheck/lint passed; **667 tests passed, 0 failed/cancelled/skipped**, **72 suites**. Biome checked **109 files**, with **115 informational suggestions** and no errors. Output: `/tmp/workflowz-boundaries-check.log`. The **35 additional tests** cover all five adapters' successful reporting, clean-status provider failure and nonzero crash; selected runtime/probe environments; independently polluted OpenCode bridge; retained bounded diagnostic/event evidence; injected credential report rejection; retired-token rejection/channel cleanup; probe failure scrubbing; byte-boundary/overlap/UTF-8/URL Basic behavior; and merged-log/diagnostic byte bounds. All existing conformance/capability tests remain included.
- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH node --test dist/adapters/boundaries.test.js dist/adapters/secrets.test.js`: **30 passed**, 0 failed/cancelled/skipped in the final isolated boundary check. Output: `/tmp/workflowz-boundaries-focused-final.log`.
- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run smoke:boundaries`: independent checked-in smoke through the real OpenCode bridge/server and Claude adapter against synthetic local CLIs. Each harness completed exactly one sequential same-session correction with one accepted report, and separately routed provider failure without correction. Synthetic credential submissions were rejected before valid reporting; stdout/stderr/raw logs and bounded durable diagnostics remained scrubbed; selected environments and SQLite reopen passed. Output: `/tmp/workflowz-boundaries-smoke.log`. Temporary projects/databases/sessions/logs were removed.
- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run smoke:capabilities`: all five preserved preflight/fresh/correction/resume scenarios and SQLite reopen passed. Output: `/tmp/workflowz-boundaries-capabilities.log`.
- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run validate -- examples/overnight.yaml`: valid, **8 steps, 0 warnings**.
- Installed offline inventory passed all five factories: Codex **0.163.0**, Pi **1.3.0**, omp **18.12.2**, OpenCode **2.0.32**, Claude Code **2.1.303**. The final exact shell sequence was:

  ```bash
  workflowz_probe_tmp=$(mktemp -d /home/phagmaier/Code/workflowz/.tmp-boundaries-probe-XXXXXX)
  trap 'rm -rf -- "$workflowz_probe_tmp"' EXIT
  TMPDIR="$workflowz_probe_tmp" PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run probe:harnesses > /tmp/workflowz-boundaries-probes.log 2>&1
  ```

  The disposable workspace directory was removed. Default `/tmp` probes had encountered **EDQUOT** extracting omp's native addon; an isolated credential-free `omp --help` stderr check confirmed that reason. Concurrent verification also encountered temporary SQLite WAL I/O errors. Isolated boundary and sequential full gates passed; no product workaround, hidden retry or global setup change was added. An earlier full run also exposed a conformance assertion that incorrectly assumed redaction history contained only report tokens; it now checks token inclusion while allowing adapter-private credentials. Final output above is the passing run.
- `git diff --check`: passed. `git diff --cached --check` also passed after reviewing the complete **43-file** tracked/untracked and staged change set.

Process/loopback and native checks used the approved execution path outside the sandbox; sandboxed Node had again produced incomplete per-file test output. All credentials used by fixtures/smokes were synthetic. No paid/provider calls, credential-file inspection, dependencies, global harness edits, daemon/management CLI/UI work or new approval gates were introduced. Phase **6.7 is checked only after this acceptance evidence**; **0.5 and 6.8 remain unchecked**. Environment selection is not isolation; known-secret matching does not recognize every unknown secret, arbitrary transformation or prior closed-channel token. Harness-managed files are not rewritten; authentication/live sessions/provider framing, tool inheritance and resource/managed-config interactions remain unverified. Process PID-reuse/escaped-descendant limits remain Phase 7 work. The user authorized final complete-diff review, commit and push to `origin/main`.

## Phase 6.8 — explicitly admitted locally authenticated harness smoke tooling

Verified the requested clean checkout at `e31ae75` (`Harden adapter environment and diagnostic boundaries`), following `f7978ee` and `b8b6d9d`. Read repository guidance and the required documents in order. Graph-first discovery/coverage for `home-phagmaier-Code-workflowz` again reported source as `not_tracked`; source was read directly. TypeScript LSP references preceded extracting the shared inventory factory dispatch; the LSP was refreshed after external formatting when reference context was stale. No subagents or handoff document were used.

Added `src/app/harness-smoke.ts`, its small developer-command entry point and `npm run smoke:harnesses`. No management CLI, daemon, UI or Phase 7 behavior was added. Model/harness/scenario/time/artifact selections are explicit. Plan mode performs no probes/authentication checks or smoke artifact writes (npm still builds first); provider execution requires `--execute` at both command and runtime admission. Ordinary tests/check/build/probes never execute a provider.

Extracted the existing built-in factory switch as `createInstalledAdapter`, shared by inventory and smoke execution, without creating another registry. Actual adapters, `RunService`, the existing report channel, supervisor and SQLite inspection/reopen provide the execution path. A disposable generated helper invokes actual `wf report`, checks acknowledgment and records a marker. `report` disables correction; `correction` deliberately requests an original clean turn without reporting, then demands one exact-session correction and matching persisted identities. An accidental original report cannot count as correction verification. Provider/process failures remain errors, with no hidden runner retry.

Normal runtime HOME/auth/config/resource discovery and existing unrestricted permissions are preserved. Documented Codex/Pi/Claude status checks have zero output capture and no log file; only credential-free status survives. Pi uses `--no-refresh`, never credential-printing options. OpenCode/omp record unavailable status-check support rather than inventing authentication evidence. Live status checks were not run against the user's account. Consulted current official and installed status/model/provider documentation; Context7 rejected its configured API key, so official sources were read directly.

Private evidence allowlists version, capabilities, permissions, selected model/effort, status/outcome, invocation/correction counts, session fingerprints, real acknowledgment and durable reopen. Existing bounded scrubbed adapter logs/SQLite remain for inspection; raw handles, report access and secret lists are never serialized. Settled generated target projects are removed; uncertain cleanup preserves them and fails. SIGINT/SIGTERM stop through the service. Harness-owned state/transcripts are never copied, rewritten or removed. Known-value scrubbing is not discovery of unknown credentials or isolation.

Verification using Node.js **v26.8.2** through the explicit mise PATH:

- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run check`: typecheck/lint passed; **697 tests passed, 0 failed/cancelled/skipped**, **75 suites**. Biome checked **113 files**, with **115 informational suggestions** and no errors. Full output retained at `/tmp/workflowz-live-smoke-check.log`.
- The **30 new offline tests** cover explicit admission/selection rejection, documented synthetic status exit semantics and environment boundaries, all five real factories/adapters' direct report and correction scenarios, exact durable identity/reopen/acknowledgment, accidental original reporting, original/correction provider/process/missing-report failures, invocation bounds, timeout, interruption, unavailable resume, unavailable/check-failed authentication and preservation on uncertain cleanup. All existing registered adapters' full shared conformance suites remain included in the passing full gate.
- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH node /tmp/workflowz-live-smoke-offline.mjs`: independent throwaway **actual command-surface smoke** passed all five harness selections. Temporary `codex`/`pi`/`claude`/`opencode`/`omp` executables used shell `exec` to existing synthetic CLIs, with synthetic successful status admission where implemented. Each real `harness-smoke-cli.js --execute` completed exactly two sequential same-session invocations, one correction, actual helper acknowledgment and durable reopen; a separate provider-error scenario exited 1 with one invocation and no correction. Retained evidence agreed with stdout; target cleanup passed. All generated workspace/config/session/database/log directories and the throwaway driver were removed. These are synthetic processes, **not authenticated live evidence**.
- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run smoke:harnesses -- --harness codex --model gpt-6.1-sol --reasoning-effort low --scenario correction --timeout-seconds 60 --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-6.8`: plan-only command displayed `execute: false`, maximum two invocations, 30-second correction and no spending cap. No harness/status/provider execution or smoke artifact creation. `npm run smoke:harnesses -- --help` displayed the explicit admission, time, permission and cleanup contract.
- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run validate -- examples/overnight.yaml`: valid, **8 steps, 0 warnings**.
- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run smoke:boundaries`: preserved OpenCode/Claude same-session correction, provider-error bypass, scrubbed diagnostics/logs, selected environment, settlement and SQLite reopen.
- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run smoke:capabilities`: all five existing required/model/fresh/correction/resume scenarios passed.
- Installed offline factory inventory: **all five passed**, Codex `0.163.0`, Pi `1.3.0`, Claude Code `2.1.303`, OpenCode `2.0.32`, omp `18.12.2`. Exact effective shell equivalent of the subprocess invocation used:

  ```bash
  workflowz_probe_tmp=$(mktemp -d /home/phagmaier/Code/workflowz/.tmp-live-smoke-probe-XXXXXX)
  trap 'rm -rf -- "$workflowz_probe_tmp"' EXIT
  TMPDIR="$workflowz_probe_tmp" PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run probe:harnesses
  ```

  Output: `/tmp/workflowz-live-smoke-probes.log`; workspace scratch removed. No provider/authentication check was part of inventory.

An initial targeted run exposed missing explicit synthetic Claude/OpenCode config-directory environment settings; the fixtures were corrected to use their temporary roots before the passing all-five and full gates. No product workaround, retry, dependency or global installed/configuration change was introduced.

**6.8 is checked for implemented opt-in tooling and offline acceptance only. No paid/provider-backed call has been authorized or made; milestone 0.5 and the full Phase 6 live gate remain open.** The [reviewable live proposal](harness-compatibility.md#proposed-live-pass--authorization-still-required) specifies Codex `gpt-6.1-sol` and Pi `openai/gpt-6.1-sol`, low reasoning, separate report/correction workflows, at most six sequential harness invocations, 60-second originals/30-second corrections, isolated target/artifact locations and no enforceable dollar cap. Actual model/account entitlement, provider framing, live tool inheritance and authenticated session correction remain unverified. No automatic live usage is authorized by committing this tooling.

### Account preference update — Luna with low reasoning

Before any live execution, the account owner paused the approved Sol proposal and requested Luna with `low` reasoning for all GPT usage. Updated the current README example and live proposal to Codex `gpt-6-luna` and Pi `openai/gpt-6-luna`, retaining `--reasoning-effort low`. This supersedes the Sol selections recorded above; historical verification commands/results remain unchanged. No automatic model upgrade, higher reasoning or provider fallback is authorized. This is the account's smoke-execution preference, not a hardcoded runner policy or a change to global harness configuration.

Plan-only verification (Node.js v26.8.2):

```bash
PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run smoke:harnesses -- --harness codex --model gpt-6-luna --reasoning-effort low --scenario correction --timeout-seconds 60 --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-6.8
PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run smoke:harnesses -- --harness pi --model openai/gpt-6-luna --reasoning-effort low --scenario correction --timeout-seconds 60 --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-6.8
```

Both commands built successfully and printed the requested Luna selector, `reasoningEffort: low`, `execute: false`, maximum two invocations and a 30-second correction bound. No harness/authentication/provider execution or smoke artifacts. The [official Codex model guidance](https://learn.chatgpt.com/docs/models) and [public Pi catalog](https://pi.dev/models/openai/gpt-6-luna) list Luna; account availability remains unverified. Live execution remains paused at the user's request, with zero provider-backed smoke calls.

## Phase 6 live acceptance — authorized Luna/low pass

Verified the requested clean checkout at `c7153c3`, following `1e739a6` and `e31ae75`, and read repository guidance in the requested order. No subagents or handoff document were used. The account owner explicitly selected **Resume Luna pass** after reviewing the revised model selections, four-workflow/six-invocation bound, stop-on-first-failure policy, execution timeouts, normal unrestricted resources and absence of an enforceable dollar cap. The earlier paused Sol approval was not used as authorization.

Executed the exact shell sequence recorded in [live compatibility evidence](harness-compatibility.md#authorized-live-pass--lunalow-execution-evidence), with Node.js **v26.8.2**, the named non-`/tmp` scratch directory and unchanged normal authentication/configuration discovery. All four workflows passed, in order: Codex report, Pi report, Codex correction, Pi correction. Models were `gpt-6-luna` and `openai/gpt-6-luna`, both with `--reasoning-effort low`; no alternative model, provider, increased reasoning or runner retry was used. Exactly six sequential harness invocations occurred; no failure required diagnosis or another paid run.

Reviewed all four retained `evidence.json` files under `/home/phagmaier/.local/state/workflowz/live-smoke-6.8`:

- `wf-codex-report-blA2nZ`: Codex `0.163.0`, one invocation, no correction.
- `wf-pi-report-xGYhJE`: Pi `1.3.0`, one invocation, no correction.
- `wf-codex-correction-6aUv2k`: Codex `0.163.0`, two invocations, exactly one correction, identical session fingerprints.
- `wf-pi-correction-TeHAIg`: Pi `1.3.0`, two invocations, exactly one correction, identical session fingerprints.

Every result records `passed`, authentication `available`, outcome `complete`, real helper acknowledgment, durable SQLite reopen and removed settled target. The smoke's assertions require one logical attempt and one exact accepted report, acknowledged before final process settlement. Independent SQLite review confirmed both direct reports and both correction histories: original exit zero/settlement, correction request/start, report acceptance, correction exit zero/settlement, then committed transition/completion. Reviewed scrubbed original/correction logs: originals returned `READY` without reporting; corrections ran the generated helper successfully and ended with clean terminal evidence. Codex retained `dangerously-bypass-approvals-and-sandbox`; Pi retained `default-unrestricted-tools`. Private evidence, logs, databases and scratch remain outside this checkout; harness-owned state was not copied, rewritten or removed.

Current offline verification after the live pass:

```bash
PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run check
```

Typecheck and lint passed; **697 tests passed, 75 suites, zero failures/cancellations/skips**. Biome checked **113 files**, with **115 informational suggestions** and no errors. This includes every registered adapter's full offline conformance suite; ordinary checks made no provider calls. No runtime code or tests changed in this acceptance-only update.

Updated current README/compatibility/milestone status and added superseding acceptance notes to spec/architecture without changing their contracts or rewriting historical verification. `git diff --check` passed for the six-file documentation-only change set.

**The Phase 6 gate is satisfied** by the complete live Codex/Pi evidence and current all-adapter offline gate. **Milestone 0.5 remains unchecked**: Claude Code, OpenCode and omp were not authenticated/executed against providers, and their successful live persistence/resume remains unverified. The exercised Codex/Pi paths do not establish arbitrary tool/resource/managed-config behavior or a billing cap. No credential files were inspected by the developer, no login/logout was performed, no global harness configuration changed and no Phase 7, daemon, management CLI or UI work was introduced. Future provider usage requires new authorization; further development beyond this scope requires direction.

## Remaining milestone 0.5 — compatibility preparation only

Started from clean `main` at `247fe13`, following `c7153c3` and `1e739a6`. After the account owner said to continue, clarified the remaining scope because Phase 7 was explicitly excluded and the previous live authorization covered only Codex/Pi. The owner selected **Finish compatibility preparation**: prepare the remaining proposal with no additional provider calls until approval. No subagents or handoff document were used.

Consulted current official Claude model/effort documentation, OpenCode v2 model/variant documentation and versioned omp 18.12.2 model/CLI documentation, linked in the [remaining live proposal](harness-compatibility.md#remaining-milestone-05-pass--proposal-only-not-authorized). Context7 rejected its configured API key; official documentation supplied the evidence. Proposed pinned `claude-haiku-5-5`/low for Claude and `openai/gpt-6-luna`/low for OpenCode/omp. Explicitly documented that normal native configuration can substitute models and the smoke evidence records requested settings, not an attestation of every provider request. No fallback, provider switch or config workaround is proposed.

Offline verification using Node.js **v26.8.2**:

- `npm run probe:harnesses` with `TMPDIR` set to a newly created disposable `.tmp-compat-preparation-*` directory under this checkout: all five isolated factories passed. Codex `0.163.0`, Pi `1.3.0`, omp `18.12.2`, OpenCode `2.0.32`, Claude Code `2.1.303`; all advertise resume/model/reasoning, OpenCode event-stream false. The temporary scratch directory was removed by the shell exit trap. Version/help probes only, no authentication checks.
- Exercised all six actual plan-only command paths with this exact sequence:

  ```bash
  export PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH
  for scenario in report correction; do
    npm run smoke:harnesses -- --harness claude --model claude-haiku-5-5 --reasoning-effort low --scenario "$scenario" --timeout-seconds 60 --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-0.5 || exit $?
    npm run smoke:harnesses -- --harness opencode --model openai/gpt-6-luna --reasoning-effort low --scenario "$scenario" --timeout-seconds 60 --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-0.5 || exit $?
    npm run smoke:harnesses -- --harness omp --model openai/gpt-6-luna --reasoning-effort low --scenario "$scenario" --timeout-seconds 60 --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-0.5 || exit $?
  done
  ```

  All six built and printed `execute: false`, the requested model, low reasoning, 60-second original timeout, maximum one/report or two/correction invocations and a 30-second correction bound. No authentication/provider execution or smoke artifact creation occurred.

Documented the unapproved six-workflow proposal: at most nine sequential invocations, stop at first failure, at most 450 seconds configured agent execution plus probes/status/build/cleanup, no enforceable dollar cap, no Codex/Pi repeats and no additional paid diagnostics/retries. Local model/catalog/variant availability and account entitlement remain unverified; milestone 0.5 remains unchecked. Phase 6's completed acceptance evidence is unchanged. No runtime code/tests, credential files, login/logout, global harness configuration, Phase 7, daemon management, management CLI or UI changed.
