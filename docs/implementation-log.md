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

- `npm run probe:harnesses` with `TMPDIR` set to a newly created disposable `.tmp-compat-preparation-*` directory under this checkout: all five isolated factories passed. Codex `0.163.0`, Pi `1.3.0`, omp `18.12.2`, OpenCode `2.0.32`, Claude Code `2.1.303`; all advertise resume/model/reasoning, OpenCode event-stream false. A final artifact check found that the persistent tool shell had deferred its EXIT trap, leaving only the owned scratch directory's Node compile cache. Cleared that trap and explicitly removed the directory; no product behavior changed. Version/help probes only, no authentication checks.
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

## Remaining milestone 0.5 — authorized execution stopped at omp

Verified clean `main` at `2bb70d0`, following `27cd439` and `247fe13`. The account owner explicitly approved the prepared Claude/OpenCode/omp model selections, low reasoning, six-workflow/nine-invocation ceiling, 60-second originals/30-second corrections, no fallback/additional paid diagnostics and stop at first failure. Preserved the required guidance, completed Codex/Pi evidence, absence of handoff documents and prohibition on subagents/Phase 7/management/UI work.

Created only the named scratch parent and ran the first three authorized commands separately with Node.js **v26.8.2**:

```bash
mkdir -p /home/phagmaier/.local/state/workflowz/live-smoke-0.5/scratch
env PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH TMPDIR=/home/phagmaier/.local/state/workflowz/live-smoke-0.5/scratch npm run smoke:harnesses -- --execute --harness claude --model claude-haiku-5-5 --reasoning-effort low --scenario report --timeout-seconds 60 --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-0.5
env PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH TMPDIR=/home/phagmaier/.local/state/workflowz/live-smoke-0.5/scratch npm run smoke:harnesses -- --execute --harness opencode --model openai/gpt-6-luna --reasoning-effort low --scenario report --timeout-seconds 60 --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-0.5
env PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH TMPDIR=/home/phagmaier/.local/state/workflowz/live-smoke-0.5/scratch npm run smoke:harnesses -- --execute --harness omp --model openai/gpt-6-luna --reasoning-effort low --scenario report --timeout-seconds 60 --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-0.5
```

Reviewed each retained `evidence.json`, scrubbed log and SQLite invocation ordering before advancing:

- **Claude `2.1.303`: passed**, one invocation, zero corrections, `complete`, authentication `available`, `bypassPermissions`, actual helper acknowledgment and durable reopen. Artifact: `wf-claude-report-p8hwmh`. Streamed assistant and terminal `modelUsage.canonicalModel` both identify `claude-haiku-5-5`, with no other model usage reported. Report acceptance preceded exit-zero settlement and completion. Authenticated correction/resume was not exercised.
- **OpenCode `2.0.32`: passed**, one invocation, zero corrections, `complete`, `session-allow-all`, actual helper acknowledgment and durable reopen. Artifact: `wf-opencode-report-H5Cedr`. Authentication remains classified `status_unsupported`, not a fabricated status pass; actual successful execution establishes usable authentication for this path. Requested selector was `openai/gpt-6-luna`/low; the private API transport does not expose provider-model usage, so no independent actual-model claim is made.
- **omp `18.12.2`: failed**, CLI exit 1, `execution_failure`, outcome `system.process_error`, one invocation, zero corrections, `yolo`. Artifact: `wf-omp-report-qbmi0O`. The log reports `No API key found for openai.` Native credential resolution failed; this is not a demonstrated Luna incompatibility or adapter framing defect. SQLite reopened read-only with one attempt, zero accepted reports and paused status; events show exit 1, technical settlement and pause, without correction. Evidence has no acknowledgment/session fingerprint and does not claim the smoke's success-only durable-reopen assertion.

**Stopped immediately after omp failed. None of the three correction scenarios ran.** No provider switch, model upgrade, increased reasoning, retry, extra paid diagnosis, login/logout or credential-file inspection followed. All three generated targets were removed after confirmed settlement; evidence/logs/databases and named scratch remain. Normal harness-owned state was not copied, rewritten or removed. Milestone 0.5 stays unchecked; the previously satisfied Codex/Pi Phase 6 gate is unchanged.

**Security observation:** OpenCode's normal MCP startup diagnostics logged a configured MCP API key unknown to the injected-value scrubber. Its value is deliberately excluded from documentation and commits; raw artifacts must not be published. Verified the containing artifact directory is 0700, and tightened its runner-owned log and SQLite file to 0600 without rewriting their contents. Treat that key as sensitive and rotate/revoke it through its owner if valid; no global configuration/authentication or automatic revocation was performed. This is concrete evidence of the already documented unknown-secret limitation, not proof that the known-injected-value filter failed. No all-secrets or isolation guarantee is claimed.

Only documentation changed in this checkout; no runtime code, tests, migrations, correction policy, provider choice or harness permissions changed. Further provider execution or credential/provider changes require new authorization.

Offline verification after the stopped live pass:

```bash
PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run check
```

Typecheck and lint passed; **697 tests passed, 75 suites, zero failures/cancellations/skips**. Biome checked **113 files**, with **115 informational suggestions** and no errors. These tests are offline; they neither retried the failed authenticated path nor authorized further live execution.

## Remaining milestone 0.5 — offline omp authentication investigation

Started from clean `main` at `a16463b`, following `2bb70d0` and `27cd439`, matching the requested checkout. Read the required guidance/evidence in order. No subagents, handoff document, Phase 7, daemon, management CLI or UI work.

Read versioned official omp 18.12.2 provider, environment, model and CLI references, plus the public bundled catalog. Context7 rejected its configured API key. Independently exercised the installed binary's offline `read omp://docs/providers.md` surface with `env -i`, disposable HOME/agent/XDG directories/cwd/TMPDIR, no credentials and telemetry initialization disabled. It exited 0 and confirmed provider-scoped authentication/precedence. Explicitly removed the owned `.tmp-omp-auth-docs-GjcLOs` scratch directory and checked that it no longer existed; no deferred EXIT trap was relied on.

Graph-first discovery and exact-path coverage for `home-phagmaier-Code-workflowz` still reported adapter source `not_tracked`; direct source reads verified the existing omp selection in `src/adapters/pi.ts`. Both OpenAI credential variables are already forwarded when supplied. No exported symbol or runtime code changed.

Recorded [offline findings and a minimal unapproved execution proposal](harness-compatibility.md#omp-authentication-prerequisite--offline-findings): `openai` uses `OPENAI_API_KEY`, while `OPENAI_CODEX_OAUTH_TOKEN` belongs to the separate `openai-codex` provider. The public versioned Luna row supports low effort; that is catalog evidence, not account entitlement or live compatibility. Credential precedence, profile/broker selection and launch-cwd dotenv discovery remain owner-controlled and uninspected. The disposable smoke target cannot assume another project's dotenv credentials.

Usable authentication for the intended omp `openai` path remains the prerequisite. No credential files, global configuration, normal harness state or retained live artifacts were inspected or changed; no authentication check, login, model refresh, provider request or failed-path retry was performed. The stopped authorization was not resumed. All three remaining-harness correction scenarios remain unrun; milestone 0.5 is unchecked and the satisfied Phase 6 gate is unchanged. The proposed future pass omits successful paid scenarios: omp report, then Claude/OpenCode/omp corrections, at most seven sequential invocations with 60-second originals/30-second corrections, stop at first failure. Provisioning and execution both require new authorization.

Offline verification using Node.js **v26.8.2**:

```bash
PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run check
```

Typecheck/lint passed; **697 tests passed, 75 suites, zero failures/cancellations/skips**. Biome checked **113 files**, with **115 informational suggestions** and no fixes applied. The installed documentation read and public-catalog inspection made no inference/provider requests. Only these two evidence documents changed; no tests, dependencies, migrations, schema or architecture contracts changed.

## Remaining milestone 0.5 — standing Meta Contributor integration

Started from clean `main` at `fb2a0b9`, following `a16463b` and `2bb70d0`. The owner explicitly selected **Meta Muse Spark 1.3 Contributor** for OpenCode/omp and identified **`MUSE_SPARK_API_KEY` in `~/.config/secrets.zsh`**, authorizing offline preparation and named-secret loading. Recorded that standing decision in README, compatibility notes and milestone context so future work does not ask for the key/source again. Contributor mode's permission to use submitted content for training is explicit. This supersedes these harnesses' OpenAI/Luna proposal, not the completed Codex/Pi gate, Claude selection or arbitrary workflow settings.

Added the targeted developer command `smoke:meta`, pinning `meta/muse-spark-1.3-contributor` and low reasoning while reusing `runHarnessSmoke`, actual factories, RunService, the report channel, process supervisor and durable-reopen assertions. It is not a management CLI or provider client. Plan/help do not read secrets or execute harnesses; execution still requires `--execute` and separately approved live bounds. The owner-approved source is parsed only for one literal assignment, never sourced as shell code; other file credentials are not imported. A fixed credential-free error rejects missing/ambiguous/expanded assignments and unsafe source permissions. The current-user-owned source was mode 0600 with one supported assignment. Its value was never displayed, put in argv/config/evidence, committed or copied to a new credential store.

omp/OpenCode now select `MODEL_API_KEY` and `META_API_KEY` through the existing environment and known-secret scrubber boundaries (including OpenCode's nested server). `smoke:meta` maps the one approved key to `MODEL_API_KEY` in adapter options without mutating global `process.env`. OpenCode gets a credential-free v2 Meta Responses provider configuration with low variant/encrypted reasoning inclusion inside the disposable target. A small developer-only preparation callback in the common smoke supports that project-local setup. Normal HOME/resources, unrestricted permissions, state/report/session/correction contracts and append-only migrations 1–6 are unchanged. No global harness configuration was edited; arbitrary workflows remain provider/model agnostic.

Used existing graph-first exploration/coverage; adapter/app source remained `not_tracked`, so direct source reads supplied evidence. LSP references preceded shared smoke/environment API changes. Current official Meta/omp/OpenCode references and the OpenCode JSON schema supplied exact model/auth/config contracts; Context7 remained unavailable because its configured API key was rejected. Meta's published OpenCode sample uses older configuration names, so this uses the installed v2 shape.

Verification on Node.js **v26.8.2**:

- Focused build and `node --test dist/app/meta-smoke.test.js dist/adapters/boundaries.test.js`: **23 passed**, 3 suites, no failures/cancellations/skips. Seven new permanent cases cover literal-vs-shell execution, preservation of credential bytes, ambiguous/missing/empty/expanded/unsafe sources, explicit admission and no ambient-key fallback. Existing real-process boundary cases now include both Meta credential names, scrubbed success/provider-error/crash evidence and credential-free factory probes.
- Disposable actual-command smoke: `node .tmp-meta-verification-9pJDQP/smoke.mjs` exercised `meta-smoke-cli` with temporary HOME/secrets/PATH and synthetic omp/OpenCode CLIs. Both harnesses' report and correction scenarios passed: one/two sequential invocations, real helper acknowledgment, exact-session correction, durable reopen, removed targets, no shell-file execution/imported unrelated key and no literal/Base64 synthetic credential in logs. This is synthetic integration evidence, not live model/account compatibility. An initial throwaway log scan encountered a session directory; its scan was corrected to select log files, not product behavior.
- Installed OpenCode configuration check: `node .tmp-meta-verification-9pJDQP/native-only.mjs` invoked installed `opencode models --standalone` with isolated home/config/state/cache, model fetching disabled, synthetic key and the generated provider configuration's endpoint temporarily changed to a loopback fixture. Exit 0, no diagnostics, exact Contributor model listed, **zero loopback requests**. No shared background service was used or managed. An earlier probe used an unsupported `--json` flag; installed `models --help` supplied the supported private-server listing surface. This verifies local configuration acceptance, not inference or live credentials.
- The same native-only driver called the real approved `loadMetaCredential` with the owner's file and printed only `loaded successfully; value withheld`. No provider/authentication request used that value.
- Explicitly removed the owned `.tmp-meta-verification-9pJDQP` scripts, fixture credentials, synthetic logs/databases/projects and isolated native state, then verified absence. No deferred EXIT trap was used. Retained prior live artifacts and normal harness-owned state were not inspected or changed.
- `PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run check`: typecheck/lint passed; **704 tests passed, 77 suites, zero failures/cancellations/skips**. Biome checked **116 files**, with **115 informational suggestions** and no fixes applied.
- `npm run smoke:meta -- --help` plus both omp/OpenCode correction plan commands: successful builds, explicit Contributor/low selection, named-source metadata only, `execute: false`, maximum two invocations and 30-second correction bound. No credential/probe/auth/provider execution or smoke artifacts in plan mode.

No live Meta provider calls, login, provider fallback, dependency changes, global edits, subagents, handoff document, Phase 7, daemon management or UI work. The previous failed OpenAI path was not retried. Milestone **0.5 remains unchecked** pending real compatibility evidence; loader readiness and synthetic successes do not establish entitlement or actual model use. The proposed bounded Meta pass is four report/correction workflows, at most six sequential invocations with 60-second originals/30-second corrections, stop at first failure and no enforceable dollar cap. Claude correction remains separate and unrun.

## Remaining milestone 0.5 — authorized Meta Contributor live pass

After integration commit `b2ec72e` was pushed, the owner explicitly selected **Verify both harnesses fully** with the documented Contributor/low selection, already approved local credential source, four standalone workflows/six sequential invocations, 60-second originals/30-second corrections, stop-on-first-failure policy and no enforceable dollar cap. No key-location/provisioning question was repeated. This separately approved paid verification; the earlier stopped authorization was not reused.

Executed omp report, OpenCode report, omp correction, then OpenCode correction, separately with the explicit Node.js v26.8.2 PATH and named non-`/tmp` scratch. Exact commands and artifact IDs are recorded in [Meta live compatibility results](harness-compatibility.md#authorized-meta-contributor-live-results). **All four passed in exactly six sequential invocations.** No fallback/provider change, reasoning increase, runner retry, failed-OpenAI-path repeat or additional paid diagnostic occurred.

Every scenario completed through the actual `wf report` helper acknowledgment, one accepted declared report, successful process/group/pipe settlement, durable SQLite reopen and removed disposable target. Both correction histories show original exit-zero settlement, correction request/start, accepted report, correction exit-zero settlement, with matching persisted session fingerprints and no overlap. omp's original correction turn returned `READY` without reporting; all observed omp assistant provider/model fields match `meta/muse-spark-1.3-contributor`. OpenCode retains the documented actual-model visibility limit; no inference of actual model usage is made from its requested selector. Both auth classifications remain `status_unsupported`; successful execution is the live authentication evidence.

Used only the existing named key, without displaying it, changing its source file, persisting it in repository/config/evidence or sourcing the shell file. A credential-aware local process inspected only runner-owned artifact files for known literal/JSON/URL/Base64/Base64url forms and found none. The first attempt to import the compiled loader into Eval's Bun package environment could not resolve project `yaml`; the same local audit then ran under the project's explicit Node executable, without dependency changes, secret output or another provider request. Private artifact directories are 0700; evidence/logs/databases are 0600, with log/database modes tightened without content rewrites. No unknown-secret guarantee is claimed, raw diagnostic artifacts remain unpublished, and normal harness-owned transcripts/state were not inspected or rewritten. Named live scratch remains intentionally; all generated `project/` targets were confirmed removed.

Post-live verification:

```bash
PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run check
```

Typecheck/lint passed; **704 tests passed, 77 suites, zero failures/cancellations/skips**. Biome checked **116 files**, with **115 informational suggestions** and no errors. No runtime code/tests changed during live acceptance; the subsequent changes synchronize current evidence/status in README, spec, architecture, checklist and these notes while preserving historical failures and earlier verification.

The Meta key/source and Contributor selection are now both documented and exercised successfully. **Milestone 0.5 stays unchecked only for Claude's authenticated correction scenario**, which was not part of this authorization. Phase 6 remains complete. No further paid calls, global configuration changes, Phase 7, daemon/management CLI/UI work, subagents or handoff document were introduced or authorized.

## Milestone 0.5 completion — authorized Claude exact-session correction

Verified the requested clean checkout at `9df2563`, following `b2ec72e` and `fb2a0b9`. Read required guidance/evidence in order and reviewed the retained successful Claude direct-report evidence without repeating that scenario. No source gap required implementation; no subagents or handoff document were used.

The exact plan-only command built successfully with Node.js **v26.8.2** and printed `execute: false`, `claude-haiku-5-5`, low reasoning, maximum two invocations, 60-second original and 30-second correction. It made no harness/authentication/provider execution or smoke artifact writes. After reviewing the selection, bounds, unrestricted resources and absence of an enforceable dollar cap, the owner explicitly selected **Authorize Claude correction**, including evidence review, documentation, offline verification and commit/push.

Executed only the newly approved correction workflow:

```bash
env PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH TMPDIR=/home/phagmaier/.local/state/workflowz/live-smoke-0.5/scratch npm run smoke:harnesses -- --execute --harness claude --model claude-haiku-5-5 --reasoning-effort low --scenario correction --timeout-seconds 60 --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-0.5
```

**Passed**, installed Claude Code `2.1.303`, authentication `available`, permission mode `bypassPermissions`, outcome `complete`, exactly two sequential invocations and one correction. Retained private artifact: `/home/phagmaier/.local/state/workflowz/live-smoke-0.5/wf-claude-correction-dHhE3e`.

Reviewed retained evidence plus read-only SQLite and allowlisted derived log facts:

- Original assistant returned `READY` without tools/reporting and settled exit zero. Correction request/start followed that settlement; no overlap.
- Original settlement, correction start and correction settlement retain the exact same persisted identity; both recorded session fingerprints match.
- Correction invoked the generated helper using actual `wf report`; acknowledgment, one exact accepted `complete` report, one logical attempt, completed run and durable SQLite close/reopen all passed.
- Durable event IDs are original start **5**, original settlement **6**, correction request **7**, correction start **8**, report acceptance **9**, correction settlement **10**, attempt settlement **11**, transition **12**, run completion **13**. Both invocation exits are zero with no timeout; acceptance preceded final settlement.
- Both logs contain successful terminal results. Every observed assistant model and terminal `modelUsage.canonicalModel` identifies `claude-haiku-5-5`, with no other model usage reported; requested effort is low.
- Smoke assertions confirmed process/group/pipe settlement. Independent filesystem inspection confirmed generated `project/` is absent. Artifact directory is 0700; evidence/logs/SQLite are 0600, with runner-owned log/database modes tightened without rewriting contents. Private evidence and existing named scratch remain intentionally.

No successful paid scenario was repeated, no fallback/reasoning increase/runner retry/extra paid diagnostic occurred, and the failed omp OpenAI path was not retried. No Meta key was loaded. No credential files, harness-owned transcripts/auth/config, login/logout or global configuration changes were involved in the developer review. Raw artifacts remain private; the earlier unknown MCP key exposure warning and recommendation to rotate/revoke it if valid are preserved. No all-secrets or isolation guarantee is claimed.

Updated README, spec/architecture acceptance notes, compatibility results and checklist only; runtime, tests, schema, example configuration, migrations and reporting/session/state contracts are intentionally unchanged. Historical failures/pending statements remain dated implementation-time evidence, superseded by actual acceptance. **Milestone 0.5 is checked only after this final live evidence review.** Phase 6 remains satisfied; Phase 7, daemon management, management CLI, UI and further paid execution require new authorization.

Post-live offline verification:

```bash
PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run check
```

Typecheck/lint passed; **704 tests passed, 77 suites, zero failures/cancellations/skips**. Biome checked **116 files**, with **115 informational suggestions**, no fixes and no errors. Ordinary checks made no provider calls. No runtime or test changes were needed for this acceptance-only milestone completion.

## Phase 7.1 — state ownership, Linux identity and conservative restart reconciliation

Started from clean `main` at `ddb46bc`, following `9df2563` and `b2ec72e`. After milestone 0.5 completion, the owner explicitly selected **Authorize Phase 7.1**: implement the headless/offline lifecycle slice, verify it, update docs and commit/push. No Phase 7.2 decision surface, daemon manager, management CLI/UI, paid calls or subagents were authorized or added. Required guidance and the completed compatibility evidence remain in force; no handoff document was created.

Graph-first discovery/coverage again reported source as `not_tracked`; source reads and installed TypeScript LSP references supplied the implementation evidence. Exported database/process/handle/invocation/recovery contracts and affected callers were inspected. The LSP returned stale imported declarations after edits; this was reported and the server reloaded. Import code actions were unavailable, so Biome's import-only safe organization was used, without applying unrelated informational suggestions.

Implementation:

- `WorkflowDatabase` takes an exclusive SQLite transaction on an adjacent canonical-path `.runner-lock` before main-database migration. Symlink aliases share ownership; peer writers fail with `InstanceLockError`. Close/crash releases the kernel lock without unlinking/reclaiming a stale PID file. Existing read observers now explicitly use `{readOnly: true}` and `RunCoordinator`. Deferred read transactions preserve consistent snapshots without allowing writes; failed opens release the lease.
- The supervisor captures Linux boot UUID, PID/PGID/session and start ticks. Actual commands, every real adapter and the fake fixture carry that evidence into coordinator-owned transactional state/events. Group signals require matching current ownership evidence; unsupported identity environments fail before spawn. Reaped-leader descendants are checked against the retained group/session/start bounds, not trusted solely from numeric `kill(..., 0)`.
- `invocation_dispatching` commits before every launch, including correction, and clears prior process identity. This preserves uncertainty in the spawn/persistence window instead of borrowing the original turn's settled identity.
- The first service facade on an owner connection automatically reconciles running/pausing runs, between-step cursors and pending interrupted attempts. Only the coordinator mutates interruption state, attention and audit history. Append-only migration **7** adds `recovery_state`, conservatively backfilling existing uncertain interruptions; migrations **1–6 remain unchanged**.
- `alive`, `mismatch` and `unknown` block new execution across that database. Reconciliation can establish `gone`, but never routes a retained report or automatically resumes/replays work. An interrupted resume requires a reason acknowledging uncertain effects. Unchanged observations are idempotent; changed observations append `process_reconciled`. Multiple facades on one connection cannot overlap drive or reconcile a live owner.

Verification exercised with explicit Node.js **v26.8.2**:

- `npm run smoke:recovery`: real owner SIGKILL during a command, a correction with accepted real `wf` report, the interval between committed steps, and the correction intent/spawn gap. Competing writers were refused; startup interrupted without replay or automatic signalling; report/transition history and SQLite reopen matched. Surviving process evidence blocked execution. Explicit smoke-owner cleanup established absence, and explicit continuation retried only the interrupted command or continued the committed cursor as selected. All owned processes, projects, sessions, leases and databases were removed; workspace scratch absence was independently checked.
- Focused build plus `node --test dist/adapters/process-identity.test.js dist/adapters/process.test.js dist/adapters/probe.test.js dist/app/harness-smoke.test.js dist/runner/recovery.test.js`: **72 passed**, **8 suites**, zero failures/cancellations/skips. This includes all five synthetic smoke selections, real report acknowledgments, timeout/stop/descendant cleanup, observed PID mismatch, malformed identity, crash uncertainty, no report routing/replay, exact-session correction intent and interruption transaction rollback.

Initial verification found and fixed concrete integration gaps: read-only inspection must permit snapshot transactions; kernel-thread `/proc` records legitimately have group/session ID zero; and smoke/conformance assertions must distinguish pre-spawn intent from actual invocation start/settlement. The snapshot reader also treats `ENOENT`/`ESRCH` as vanished processes, not ownership evidence. The host inspection found 152 zero-group/session records, explaining rejected descendant scans. The incidental exact event-type/log-text assertions were removed in favor of process ordering/session/count invariants, including the standalone boundary smoke consumer. The initial failed smoke's owned process identity was checked, its group was confirmed gone and its scratch explicitly removed before continuing. Known group IDs from the failing suite were also confirmed absent; no unrelated PID was signalled. Two earlier gates stopped on import ordering before tests, and the first full test gate exposed these integration failures; the focused passing results above follow the fixes.

The independent smoke sends no provider requests and uses no installed harness authentication. No live account scenario was repeated, no real credential source was read, and no global harness configuration/dependencies/permission selections changed. Historical live compatibility remains scoped to its original evidence, not a new post-change account attestation. The unknown-MCP-secret warning remains intact.

Limits are explicit: Linux `/proc` and a stable local SQLite filesystem are required; leases are per canonical state database, not isolation across arbitrary databases/projects. `/proc` checks and group signals are not atomic, escaped descendants remain outside ownership, and unknown launch windows stay blocked pending the Phase 7.2 decision surface. No automatic orphan termination, side-effect-success inference, workflow quality gate, hidden retry or rollback claim was added.

Final verification, executed sequentially:

```bash
PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run check
PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run smoke:recovery
PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run smoke:reporting
PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run validate -- examples/overnight.yaml
PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run smoke:boundaries
PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run lint
```

- Full gate: typecheck/lint passed; **717 tests passed, 79 suites, zero failures/cancellations/skips**. Biome checked **123 files**, with **121 informational suggestions**, no fixes and no errors. This retains all five adapters' complete offline conformance.
- Final recovery smoke: all four crash boundaries passed again after the integration fixes, with durable reopen and confirmed scratch removal.
- Reporting smoke: durable acceptance while active without routing, completed direct report, exactly one successful correction and exactly one failed correction routing `system.report_error` all passed; read-only observation and SQLite reopen passed; owned temporary artifacts removed.
- Boundary smoke: OpenCode and Claude synthetic correction and provider-failure paths passed with real reporting, selected environment, scrubbed logs/diagnostics, sequential settlement and SQLite reopen. The updated standalone consumer preserves process-order invariants while allowing intent events. Lint passed afterward.
- Canonical example: **valid, 8 steps, 0 warnings**. Workflow/report schemas and example configuration are intentionally unchanged.

Only **7.1** is checked after these acceptance results. Milestone 0.5 and Phase 6 remain complete. Phase 7.2–7.5, daemon management, management CLI/UI and further paid execution remain outside this authorization.

## Phase 7.2 — explicit headless recovery decisions

Verified clean checkout at `23350a3`, following `ddb46bc` and `9df2563`, and read required guidance/evidence in order. Investigated existing 7.1 controls and ran its offline recovery smoke before proposing implementation. The owner explicitly selected **Authorize bounded 7.2**: headless recovery inspection, checked orphan termination, independent external-cleanup attestation and audited workflow dispositions, including offline verification, documentation and commit/push. Phase 7.1 approval was not reused as broader Phase 7 authorization. No subagents or handoff document were used.

Graph-first discovery for `home-phagmaier-Code-workflowz` found documentation but no recovery source symbols; exact-path coverage again reported source `not_tracked`. Source reads and installed TypeScript LSP references supplied the implementation evidence. Stale imported declarations were reported and the LSP reloaded. Import code actions were unavailable; the changed files received import organization and formatting without unrelated lint fixes.

Implementation:

- Strict typed headless recovery requests bind each action to the inspected attempt and last run event ID, with a nonblank bounded reason. Durable inspection separates process evidence, retained report/log references and operator resolution; changed or duplicate requests fail rather than applying to a different operation.
- Explicit termination commits `recovery_termination_requested` before signalling, checks ownership before TERM/KILL and bounds each disappearance wait to one second. Confirmed group absence and the terminal audit commit together; audit failure leaves the canonical barrier intact. Shared-owner facades cannot overlap termination with drive, reconciliation or another termination. Startup never replays recovery signals.
- Append-only migration **8** adds `recovery_resolutions` for independently confirmed external cleanup. Migrations **1–7 are unchanged**. Confirmation requires literal acknowledgment and rejects a fresh verified live owned group. Unknown/mismatched evidence is not rewritten to `gone`; the operator assertion remains distinct from OS evidence and stage success.
- Explicit retry/continue/skip/jump/end decisions share a transaction with their audit and cursor/state changes. Retry applies to an interrupted stage, continue to a committed between-step cursor, skip to a declared outcome, jump to a task-compatible step, and end records stopped. Non-ending decisions remain paused until separate resume/drive. Reports, frozen inputs, sessions, correction counts and old interrupted attempts survive; manual skip transitions have no attempt. Existing manual controls cannot bypass unresolved process barriers.
- Legacy histories can contain several uncertain attempts backfilled by migration 7. Recovery presents each unresolved attempt in turn; confirming only the newest cannot strand or bypass an older process barrier. A permanent boundary case covers this history.

Focused verification using Node.js **v26.8.2** and project-local scratch:

- Build passed. `node --test dist/runner/recovery-decisions.test.js dist/runner/recovery.test.js`: **26 tests / 3 suites passed**, zero failures/cancellations/skips. Coverage includes real surviving-correction termination with retained accepted report/input, SIGKILL before signalling and after termination but before result persistence, identity mismatch refusal, TERM-resistant KILL escalation, cross-facade/no-overlap barriers, unknown correction resolution across reopen, explicit workflow dispositions, cursor/outcome validation, stale/duplicate rejection, legacy multiple interruptions and audit rollback.
- `npm run smoke:recovery`: all four real owner-crash surfaces passed through the new service API: command/explicit retry, correction/explicit manual skip, between-step/explicit continue and unidentified correction intent/operator confirmation plus end. Startup performed no replay; durable history and SQLite reopen passed; smoke-owned processes and artifacts were removed.
- The first focused run exposed a fixture readiness regression: the extended command scenario classifier announced the between-step case before settlement committed. Restored that boundary's post-commit-only readiness hook; the original 7.1 test and new continuation test then passed without changing runtime settlement or weakening assertions.
- Final review reproduced two cursor/history boundaries before fixing them. An earlier audited manual jump made `retry` target the moved cursor instead of the interrupted stage; retry now explicitly reselects the interrupted step. A later between-step crash after recovery/revision incorrectly borrowed a resolved historical attempt; inspection now uses the current interruption event. Both regressions failed before their fixes and passed afterward through the actual headless service, preserving old attempt/revision history.

Final acceptance, executed sequentially with the explicit Node.js v26.8.2 PATH and `TMPDIR=/home/phagmaier/Code/workflowz/.tmp-recovery-72-final-Rsz6Cr`:

```bash
npm run check
npm run smoke:recovery
npm run smoke:reporting
npm run validate -- examples/overnight.yaml
npm run smoke:boundaries
```

- **Full gate: 736 tests / 81 suites passed**, zero failures/cancellations/skips; typecheck/lint passed. All five adapters retain their complete offline conformance suites. The final gate includes legacy multiple interruptions, explicit retry after manual cursor selection and a new between-step interruption after recovery/revision. Earlier gates passed 734/735 tests before these final boundary checks.
- Final recovery smoke again passed all four explicit recovery decisions with durable reopen and no automatic replay. Reporting smoke preserved acknowledgment before settlement, one same-session correction on success/failure and durable SQLite history. Boundary smoke preserved OpenCode/Claude synthetic correction/provider-failure paths, scrubbing, selected environments and sequential settlement.
- Canonical example: **valid, 8 steps, zero warnings**. Workflow YAML/report schemas and the example remain intentionally unchanged; harness compatibility evidence is unchanged because no live scenario was repeated.
- Smoke/test-owned processes were settled/cleaned through checked identity helpers. Inspected both project-local verification scratch directories (Node compile caches only), explicitly removed them and verified scratch/recovery-smoke directory absence. No deferred shell trap was used.

The complete 16-file implementation/documentation change set was reviewed. **7.2 is checked only after these acceptance results**; 7.3–7.5 remain unchecked and require new authorization.

No provider/authentication execution, real credential-file inspection, global harness configuration changes, dependencies, management daemon/CLI/UI or Phase 7.3–7.5 implementation was added. Adapter/report/session contracts and unrestricted permission selections remain unchanged; no post-change live compatibility claim is made. Operator confirmation is trust, not an automated absence/isolation guarantee: false assertions or escaped descendants can still permit overlapping external work. `/proc` checks and signalling remain non-atomic, and no rollback or successful-side-effect inference is claimed.

## Phase 7.3 — management CLI and its local daemon/API

The owner's current request explicitly authorized 7.3 and the minimum daemon/API scaffolding required by independent management clients. It did not authorize 7.4–7.5, UI work, subagents, provider execution, or commit/push. Began on clean `main` at `012666b`, read the required guidance/design/example/acceptance files, and independently confirmed the 736-test / 81-suite baseline, example validation and recovery/reporting/boundary smokes. Initial sandbox checks could not bind loopback (`EPERM`); expanded offline execution was allowed. A sandbox test process was stopped before cleaning its session-owned failed fixture scratch and rerunning. No automatic approval rejection occurred.

Graph-first discovery initially found no relevant source symbols and coverage reported `not_tracked`; source reads supplied the implementation evidence. Later refreshed graph metadata covered the relevant files and tracing confirmed reuse of the existing factory/service path. No subagents, live harness calls, real credential-file inspection, global config edits or new dependencies were used.

Design and implementation:

- Explicit foreground `wf daemon start`, without auto-start/detachment. State selection is explicit flag, then `WF_STATE_DIR`, then XDG/user state default `workflowz`. A private current-user directory contains SQLite/lease/WAL, logs/session artifacts and atomically published owner-only discovery. The existing canonical database lease admits exactly one writer; competing startup cannot replace discovery. Restart rotates management authority and reconciles without dispatch/signals.
- Strict management RPC contracts live in contracts; the loopback HTTP/CLI plumbing lives in app. The daemon owns one reusable `RunService`, serializes async controls and rejects overlap while inspection stays available. Start/resume acknowledge the run ID and retain daemon-owned drive; no queue or automatic client retry. The service stop flag now resets before a subsequent admitted drive. Stop awaits only the drive belonging to the requested run, not an unrelated active run.
- Workflow validate/import/list, task preview, ready-run creation from text/imported revision, run listing/status/events/tasks/reports, pause/stop/resume, explicit overrides, task settings, revisions and the existing strict recovery actions are exposed. Import reuses immutable revision storage; no named-workflow CRUD, new schema migration, task re-import or YAML/report fields were added. Local CLI/API validation and the existing npm validator share one implementation.
- Existing-run control checks the inspected event cursor, including after async offline adapter probes. Interrupted runs cannot bypass exact-attempt recovery via normal resume/override/stop. Existing outcomes, audited reasons, task-compatible cursor checks, process barriers and transaction rules remain authoritative. Event listing uses an exclusive cursor and bounded page; status exposes executor/model, elapsed time and meaningful task counts.
- SIGINT/SIGTERM/API shutdown requests pause-after-current, drains admitted control and drive/report/log settlement, then closes discovery/database. Shutdown acknowledgment is admission; a stage without a timeout can delay exit. Unexpected drive failures expose a safe notice and conservatively reconcile; retained reports never route uncertain work.
- `bin/wf` routes only its first-argument `report` to the unchanged report client. Management tokens stay out of attempt environment/argv/state/history and use a separate listener. Real-token tests reject an attempt token at management (401) and the owner token at reporting (410). Same-user file access and escaped-descendant/non-atomic process limits remain explicit; no isolation/rollback claim is added.

Focused verification initially passed 8/9 new tests; the failing test helper incorrectly put management flags before `report`. Corrected the helper to invoke the preserved report syntax; all 13 focused management/validation tests then passed. Review added actual cross-token assertions, an interrupted-stop barrier test, and a regression case for stopping a saved run while an unrelated drive remains held. Command fixtures now await an explicit release file with a bounded timeout instead of assuming CLI calls finish inside a fixed sleep window. The first complete post-implementation gate passed 745 tests / 83 suites before these final review additions.

Final acceptance on Node.js **v26.8.2**, executed sequentially with `TMPDIR=/home/phagmaier/Code/workflowz/.tmp-phase73-work` and expanded permission for offline loopback/process fixtures:

```bash
npm run check
npm run smoke:recovery
npm run smoke:reporting
npm run validate -- examples/overnight.yaml
npm run smoke:boundaries
```

- **Full gate: 746 tests / 83 suites passed**, zero failures/cancellations/skips; typecheck and Biome lint passed. Biome checked 134 files, with 129 informational suggestions, no errors and no gate-time fixes. All five adapters retain their complete offline conformance. Earlier 745-test gates also passed before the final shutdown-admission test.
- **Management process coverage:** 10 tests in two suites, covering strict contracts/default selection, local validation without daemon, immutable definition import, checklist preview/create, run listing/status, event pagination, wrong-state/unknown/stale failures, competing writer/discovery protection, one active drive, owned stop and service reuse, unrelated saved-run stop, SIGTERM pause-after-current and explicit restart/resume, task settings/manual actions/revisions, real reporting with one exact-session correction, actual cross-token refusal, unsafe discovery/origin/body refusal, and agent crash/reopen without replay with retained report and exact recovery termination/end. API shutdown closes control admission before acknowledgment, remains inspectable while draining and never dispatches the next stage.
- **Recovery smoke:** all four real owner-crash boundaries passed with explicit recovery decisions, durable reopen, no automatic replay, and owned process/artifact cleanup. **Reporting smoke:** durable acknowledgment before settlement, direct reporting, exactly one successful correction and one failed correction routing `system.report_error` passed. **Boundary smoke:** OpenCode/Claude synthetic correction and provider-failure paths retained scrubbing, selected environment, sequential settlement and SQLite reopen.
- **Canonical example:** valid, **8 steps, zero warnings**, unchanged definition hash prefix `8a4912284968`. Workflow/report schemas and harness compatibility evidence remain unchanged; no paid/live scenario was repeated.

Reviewed the complete implementation/documentation changes and retained append-only migrations 1–8 without edits. Test/fixture cleanup explicitly reaped daemon children and checked attempt process identities before terminating any surviving owned group. Inspected session scratch (verification logs and Node compile cache), removed it explicitly and verified absence of both the session scratch and `.tmp-management-*` fixture directories. Final diff/format checks passed. **Only 7.3 is checked** after these results; 7.4–7.5 and Phases 8–9 remain unchecked. Changes remain uncommitted/unpushed pending the owner's requested approval gate.

### Phase 7.3 review fixes

Resolved all four review findings within the existing uncommitted management implementation:

- Shutdown admission now synchronously requests pause before the daemon acknowledges shutdown. Teardown rechecks after admitted controls settle, then awaits the drive. A gated real fake-agent attempt proves settlement before deferred teardown cannot dispatch the next command.
- Existing-run start/resume and revision exclude the consumed checklist from path checks. Creation still requires the source; live prompt/instruction inputs still receive their existing checks. A separate-process CLI test removes the checklist before start, pauses, revises and resumes, then verifies the same imported task ID reaches completion.
- The management client uses the HTTP response's streaming UTF-8 decoder. Success and error responses split into one-byte HTTP chunks preserve accented text, CJK characters and emoji.
- Status without an active attempt uses the current task's saved settings. Tests cover paused model overrides, replacement, clearing to the base model, and agreement with the model passed to the resumed fake adapter. Active attempts retain their frozen settings.

All four findings reproduced in focused regression tests before the fixes. Added six tests in total; the focused management/path run passed **21 tests / 5 suites**. The initial sandbox run could not execute the local listener/process fixtures; the expanded offline execution path passed without provider calls.

Final verification on Node.js **v26.8.2**:

- `npm run check`: typecheck/lint passed; **752 tests / 85 suites passed**, zero failures/cancellations/skips. Biome checked 136 files with existing informational suggestions only. Output: `/tmp/workflowz-review-check.log`.
- `node dist/app/validate-cli.js examples/overnight.yaml`: valid, **8 steps, zero warnings**, unchanged definition hash prefix `8a4912284968`.
- `git diff --check`: passed. Management fixture directories were removed by test cleanup.

README, specification and architecture now state the immutable-task admission and effective-status behavior and the shutdown ordering. No further milestone, provider execution, subagent, dependency, migration or global harness configuration change was introduced. Changes remain uncommitted/unpushed.

Final owner-approval review covered all 24 changed files, including 11 untracked implementation/test files, and found no additional actionable issues. A fresh expanded offline `npm run check` passed typecheck/lint and **752 tests / 85 suites**, with zero failures/cancellations/skips; output is `/tmp/workflowz-phase73-owner-review-check.log`. The canonical example again validated with 8 steps, zero warnings and hash prefix `8a4912284968`; `git diff --check` passed and management fixture cleanup was confirmed. The owner then explicitly approved committing and pushing Phase 7.3. This approval does not authorize Phase 7.4 implementation or additional provider execution.

## Phase 7.4 — run limits and durable bounded stage retries

After Phase 7.3 was committed/pushed as `d9dc297`, the owner explicitly approved offline implementation/testing of 7.4, with commit/push still requiring separate review/approval. Began from clean `main`; read the required guidance/design/example files and used the installed codebase-memory skill with coverage checks and source verification. No subagents, provider calls, real credential-file inspection or global harness configuration changes were used.

The existing reducer already bounded stage retries by the durable attempt count for run/step/task. The coordinator already counted committed transitions for run step limits and retained original start time for elapsed wall limits. These remain authoritative; no redundant counters or new workflow/report fields were added. The missing pieces were backoff admission, active-invocation run wall budgets and agent idle timeout.

- Append-only migration **9** adds only `runs.retry_not_before`; migrations 1–8 remain unchanged. Retry settlement, deadline, transition and event commit together. `advance` checks limits before waiting and creates no attempt until due. The service waits with an abortable timer; pause/stop/daemon shutdown wake it promptly. Pause/restart and same-cursor revisions retain the deadline, while audited cursor changes/skips/end or active-task completion cancel it. Startup still interrupts rather than automatically continuing a wait. Legacy rows receive no fabricated delay or changed history.
- Existing stage counts survive revision/reopen and stay scoped to task (or the whole taskless run). A correction/native retry is still inside its logical attempt; stage retry creates another attempt under the step's normal session policy. Explicit `goto` loops remain authored graph actions under run limits. No global retry-budget schema field or hidden retry was introduced.
- Remaining wall time caps each command/agent/correction launch; an exhausted budget prevents dispatch and does not reserve correction. Wall time still includes pauses, downtime and waits. Settlement rechecks limits and pauses with attention even when a timeout outcome routes elsewhere. Owned process/group/stream/log settlement remains required, with cleanup grace beyond the deadline and existing uncertainty barriers on failure.
- The shared process supervisor enforces optional idle silence on both raw stdout/stderr streams before redaction/capture limits. Every adapter forwards that duration (omp through Pi's shared path), without new harness flags or vendor assumptions. Idle expiry reaps the owned group and records bounded enum timeout diagnostics. Original timeout bypasses correction; idle correction failure remains `system.report_error`. Commands/probes receive no new idle policy. Idle is observable silence, not semantic progress: OpenCode's API transport is quieter and arbitrary output can keep a process active. Long process timers avoid Node's oversized-delay clamp.

Added deterministic and real-process regression coverage before/alongside implementation. Three backoff regressions failed against the old implementation (missing durable deadline/immediate redispatch), then passed; the existing rollback behavior remained intact. The first expanded focused run passed **34 tests / 10 suites**. The expanded migration/process/management/limit run passed **61 tests / 7 suites**, including daemon shutdown during backoff. The first complete gate passed typecheck/lint and **775 tests / 87 suites**, zero failures/cancellations/skips, including idle-after-report conformance for all five real adapters plus the scripted fixture. Final review tightened timeout diagnostics to known enum values and added per-task budget/exhausted-correction boundary tests; final acceptance follows below.

Final acceptance on Node.js **v26.8.2** / npm **11.19.1**, with expanded permission for offline loopback/process fixtures:

```bash
npm run check
npm run smoke:recovery
npm run smoke:reporting
node dist/app/validate-cli.js examples/overnight.yaml
npm run smoke:boundaries
git diff --check
```

- **Final gate: 777 tests / 87 suites passed**, zero failures/cancellations/skips; typecheck/lint passed. Output: `/tmp/workflowz-phase74-final-check.log`. The last focused counter/correction run passed **13 tests / 2 suites**. Added 25 tests over the reviewed 752-test Phase 7.3 baseline.
- Recovery smoke again passed command retry, correction skip, committed-cursor continuation and unidentified correction intent/end, with real owner SIGKILL, durable reopen and no automatic replay. Smoke-owned process/session/database artifacts were removed.
- Reporting smoke passed acknowledgment before settlement, direct reporting, exactly one successful correction and failed correction routing `system.report_error`, with durable SQLite reopen and fixture cleanup.
- Boundary smoke passed OpenCode/Claude synthetic correction/provider failures with retained environment selection, scrubbed diagnostics/logs, sequential settlement and SQLite reopen. No installed/live harness scenario or paid execution was invoked.
- Canonical example remains valid: **8 steps, zero warnings**, unchanged hash prefix `8a4912284968`. README includes the existing limit/retry fields and their completed behavior; spec/architecture/schema decisions are synchronized. No dependency, YAML/report schema or global configuration change was needed.
- Final diff checks passed. Confirmed no remaining project `.tmp-management*` or `/tmp/wf-run-limits-*` / `wf-retry-limits-*` fixture directories. Reviewed the complete tracked/untracked change set and kept migrations 1–8 unchanged.

**7.4 is checked only after this acceptance.** Changes remain uncommitted/unpushed for owner review; 7.5 and UI work require new authorization. Idle is an optional observable-silence bound, not semantic progress; process cleanup may exceed a deadline, and unknown/escaped processes and non-atomic identity checks retain the existing conservative recovery limits. No rollback or automatic successful-side-effect inference is claimed.

## Phase 7.5 — daemon crash boundaries and resumed revisions

The owner authorized offline Phase 7.5 implementation/testing, without subagents, providers, credential-file inspection, global harness changes, UI or later roadmap work. Initial inspection confirmed clean `main` at `f9bd2b9a47715b0783fce83ae3a6083ca4b18452` (owner-committed/pushed Phase 7.4); the historical pending-commit/authorization statements above are superseded. This milestone's commit/push still requires separate owner approval.

Read the required guidance, design, roadmap, example, Phase 7.1–7.4 acceptance and schema decisions before designing changes. The codebase-memory index was ready at generation `2026-10-19T22:57:53Z`; exact-path coverage for all 23 requested implementation/test/fixture paths reported metadata matches with no recorded issue. Graph discovery/tracing confirmed the existing daemon → management service → runner ownership path; source reads supplied the bounded assertion and lifecycle audit. No recovery, daemon, adapter, counter or supervision redesign was needed.

### Bounded coverage matrix

| Contract / boundary | Existing evidence retained | Phase 7.5 addition |
| --- | --- | --- |
| Actual owner crash during command/agent work | `runner/recovery.test.ts`: command, accepted original/correction reports, unknown correction spawn intent; management test: accepted original agent report through foreground daemon | Foreground command daemon SIGKILL and reopen; fake-agent daemon SIGKILL before reporting and during accepted correction; immutable report/input/invocation history and fresh explicit retry |
| Committed cursor and retry wait never auto-drive | Recovery tests/smoke: post-commit crash; `engine/retry-limits.test.ts`: durable deadline, revision, restart and cancellation; management test: graceful backoff shutdown | Foreground daemon SIGKILL immediately after committed settlement; real backoff crash/reopen through deadline expiry; separate continue and resume, preserved counter/start time |
| Duplicate ownership/admission cannot overlap | Management tests: competing owner cannot replace discovery, one active run, stale controls; recovery tests: global unresolved barrier and shared-facade guards | Concurrent separate CLI start/resume requests admit exactly one; recovered live tree blocks another run and premature retry disposition |
| Owned tree termination and escalation | `adapters/process.test.ts`: timeout, stop, KILL escalation and stream uncertainty; `adapters/probe.test.ts`: departed-leader descendant cleanup; all adapter conformance suites: owned-tree stop | Restarted daemon explicitly terminates TERM-resistant leader and descendant, observes both TERM handlers, confirms group absence and descendant reaping before retry |
| Unverified identity never permits signalling; termination crashes never replay signals | `process-identity.test.ts`, `recovery.test.ts`, `recovery-decisions.test.ts`: mismatched/unknown/old-boot identity, termination request/result crash boundaries, barrier/audit rollback | Reuse these focused cases rather than duplicate fault injection in the daemon fixture |
| Paused revisions survive real owner restart | Runner configuration tests: frozen parameters, immutable task snapshot/history and revision-scoped sessions; management tests: revisions with removed checklist and effective paused settings | Two paused-daemon restarts around revised session policy and fresh continuation; stable task IDs/progress, historical attempts/inputs/transitions/reports, new revision associations/settings and no cross-revision resume/fresh fallback |
| Cleanup, disposition and execution remain separate | Headless decisions: exact attempt/event/reason, external confirmation distinct from observation, retry/continue/skip/jump/end and duplicate rejection | Management recovery cleanup/decision does not execute; separate explicit resume creates only the selected new logical attempt or next committed stage |

Extended only the existing management test and offline daemon fixture. Fixture plans reuse `ScriptedAgentAdapter`, real local `wf report` and the common supervisor. The between-step injection stops the fixture process only after the real settlement transaction, following the existing headless crash-fixture convention. The backoff-expiry case deliberately uses the separate daemon's actual platform clock; fake parent timers cannot advance that persisted deadline. No production behavior, migrations, workflow/report schema or provider compatibility claims change.

### Verification

Node.js **v26.8.2**, npm **11.19.1**. The focused build and process/identity/management/recovery/revision/limit run passed **88 tests / 11 suites**, zero failures/cancellations/skips. All six new scenarios passed on their first execution. No production defect was exposed; this is an acceptance-coverage change, not a behavior cutover. Local child processes and loopback listeners ran successfully without weakening or skipping fixtures.

```bash
npm run build
node --test dist/app/management.test.js dist/app/management-service.test.js \
  dist/runner/recovery.test.js dist/runner/recovery-decisions.test.js \
  dist/runner/run-configuration.test.js dist/runner/limits.test.js \
  dist/engine/retry-limits.test.js dist/adapters/process.test.js \
  dist/adapters/process-identity.test.js
```

Final acceptance commands:

```bash
npm run check
npm run smoke:recovery
npm run smoke:reporting
npm run smoke:boundaries
node dist/app/validate-cli.js examples/overnight.yaml
git diff --check
```

- **Full gate: 783 tests / 87 suites passed**, zero failures/cancellations/skips; typecheck and lint passed. Biome checked 138 files with 134 informational suggestions, no errors/warnings and no gate-time fixes. All five adapters retain full offline conformance. The first full-gate attempt stopped at lint before tests because a new assertion used forbidden `!`; replaced it with explicit narrowing and removed an adjacent-space regex warning, then reran the complete gate successfully.
- Recovery smoke passed command retry, correction skip, committed-cursor continue and unidentified correction-intent end, with actual owner SIGKILL, durable reopen, no automatic replay and explicit owned cleanup.
- Reporting smoke passed durable acknowledgment before settlement, direct reporting, exactly one successful correction and failed correction routing `system.report_error`; durable SQLite reopen and cleanup passed.
- Boundary smoke passed OpenCode/Claude synthetic correction/provider-failure paths with selected environment, scrubbed logs/diagnostics, sequential settlement and SQLite reopen. No live provider compatibility scenario was repeated.
- Canonical example: **valid, 8 steps, zero warnings**, unchanged hash prefix `8a4912284968`. Specification, architecture, schema decisions, example and migrations remain intentionally unchanged: this milestone verifies the established contracts rather than changing them.
- Fixture teardown reaped each daemon, checked recorded process ownership before any surviving-group cleanup, required group absence and removed its own root. The new tree case explicitly confirmed descendant `/proc` disappearance after TERM-to-KILL escalation before retry. Final process inspection found no management/fake-agent/recovery fixture process or matching temporary working-directory survivor; project `.tmp-management*` directories and this verification's `/tmp/wf-*` fixture directories were absent. **45 older `/tmp/wf-*` directories were preserved**, newest creation `2026-10-19T22:19:54.788Z`, before initial index inspection at `22:57:53Z`. They are not this session's cleanup targets; no uncertain historical evidence was deleted or unrelated process signalled.

**7.5 is checked only after this acceptance.** No production defect was exposed, and no runtime code, dependency or migration changed. Existing limits remain: Linux `/proc` and reliable local SQLite locks are required; identity inspection/signalling is non-atomic; escaped descendants and unidentified operations cannot be proven safe automatically; operator cleanup confirmation is a consequential assertion, not isolation or successful-side-effect evidence. SIGKILL fixtures do not simulate every power-loss/storage failure. No rollback, exactly-once external effects or new live-provider attestation is claimed. UI/later milestones remain unauthorized. Changes are uncommitted/unpushed pending owner review and approval.

After the acceptance review, the owner explicitly approved committing and pushing Phase 7.5 and requested a fresh-agent prompt for the next task. This supersedes the pending-approval statements above; it does not authorize this session to implement Phase 8 or run providers.

## Phase 8.1 — localhost workflow preparation shell

Started from clean `main`, synchronized with `origin/main`, at the requested `a5dbe8527852673121ec16b3d9e8fa76d245fbae`. The owner's current prompt authorizes offline 8.1 implementation/testing only and supersedes historical UI-unauthorized statements. No subagents, live providers, real credential-file reads, global configuration changes, commit/push or Phase 8.2–8.5/9 work was performed.

Read the required guidance/design/checklist/example in order, then management/recovery evidence and schema decisions. The installed codebase-memory skill identified a ready index at generation `2026-10-19T23:14:02Z`; all 16 named implementation/test/tooling paths had metadata-match coverage without a recorded issue. Exact graph symbol lookup plus direct source and TypeScript LSP references established the existing daemon/management/runner boundary. No second database/execution owner or migrations were needed.

### Design and implementation

Documented the minimum integration and browser authorization in architecture §8.2 and spec §7 **before implementation**. Chose native HTML/CSS and browser TypeScript rather than a framework, bundler, component library or extra server: existing `tsc` emits the client and a tiny build step copies its inert static assets. No dependency or lockfile changes. YAML selection mutation uses the existing library's [document API](https://github.com/eemeli/yaml/blob/main/docs/04_documents.md), consulted through current official documentation; originals remain untouched and the UI warns about normalization in saved revisions.

- The explicit foreground daemon serves `/ui/`; `wf ui` obtains a separate one-use five-minute pairing code through private CLI management authority. Manual code exchange creates a single 12-hour HttpOnly/SameSite/path-scoped cookie session, rotated by successful pairing and revoked by logout/restart. Codes never appear in URLs, bundles or daemon logs; deliberate `wf ui` terminal output is private credential material.
- Exact loopback Host rejects rebinding; exact Origin, JSON and a custom request header are mandatory on browser POSTs, with no CORS. Existing CLI Origin rejection and attempt reporting stay unchanged. The strict browser allowlist cannot dispatch, resume, stop, mutate existing runs, recover, read arbitrary files or run commands. Body size/read bounds are shared with management. Authorization is rechecked after body receipt, preventing a partially received mutation from surviving logout/session rotation/expiry. Security headers prohibit framing/external resources/inline script/caching/referrer propagation. Task/workflow text uses inert DOM text.
- Upload an existing YAML definition with its original absolute directory, or select a saved immutable revision. Select root, ordered instruction paths, optional checklist path and explicit prechecked inclusion; all step/policy fields remain outside editing scope. Canonical validation, immutable save, task preview and ready-run creation delegate to the established management facade and runner. Preview writes no run/revision. Creation rereads the current checklist, freezes it and never starts execution. Unchanged inputs retain exact revision identity.
- Saved workflow and run lists refresh explicitly. Errors expose useful definition/path/operation/daemon failures; timeout messaging warns that save/create may have committed and requires inspecting lists before a repeat. Browser reload discards unsaved inputs but not persisted revisions/runs. Browser disconnect has no daemon lifecycle effect.

### Focused and actual-browser verification

The focused build plus browser/management/client/task-import/revision run passed **34 tests / 6 suites** before the final in-flight revocation regression was added. Final browser boundary suite: **7 tests / 1 suite passed**, zero failures/cancellations/skips. Covers exact-host/origin/header/content-type enforcement, separate bearer/cookie authority, one-use/rotated/expired/revoked sessions including a held request body, read-only preview, unchanged revision identity, immutable changed-source snapshots, strict controls/unknown-fields/oversized/malformed rejection, missing inputs and graph-only creation.

The initial focused host test exposed a fixture issue: Node fetch replaces a supplied Host header, so it never sent the malicious Host. Replaced that check with actual raw HTTP; the rebinding request is now exercised and rejected. No Origin/Host protection was weakened. Final review also added the held-body revocation check rather than leaving authorization checked only before an asynchronous read.

Used actual Chromium against the real foreground daemon and synthetic project files in this session's `/tmp/wf-browser-81-qRaAe9`, with no execution required:

- Invalid pairing and duplicate YAML errors visible; successful deliberate pairing; missing project root, instruction and checklist errors visible.
- Project-root change to a separate synthetic directory, ordered two-file instruction selection, different checklist path, saved revision, reload and saved-source reselection preserved the configured inputs.
- Nested/prechecked/Unicode tasks previewed correctly, prechecked exclusion and explicit inclusion both exercised. HTML-like task text remained text (zero injected image nodes). CLI inspection proved preview/save created no run.
- Changed the checklist after preview: browser creation froze the **new** task, not the preview; a later file edit left imported tasks unchanged. Explicit prechecked creation queued both checked/unchecked items. A graph-only upload previewed without tasks and created another ready run.
- All three created runs stayed `ready`, with null start times/no execution. Reload and tab close/reopen retained listing while daemon ping stayed healthy. Explicit owner restart required fresh pairing and preserved all three ready states. Logout returned the pairing surface; stopped-daemon refresh showed the useful transport error.
- Desktop/full-page and 390px mobile visual inspection passed. A final mobile adjustment keeps the 760px run table inside its 320px scrolling container without page overflow (390px document/viewport). No browser page errors were observed.
- Explicitly closed all managed tabs. Both foreground fixture daemons exited with code 0; both loopback listeners refused connections and discovery was absent. Removed only this session's fixture root and verified absence. Historical `/tmp/wf-*` evidence directories were not cleanup targets.

Limits: preparation only, not the full Phase 8 gate. No stage/transition/YAML editor, dashboard/controls/streaming, paused editing, arbitrary file picker API or task re-import. Paths are typed explicitly; the browser cannot infer a selected file's original directory. One browser session at a time, manual refresh, unsaved form state resets on reload, and selection edits may normalize saved YAML. Loopback HTTP and same-user cookie boundaries are not isolation from malicious same-user programs. Existing process/recovery/external-effect limits remain unchanged.

### Final acceptance

Executed sequentially on Node.js **v26.8.2** / npm **11.19.1**:

```bash
npm run check
npm run smoke:recovery
npm run smoke:reporting
npm run smoke:boundaries
node dist/app/validate-cli.js examples/overnight.yaml
git diff --check
```

- **790 tests / 88 suites passed**, zero failures/cancellations/skips; typecheck passed. Biome checked 147 files with no fixes, no errors/warnings and the existing 134 informational suggestions. All five adapters retain full offline conformance.
- Recovery smoke passed all four owner-crash/disposition paths with no replay, durable reopen and owned cleanup. Reporting smoke passed durable acknowledgment before settlement, direct reporting and exactly one successful/failed correction with reopen and cleanup. Boundary smoke passed synthetic OpenCode/Claude correction/provider-failure paths, scrubbing, selected environment, sequential settlement and reopen.
- Canonical overnight definition: valid, **8 steps, zero warnings**, unchanged hash prefix `8a4912284968`. Example, workflow/report contracts, migrations 1–9 and harness compatibility behavior are intentionally unchanged.
- Required diff whitespace check passed. Browser verification used real loopback listeners/local processes without sandbox workarounds or skipped scenarios; fixture-owned daemon exits, closed tabs/listeners and removed directory were explicitly verified above. No live/paid provider was invoked.

**Only 8.1 is checked** after these results. README, specification, architecture and schema decisions describe the implemented boundary and limitations. No separate handoff document was created. Changes remain uncommitted/unpushed pending separate owner approval. Proposed commit: `Implement Phase 8.1 localhost workflow preparation shell`.

## Phase 8.2 — canonical visual stage and policy editor

Started from clean `main`, synchronized with `origin/main`, at owner-accepted/pushed
`8a2caf010fc8f0d6cdb21a66fd4dc5b2ef6237ff`. Current authorization supersedes historical
8.1-only/pending-commit statements above and covers offline 8.2 only. No subagents, provider
execution, credential-file inspection, global setup changes, migrations or later roadmap
implementation were used. Commit/push still requires separate owner approval.

Read guidance, README, spec, architecture, roadmap and example in order, then schema decisions
and 8.1 evidence. Codebase-memory reported ready generation `2026-10-19T23:27:39Z`;
eight cited paths and engine scope had no recorded coverage issue and metadata matches.
Graph symbol discovery, direct source and TypeScript LSP references established the native
frontend → browser service → shared validation/compiler/router boundary. Source inspection
supplied routing details after a narrow graph filter returned no candidates.

### Design

- Retained native HTML/CSS/TypeScript, `tsc` and the existing static-asset copy step. Added
  `web/editor.ts` and one explicit same-origin module asset; no dependency, bundler or extra server.
- Exact YAML remains draft authority. The read-only typed `draft` operation optionally serializes
  a visual document, then returns canonical strict parse/compile/path diagnostics, its shape-valid
  model and router-resolved normal/system transitions. Existing `resolveOutcome` supplies
  precedence/provenance and catch-all/built-in fallback; there is no browser policy resolver.
  Shared check results retain the parsed model on semantic failure; `inspectWorkflow` shares one
  parse/compile/path pass with existing summary validation without changing management replies.
- All canonical stage kinds and applicable fields, stable-ID add/remove/display reordering,
  direct goto/pause/bounded retry, all/tag/explicit-step policies, defaults, correction settings
  and optional limits are configurable. JSON argv/env controls retain exact strings and empty
  arguments. Removal leaves invalid references visible rather than repairing the graph.
- Visual groups apply explicitly. YAML input immediately invalidates visual/save/create state.
  Explicit validation adopts only a matching generation and exact source; unchanged text does
  not reset selection/caret. Parse/schema failures retain editable text and disable visual
  mutation; semantic/path failures keep a shape-valid model available for correction. Visual
  serialization may normalize comments/formatting and materialize canonical defaults; text-only
  validation/saving retains exact source identity. Originals are never written.
- Save/create validate the raw current draft before applying selections and again through the
  ordinary management path. Invalid drafts cannot become revisions/runs by accidentally replacing
  a bad input path. Saves reuse immutable storage; editing/saving does not mutate old runs.
  Preview/draft validation writes nothing and creation only returns ready runs.
- Cookie/pairing/Host/Origin/JSON/custom-header/CSP/revocation protections and private CLI/report
  authority are unchanged. No execution, existing-run mutation, recovery, arbitrary-file or
  generic management-proxy API was added.

### Focused and actual-browser evidence

Focused browser/compiler/router/management admission run: **71 tests / 9 suites passed**.
After sharing the parse/compile/path inspection, browser/compiler/path/client run:
**65 tests / 7 suites passed**. Browser boundary suite now includes three consumer-visible tests
covering invalid-draft retention/rejection, policy/system precedence/provenance and model-field
round-trip/immutable revisions/ready runs.

Two initial focused failures improved the boundary/test: an empty document has no source location,
so location assertions apply only when text exists; and selection replacement could otherwise
save a source draft with a bad path, so save/create now reject invalid raw input before overrides.
An actual delayed-response exercise exposed unnecessary textarea assignment resetting selection
during replacement; adoption now checks generation plus exact source and avoids assigning equal
text. Retesting retained the entire newer text and left save blocked until fresh validation.

Actual Chromium against owned disposable foreground daemons under
`/tmp/wf-editor-82-2RO4aw`, without executing any configured stage:

- Created a workflow and added/connected agent/command/task.next/task.complete/end stages.
  Display reorder preserved start/IDs. Edited fresh/resume, inline/file prompt, model/reasoning,
  stage instructions/cwd/timeout/tags/context, command argv (including empty argument)/env and
  terminal label; malformed JSON displayed an operation error without changing canonical YAML.
  Removing a referenced terminal produced `unknown_step` and blocked saving.
- Edited defaults/correction/limits and all/tag/explicit-step selectors; compiler tables showed
  direct-over-tag precedence, inheritance after removing a direct rule, each policy specificity,
  defaults, exact retry (3 total attempts / 5-second backoff), `system.error` fallback and built-in
  pause. Empty outcome input displayed a useful error without an uncaught page error.
- YAML syntax, unknown field, missing start/target, undeclared direct outcome, unknown policy
  outcome, equal-precedence conflict and missing root all retained exact drafts and blocked save.
  Diagnostics included model paths and source locations. Corrected YAML restored visual controls.
  A delayed real validation response could not overwrite newer text.
- Changed project root and ordered two-file instructions; nested/prechecked Markdown preview and
  explicit inclusion worked. HTML-like task text remained inert (zero injected image nodes).
  Changed the checklist after preview: ready creation imported the new actual source; a later file
  edit did not change frozen task titles.
- Saved/reused revisions, then saved another definition: both created runs stayed ready with their
  original revision/root/task snapshots. Selecting the historical revision reproduced its exact
  prior YAML. Uploading valid and malformed files preserved text appropriately. Reload reset
  unsaved YAML and retained both run rows/saved revisions; logout left daemon ping available.
- Desktop and 390px mobile screenshots inspected. Document width equaled viewport (390px);
  effective tables stayed inside a 320px scrolling container with 520px content. No uncaught
  JavaScript errors; the deliberate stopped-daemon request reported connection refusal.

The final foreground restart exercised the shared inspection path in actual Chromium, including
an invalid report-context step reference, correction through visual fields and another immutable
save. Both original runs still reported ready with revisions 1 and 3. A stopped-daemon validation
showed the transport/retry warning and retained the entire draft. All three owned foreground
daemons exited with code 0. Explicit connection attempts to ports 36533, 35243 and 44863 were
refused; discovery was absent. Closed the managed browser tab (no managed tabs remained), removed
only this session's fixture root and verified absence. Historical/uncertain artifacts were
preserved.

### Final acceptance

Node.js **v26.8.2**, npm **11.19.1**. The first full run exposed a contract-layer violation from
a type-only reference to engine routing metadata. Moved the response DTO to `app/browser-service.ts`,
migrated all consumers and kept the architecture guard unchanged. Focused architecture/browser
check then passed **15 tests / 2 suites**. The subsequent complete `npm run check` passed
**793 tests / 88 suites**, zero failures/cancellations/skips, with typecheck and lint passing.
The first combined command's final whitespace check caught the temporary blank EOF while this
log was being completed; `git diff --check` passed after completing the documentation.

Executed the required acceptance commands:

```bash
npm run check
npm run smoke:recovery
npm run smoke:reporting
npm run smoke:boundaries
node dist/app/validate-cli.js examples/overnight.yaml
git diff --check
```

Recovery smoke passed all four crash/disposition paths, durable reopen, no replay and owned cleanup.
Reporting smoke passed acknowledgment before settlement, direct reporting, exactly one successful
correction and failed-correction routing with durable reopen/cleanup. Boundary smoke passed synthetic
OpenCode/Claude correction/provider-failure paths, scrubbing, environment selection, sequential
settlement and reopen. Overnight example: **valid, 8 steps, zero warnings**, unchanged hash prefix
`8a4912284968`. No provider was executed; no migration, dependency or harness behavior changed.

**Only 8.2 is completed here, not the full Phase 8 gate.** Limits: native stage-list rather than a
graph canvas; command argv/env use JSON; field groups apply explicitly and unapplied fields are
discarded on stage switch or text validation; unsaved drafts reset on reload; visual serialization
may normalize comments/formatting/defaults and therefore create a new textual revision even with
equivalent semantics. Paths remain explicit, with no filesystem picker API. No dashboard/execution
controls, paused-run editing or later-phase browser suite was added. Existing same-user,
process/recovery and external-side-effect limitations remain unchanged. Changes are uncommitted
and unpushed pending owner approval. Proposed commit:
`Implement Phase 8.2 canonical visual workflow editor`.

After acceptance, the owner approved committing and pushing Phase 8.2. This supersedes the
pending-approval statements above. The next ordered milestone is Phase 8.3; no Phase 8.3–8.5
or Phase 9 implementation is included in this commit.

## Phase 8.3 — run dashboard and explicit execution controls

Authorized offline implementation/browser verification and commit/push, building on accepted
Phases 8.1–8.2. No live providers, paused-run browser editing/manual intervention (8.4), or
later browser suite (8.5) are included. The full Phase 8 gate and MVP remain incomplete.

### Implementation and boundary

- Added a selected-run dashboard over the existing management facade: current task/stage,
  effective harness/model/reasoning, elapsed run wall time, accepted report details and
  attention items with attempt identity. New ready runs open it without starting execution.
- Known imported queues show accepted engine-owned completed tasks / total; empty queues
  omit percentages and graph-only runs never manufacture them. Agent report acceptance
  alone does not complete a task or settle a process.
- The strict browser request allowlist adds only status, reports, exclusive-cursor events
  and explicit start/pause/stop/resume. Named response DTOs live in the app layer and the
  management responses satisfy them. Host/Origin/custom-header/JSON/cookie/CSP protections
  are unchanged. No generic management passthrough, recovery/edit/raw-log/filesystem
  endpoints, dependencies, migrations or harness runtime changes.
- Inspection refreshes every two seconds, one 100-event page at a time, retaining up to
  300 fetched rows and marking pending history. Selection generations discard delayed
  responses. Report/attention/event regions scroll rather than stretching the entire page.
- Controls submit the inspected event ID; stop/resume require a reason. Existing stale
  rechecks, drive ownership, sequential settlement and recovery barriers stay authoritative.
  Rejections and transport failures invalidate the client cursor, stop refresh and require
  explicit inspection before another control. No automatic mutation retries. A lost stop
  response does not cancel daemon termination; files are not rolled back.

### Verification

`npm run check` passed **795 tests / 88 suites**, zero failures/cancellations/skips, including
typecheck and Biome lint. Two new browser-API integration cases exercise actual fake child
processes, report-before-settlement/task counts, stale controls, cursor pages, pause/resume,
stop settlement, blocked attention, exact-Origin refusal and interrupted-recovery refusal.
An initial focused assertion expected a stopped attempt to be failed; corrected it to the
existing interrupted-attempt stop semantics, without changing runtime behavior.

Additional executed commands (using the built `dist/`):

```bash
node scripts/smoke-recovery.mjs
node scripts/smoke-reporting.mjs
node scripts/smoke-boundaries.mjs
node dist/app/validate-cli.js examples/overnight.yaml
```

Recovery passed all four crash/disposition scenarios, durable reopen, no replay and cleanup.
Reporting passed actual acknowledgments before settlement, direct reporting and bounded
correction success/failure with reopen. Boundary smoke passed synthetic OpenCode/Claude
correction/provider-failure, environment selection, scrubbing, settlement and reopen.
Canonical example: **valid, 8 steps, zero warnings**, hash prefix `8a4912284968`.

Actual Chromium against an owned disposable daemon under `/tmp/wf-dashboard-83-qhbiS3`,
using only the existing `ScriptedAgentAdapter` and real `wf report`:

- Paired normally, inspected a ready two-task loop and pressed Start. Saw the active task,
  configured `codex` / `offline-browser-model` / low, and the accepted report while progress
  stayed **0/2**. HTML-like task text rendered literally, with zero injected image nodes.
- Pressed Pause after current during a report-then-delay child. Observed pausing at the
  agent stage, then paused at the routed `task.complete` cursor after settlement, still
  **0/2**. Resume without a reason was rejected locally.
- Resumed explicitly: first task completion yielded **1/2**, second fake report routed
  `blocked` to paused with a blocking attention item and originating attempt ID. Expanded
  its full immutable report payload, including outcome, summary, issue and data.
- Admitted a separate resume using the browser API, then pressed the stale Resume button.
  Observed the real stale-event rejection and no automatic retry. Closed the actual tab
  during the admitted delayed child. Independent CLI status still showed running; later
  CLI status showed completed. Reopened Chromium: **2/2**, all three reports retained.
- Refreshed completed history: **44 unique, strictly increasing run-filtered event IDs**,
  unchanged after another refresh; exclusive cursor 45. Global ID 3 belonged to the other
  run and was correctly absent.
- Started a graph-only fake agent with a `sleep` descendant. No percentage appeared.
  Stop now with a reason returned stopped, disabled resume and removed the descendant's
  `/proc` entry. Durable reopen found neither run had an active attempt.
- Inspected desktop and 390px mobile screenshots; mobile document width equaled viewport,
  and event content stayed in a bounded scrolling region. Reload preserved both runs and
  their durable states, without automatically selecting/starting one. No uncaught page
  JavaScript errors were observed during the successful interactions.
- Explicit daemon shutdown exited **0**. Subsequent refresh showed the useful transport
  warning, disabled start/resume and left explicit refresh available. Connection to port
  36097 was refused and discovery was absent. Closed managed tabs; none remained.
- A throwaway Node SQLite reopen verified completed **2/2**, exact report outcomes
  `[complete, blocked, complete]`, three `ack 0` entries, stopped second run, no active
  attempts and preserved control history. Removed the throwaway scripts and all owned
  fixture state; root absence verified. No unrelated/uncertain artifacts were touched.

Limitations are deliberate: polling rather than SSE; at most 300 recently fetched event
rows in the dashboard; CLI recovery only; no raw log viewer, paused-run workflow editor,
manual intervention controls or permanent browser automation suite. Existing same-user
authority and external-side-effect/process-escape limitations remain unchanged.

## Phase 8.4 — paused-run revisions and explicit manual intervention

Authorized offline implementation, actual Chromium with disposable fake adapters, and
commit/push, based on accepted `22378e3`. Only Phase 8.4 is completed here. Phase 8.5,
the full Phase 8 gate and Phase 9/MVP remain incomplete. No live/paid provider or global
harness configuration was used or changed.

### Implementation

- The browser's strict allowlist adds read-only `run-edit`, run-bound canonical `draft`
  validation, and reasoned `revise`/`override`. Existing edit schemas are reused; revision
  text/reason remain bounded. Run inspection includes exact current YAML/source directory,
  run/revision/event identity, task summaries, compatible stages and effective declared routes.
- Browser admission requires paused state, exact inspected event, no active attempt and no
  global unresolved-process barrier. Mutations then delegate to management/coordinator;
  no new state owner, cursor write, recovery route, generic RPC or engine action is added.
  Host/Origin/cookie/header/JSON/body/CSP/inert-text boundaries are unchanged.
- `WorkflowEditor` is reused in run mode, including canonical model serialization, visual
  fields, compiler/router diagnostics and exact-text response guards. Run validation omits
  the consumed checklist, never reimports tasks, and uses the original source directory.
  Management retains root/task-source restrictions, unfinished task specialization validation,
  cursor compatibility, frozen inputs/history and revision-scoped session rules.
- `RunIntervention` pins draft/decision identity separately from dashboard selection.
  Polling/lifecycle/selection cannot retarget or replace text. Run mode disables reusable
  save/create/preview; replacing the draft requires explicit discard. Failed mutation
  submissions disable reuse until fresh explicit inspection. Refresh edit authorization
  retains text only for the same run/revision; a changed revision requires discard/reopen.
- Manual jump, declared-outcome skip and selected unfinished-task completion show target
  and consequences before submission, require reason and confirmation, and retain durable
  audit events. Skip does not complete tasks or fabricate reports; completion may leave an
  incompatible cursor requiring a jump. Revision/override never resume automatically.
  Warnings explicitly distinguish workflow-state changes from repository repair/reset/rollback
  and call out repeated external side effects. Stop now remains the ending control.

### Offline acceptance

The focused browser integration run passed **17 tests / 1 suite**. Five added behavior cases
cover consumed-checklist revision and separate new-revision execution, immutable history/
task progress/frozen settings, atomic invalid YAML/cursor/pending-settings rejection,
compatible cursor replacement, audited jump/skip/manual completion without fabricated
execution, stale/ready/active/pausing/interrupted barriers, original-directory retention,
strict fields/reasons and cross-authority/Origin/header rejection. The initial lint run
caught one non-null assertion in new coverage; replaced it with an explicit existence guard.

Executed:

```bash
npm run check
npm run smoke:recovery
npm run smoke:reporting
npm run smoke:boundaries
npm run validate -- examples/overnight.yaml
```

Full gate: **800 tests / 88 suites**, zero failures/cancellations/skips; typecheck and
Biome lint passed. Recovery passed command/correction/between-step/spawn-intent crash
dispositions without replay, durable reopen and owned cleanup. Reporting passed actual
acknowledgment before settlement and bounded correction success/failure with reopen.
Boundary smoke passed synthetic OpenCode/Claude correction/provider-failure, selected
environment, scrubbed diagnostics/logs and sequential settlement/reopen.
Canonical example: **valid, 8 steps, zero warnings**, hash prefix `8a4912284968`.

### Actual Chromium and durable evidence

One owned daemon under `/tmp/wf-revision-84-a4v1Wp`, using only `ScriptedAgentAdapter`
and actual `wf report`; no permanent browser suite was added:

- Started a two-task loop, observed first task complete and second report blocked at **1/2**.
  Removed the consumed checklist. Edit opened exact revision 1/source directory/current
  cursor/task; validation succeeded without that file and reusable Save stayed disabled.
  HTML-like task text stayed inert, with zero injected image nodes.
- Malformed YAML retained text and located diagnostics and disabled Apply. Blank reason/
  missing confirmation was rejected locally. Renamed current stage without a replacement:
  server rejected it without changing run or event 32. Explicit `pick` cursor also failed
  the active-task compatibility check. Each failure retained the entire draft and disabled
  resubmission until explicit inspection/authorization.
- Explicit compatible `repair` cursor applied immutable revision **4**, leaving paused
  at **1/2**, with both prior reports intact. Run selection to a different ready run left
  the draft and target unchanged and Apply disabled. Attempting to load a reusable workflow
  while the run draft was open gave an explicit-discard error without changing text.
- Reopened revision 4 and delayed a real draft request by 800ms. Newer text entered during
  that request remained exact and unvalidated after the delayed response; subsequent explicit
  validation succeeded. Separate Resume used `offline-revised` and retained unsaved draft
  text through lifecycle change. Stale event 32 and active-run overrides returned 409.
- Reloaded during the delayed fake child: independent browser API still showed running and
  selection reset. Closed the tab; the CLI still showed running. Reopening later showed
  completed **2/2**. Browser lifetime did not own execution.
- A second blocked run exercised deliberate compatible jump, declared `complete` skip and
  selected active-task completion. Skip moved to `finish` while progress stayed **0/2**
  and exactly one real report remained. Manual completion yielded **1/2**, cleared active
  task and left cursor `finish`, still paused. Durable audit rows preserved exact reasons.
  A subsequent compatible jump selected `pick` without execution.
- A separate operator changed that cursor after inspection. The actual old Apply button
  received stale-control rejection, showed no-auto-retry/fresh-inspection guidance and stayed
  disabled with its selected target retained. Fresh inspection recovered the dashboard.
- The same run editor's visual agent model field serialized an unsaved run draft while
  reusable Save remained disabled. Stop now ended this run; unsaved model text remained
  and revision Apply was disabled rather than overwritten or rebound.
- A fixture representing reconciled between-step interruption rejected run-edit/revise/
  override/resume with 409; edit/intervention buttons were disabled. Recovery remained CLI-only.
  Offline integration additionally exercises the real report-then-delay pausing boundary.
- Inspected desktop and 390px mobile screenshots for both revision and manual intervention.
  Document width equaled the mobile viewport (390px); warnings, target, confirmation and
  action buttons remained usable. No uncaught page JavaScript errors were observed.
- Fixture daemon exited **0**. Read-only SQLite reopen verified primary attempt revisions
  `[1,1,4]`, frozen models `[offline-original,offline-original,offline-revised]`, revised
  prompt, report outcomes `[complete,blocked,complete]`, preserved stable task IDs complete
  **2/2**, exactly one `workflow_revised`, and five reasoned manual audit rows. Second run
  was stopped at **1/2**; interruption fixture stayed interrupted. Four real reports had
  `ack 0`, no active attempts remained, and every owned child PID was gone.
- Listener 42661 refused connections and discovery was absent. Closed managed tabs (none
  remained), removed the throwaway startup script and owned fixture root, and verified
  absence. The throwaway durable verifier ran in memory, leaving no script.

Limitations: polling/recent-event display remain as before; unsaved drafts reset on reload;
visual serialization can normalize YAML; per-task parameter editing and recovery remain
headless/CLI-only; no raw logs, arbitrary filesystem browsing, rollback or isolation.
Phase 8.5's permanent browser smoke suite, the full Phase 8 gate and MVP remain incomplete.

## Phase 8.5 — permanent offline Chromium smoke coverage

Started from clean `main` at accepted/pushed
`e18c8fdec8fb3be12943c9859a432ae89285d336`. Current authorization covers offline
implementation, disposable fake adapters, pinned local browser tooling, actual Chromium,
documentation and commit/push. No live/paid providers, global harness configuration changes
or Phase 9 implementation.

### Implementation and preserved boundaries

- Added exact `@playwright/test` **1.64.1** and lockfile entries. `npm run test:browser`
  builds the real application and runs three sequential scenarios with no test retries.
  Provisioning is explicit; test execution never installs dependencies or browsers.
  README documents installation, Linux libraries/fonts, supported-platform references,
  headless/headed use and the separate browser-independent core gate.
- `test/browser/daemon.mjs` starts the existing foreground owner in a separate OS process.
  Every registered harness has an explicitly injected fake adapter; exhausted/unexpected
  plans fail rather than falling through to ScriptedAgentAdapter defaults or real factories.
  Each test owns a new temporary project, state directory and ordinary browser pairing.
- Small shared fixtures use real supervised fake children and actual `wf report`.
  The only adapter-fixture extension is `report-wait-for-file`: report, wait for an owned
  filesystem gate, then settle. No production fake-provider option, fixture endpoint,
  schema/migration, management forwarding or new authority was introduced.
- Browser requests stay loopback-only, service workers are blocked, contexts/profiles are
  disposable and all pages are checked for uncaught application JavaScript errors.
  No trace, video, profile, pairing code or credential artifact is retained. Mutation
  requests are the actual UI's inspected-event requests; interception only delays their
  delivery, never substitutes success responses or changes authority.
- Existing Host/Origin/cookie/custom-header/JSON/body/CSP boundaries, inert rendering,
  single state owner, process settlement/recovery barriers, immutable revisions/inputs,
  task progress, session restrictions and separate Resume are unchanged.

### Permanent browser scenarios

1. **Complete Phase 8 visual gate.** Starting with **New workflow**, configure task import,
   `task.next`, two executable agent stages (`codex` implement and `pi` review),
   `task.complete`, end and direct routes using visual controls only. Inspect effective
   routing; preview/save create no run. Creation is ready with no start time, attempt or
   report. Explicit Start reaches blocked attention and paused state. Open the current
   revision, change model/prompt visually, require reason/confirmation, apply without
   resuming, then use separate explicit Resume. Both imported tasks complete. Durable
   reopen verifies five attempts, the original frozen model plus new-revision inputs,
   all subsequent attempt revision associations, unchanged task IDs and all five reports
   (`blocked`, then four `complete`), including the original blocked report.
2. **Mobile deliberate intervention and stale/draft state.** At 390px, select compatible
   jump; explicitly choose a declared skip outcome; skip both review and `task.complete`
   without fabricating reports or accepting tasks; complete only the selected other
   unfinished task. Reasons/confirmation, targets/consequences and paused-after-action
   behavior are exercised through UI controls. Five durable reasoned manual audits include
   a concurrent operator's decision; the old browser decision receives real **409 stale**
   rejection exactly once, stays disabled, and recovers only after explicit Refresh run
   and Inspect manual intervention. A held real validation response, a newer unsaved
   draft, actual event polling and selection of a different ready run cannot overwrite or
   rebind the draft/target. HTML-like task text remains inert. Durable events/tasks/reports
   and the alternate ready run are checked after owner exit.
3. **Browser lifetime independence.** Wait for a real accepted report while a supervised
   file-gated operation is still running with a live PID. Reload: dashboard selection
   resets but the same attempt/PID remains running. Close the sole tab and verify no
   browser page exists; independent management inspection still sees the same live
   operation. Release the gate with no browser page open and observe durable completion.
   Reconnect at 390px to the completed result. SQLite reopen proves exactly one attempt,
   launch event, accepted report and attempt transition, with no duplicate/replay.

Initial runs exposed only smoke-selector/assertion mistakes: an exact implicit-select label
included option text, and Playwright's disabled assertion on a fieldset did not assert the
effective disabled state of its controls. Corrected locators and asserted the actual authoring
input. No application behavior fix or boundary weakening was necessary.

### Exercised commands and results

Node.js **v26.8.2**, npm **11.19.1**, Playwright **1.64.1**, pinned full Chromium
**156.0.8078.4**, revision **1248** (`chromium` channel).

```bash
npm install --save-dev --save-exact @playwright/test@1.64.1
./node_modules/.bin/playwright install chromium
npm run test:browser
npm run test:browser
npm run check
npm run smoke:recovery
npm run smoke:reporting
npm run smoke:boundaries
npm run validate -- examples/overnight.yaml
```

- Permanent browser suite: **3/3 passed**, then **3/3 passed again** from fresh state
  (16.4s and 16.3s). Each run used three new daemons and new browser contexts, with seven
  supervised fake children total. No retries, prior profile or retained database.
- `npm run check`: typecheck and lint passed; **800 tests / 88 suites**, zero failures,
  cancellations, skips or TODOs. Existing informational lint suggestions remain unchanged.
- Recovery smoke passed command/correction/between-step/spawn-intent crash dispositions,
  no replay, explicit decisions, durable reopen and owned cleanup.
- Reporting smoke passed report-before-settlement, bounded same-session correction success
  and failure, durable reopen and removal of disposable databases/logs/sessions.
- Boundary smoke passed synthetic OpenCode/Claude correction/provider-failure scenarios,
  selected environments, scrubbed diagnostics/logs, sequential settlement and SQLite reopen.
- Canonical example: **valid, 8 steps, zero warnings**, hash prefix `8a4912284968`.

### Failure cleanup and actual visual evidence

A throwaway browser scenario deliberately threw an assertion error while a real accepted-report
child remained file-gated and active. Its command intentionally exited **1** for that assertion;
fixture teardown still stopped/reaped the child, reopened durable state, observed owner exit
**0**, refused the old listener, verified discovery absence and removed its owned root.
Removed the throwaway scenario before the second complete permanent run.

All permanent runs likewise verified owner exit **0**, all seven known supervised groups gone,
listener/discovery absence, exact durable state/audits, and owned root removal. The runner removes
its owned output directory on both success and failure. Unproven cleanup preserves the fixture
root and fails rather than deleting uncertain evidence.

Additionally inspected actual desktop dashboard and 390px paused-revision/manual-intervention
screenshots against a separate owned fake-only foreground daemon. Target/consequence text,
warnings, confirmation and action controls remained usable without page overflow. A browser-tool
wait invocation initially injected an invalid-selector error; after clearing that tool error and
reloading, fresh application inspection had **zero page errors**. Permanent browser tests also
passed their uncaught-error checks. This extra fixture was explicitly stopped: owner exit **0**,
fake PID gone, read-only SQLite retained stopped state plus blocked report with no active
attempt, listener/discovery gone, managed tabs empty, owned root and screenshot artifacts removed.

### Acceptance and concrete limits

**8.5 complete. Full Phase 8 gate satisfied** by the complete visual-authoring → blocked
attention → visual revision → separate explicit Resume scenario, not merely backend API setup.
Phase 9 and MVP remain explicitly incomplete.

Coverage is deliberately three Chromium scenarios with desktop/390px surfaces, not exhaustive
cross-browser, accessibility, physical-mobile or all Phase 9 end-to-end coverage. This Linux
distribution is not officially supported by Playwright; its Ubuntu 24.04 fallback Chromium
passed with the host's existing shared libraries. No OS package installation was needed or
performed. Browser provisioning requires a separate download; suite execution itself stays
offline. SIGKILL/power-loss of the test runner is not a graceful-teardown guarantee. Existing
same-user authority, escaped-process and external-side-effect limits remain unchanged.

## Phase 9.1 — offline end-to-end acceptance audit

Started from clean `main`, synchronized with `origin/main`, at accepted Phase 8.5
`3ef877b4d16a922c5b5d982a9dd2ebdbd7e47e85`. Authorization is offline acceptance,
bounded gap closure, documentation and commit/push only. Phases 9.2–9.5 and the
final MVP gate remain separate. No live providers or global configuration changes.

### Evidence map (recorded before gap closure)

Paths below are repository-relative. **C** = `npm run check` (includes every named
`src/` test); **B** = `npm run test:browser`; **R** = `npm run smoke:recovery`;
**P** = `npm run smoke:reporting`; **T** = `npm run smoke:tasks`.
Integration evidence below uses actual SQLite/service boundaries and supervised
fake children/`wf report`, not just reducer assertions. “Existing” describes source
assertions inspected before this milestone's execution; results are recorded below.

| §9 / boundary | Exact executable evidence and exercised behavior | Kind / command | Audit gap / disposition |
| --- | --- | --- | --- |
| 1 Happy path / progress | `src/runner/run-service.test.ts` — “follows deterministic branches through agent and command steps, one attempt at a time”: two task IDs, real command success/failure/repair, exact transitions, explicit completion and end. `scripts/smoke-tasks.mjs`: imported queue completed, Markdown unchanged. `test/browser/gate.spec.mjs` — “visual two-stage workflow: ready, blocked attention, revise, explicit resume”: stable task IDs complete after explicit resume. | Integration C; real-process T; browser B | Existing sufficient; report-before-settlement progress is additionally covered by browser API tests below. |
| 2 Custom debugging branch | `src/engine/compile.test.ts` — “compiles with no diagnostics and resolves every outcome exactly” checks `needs_debugging` routing, but does not execute the custom branch. Existing headless branch is command failure, not agent debugging. | Compiler unit C | Missing integrated custom report → debugger → requested stage. Add one bounded management scenario, shared with row 11. |
| 3 Undeclared → valid in-turn | `src/test-support/adapter-conformance.ts` — “rejects undeclared reports synchronously and accepts an in-turn correction”: actual CLI rejection/acceptance, one report, zero correction turns, all six adapters including scripted. `src/runner/report-server.test.ts` — “rejects malformed/invalid bodies, authority fields, origins and tokens without any mutation” compares full state; “real wf client waits for acknowledgment and submits handoff content and JSON” submits invalid then valid. | Real-process integration C | Add full-state equality at the existing real CLI rejection boundary; no duplicate scenario needed. |
| 4 Exactly one correction | Conformance — “resumes the persisted session once after clean execution, without overlap”; “pauses after one failed correction (silent/report/crash/hang), with no third invocation”: exact session, ordering, one logical attempt, success or default `system.report_error` pause. `scripts/smoke-reporting.mjs`: accepted/correction-success/correction-failure with reopen. | Integration C; real-process P | Existing sufficient. Invalid report, technical correction failure and unavailable resume are distinct covered cases. |
| 5 Provider unavailable | Conformance — “routes provider failure without correction even with a clean process status” and “routes a missing executable as spawn failure without correction”: normalized process/spawn outcome, zero corrections. `src/runner/run-service.test.ts` — “routes a synchronous adapter launch exception instead of stranding the attempt”: configured system route reaches end. Boundary smoke separately exercises synthetic provider failure through real adapters. | Real-process integration C; `npm run smoke:boundaries` | Existing sufficient; synthetic outages only, no paid call. |
| 6 Command failure | Headless test in row 1 asserts exact `check/failed → fix → check/complete` transitions and real marker/output effects. | Real-process integration C | Existing sufficient; verification stage exists only because this fixture authors it. |
| 7 Session / selected context | `src/runner/context.test.ts` — “assembles ordered instruction content, full task context and only selected same-task reports”: review receives current body/instructions and only `work`, excludes private/previous-task history, frozen input survives reopen. `src/runner/run-service.test.ts` — “a resume step uses the prior persisted session of the same harness”; “routes a lost persisted resume session explicitly instead of launching fresh”. Revision scope in row 10. | Real-process integration C | Existing sufficient; selected context and exact resume have separate focused proofs. |
| 8 Committed persistence | `src/app/management.test.ts` — “honors graceful daemon shutdown as pause-after-current and restart never auto-drives”; “reopens a SIGKILL between committed steps and continues only after disposition plus resume”: persisted cursor/history unchanged, next effect once, old stage not repeated. Recovery smoke `between` repeats the actual crash boundary. | Foreground-daemon/CLI integration C; real-process R | Existing sufficient. Graceful restart and crash between transactions are distinguished. |
| 9 Agent / command uncertainty | Management — “recovers a killed command daemon, escalates owned descendant cleanup and admits only one explicit retry”; “never replays an agent or routes its interrupted report after daemon SIGKILL at before-report/correction-hang”; “rejects competing owners; crash/reopen preserves accepted report, blocks replay and exposes exact recovery decisions”. Recovery smoke includes command/correction/unknown correction intent. | Foreground-daemon/CLI integration C; real-process R | Existing sufficient: live tree blocks execution, retained report cannot route, cleanup/decision/resume separate. |
| 10 Paused edits / history | Management — “supports paused revision, cursor/skip/task overrides and reasoned task completion”; “preserves paused revisions, task progress and frozen settings across restarts without crossing session scope”. Browser gate plus `test/browser/intervention.spec.mjs` — “mobile manual decisions stay paused, audit durably, reject a real stale submission and pin drafts”: explicit selection/revision/resume, old reports/inputs/revisions retained. | Foreground-daemon/CLI integration C; browser B | Existing sufficient; CLI sequence and browser historical integrity complement each other. |
| 11 Policy precedence / ambiguity | `src/engine/routing.test.ts` — “prefers the step's own transition over every policy and default”; “prefers a tag policy over an all-steps policy”; `src/engine/compile.test.ts` — “conflicting-policies.yaml fails with conflicting_policy”. | Compiler/router unit C | Add integrated tagged routes across steps, direct override and CLI rejection of ambiguous creation in the single row-2 scenario. |
| 12 No tasks | Reporting smoke's standalone agent → `touch` command → end; browser lifetime's graph-only display and completed run. | Real-process P; browser B | Existing sufficient; no artificial task queue or percentage. |
| 13 Browser disconnect | `test/browser/lifetime.spec.mjs` — “reload and last-tab closure do not stop or replay an active fake operation”: file-gated live PID/attempt survives reload and zero tabs, completes without browser, reconnect inspects same result; durable one attempt/report/transition. | Actual Chromium B | Existing sufficient; reuse permanent suite unchanged. |
| Pause / stop / resume (todo 9.1) | Management — “controls a driven command from other CLI processes, rejects stale/wrong-state controls and reuses service after stop”: pausing waits at release gate, preserves routed cursor, explicit resume; stop then another drive. `src/runner/run-service.test.ts` — “stop-now terminates the agent's whole process tree and records the stop”; “stop-now also ends a running command”. `src/app/browser.test.ts` covers report-before-settlement counts and browser controls. | Real-process/CLI/browser-API integration C; browser B for explicit resume | Existing sufficient; stopped attempt has no success transition; owned descendant absence and sequential admission are asserted. |

### Bounded gap closure

- Added exactly one application-level scenario in `src/app/management.test.ts`:
  **“executes a custom debugging return with tagged routing, direct precedence and
  ambiguous creation rejection”**. The existing test-only daemon plan runs actual
  supervised children and `wf report`: `implement/needs_debugging → debug/repaired
  → implement/complete → review/complete → done`. The tag rule routes debugging
  and inherited review completion; the implementation's direct rule beats the
  shared completion policy. Conflicting equal-tag policies reject `run create`
  through the real CLI before creating any run. Exact attempts, outcomes,
  transitions, four successful CLI acknowledgments and zero corrections are checked.
  All owned groups must be gone before shutdown. Owner exit 0, refused old listener,
  discovery absence and full historical equality after read-only SQLite reopen
  are asserted before the fixture removes its root.
- Strengthened `src/runner/report-server.test.ts`'s existing **“real wf client
  waits for acknowledgment and submits handoff content and JSON”** with full-state
  equality immediately after rejected `wf report unknown`, before the valid report.
  This covers unchanged cursor/attempt/events rather than inferring it from no report.
- No production defect was exposed or behavior changed. No adapter API, workflow
  field, migration, production fake switch, browser framework or quality gate was added.
  Existing browser scenarios are reused unchanged.
- The precise supplementary browser-API case in the pause/stop/resume row is
  `src/app/browser.test.ts` — **“controls the owner with stale checks, waits for
  settlement and counts only accepted task completion”**. This is HTTP/application
  integration, not an actual-browser claim.

Focused application execution:

```bash
npm run build
node --test --test-name-pattern 'custom debugging return|real wf client waits' \
  dist/app/management.test.js dist/runner/report-server.test.js
```

**2 tests / 2 suites passed**, zero failures/cancellations/skips. The new foreground
daemon/CLI path and strengthened report boundary both passed on first execution.

### Exercised acceptance and cleanup

Node.js **v26.8.2**, npm **11.19.1**, Playwright **1.64.1**, provisioned full
Chromium **156.0.8078.4**, revision **1248**. No provisioning command, package/browser
download or live provider was run. The following commands ran sequentially and
all exited successfully:

| Command | Observed result |
| --- | --- |
| `npm run test:browser` | **3/3 passed**, 16.3s, one worker, no retries. All three original permanent scenarios reused unchanged. |
| `npm run check` | Typecheck and lint passed; **801 tests / 88 suites passed**, zero failures/cancellations/skips/TODOs. Existing informational lint suggestions only. Includes every C row above and the new integrated debugging/policy scenario. |
| `npm run smoke:recovery` | Command retry, correction skip, committed-cursor continue and unknown correction-intent end passed: actual owner SIGKILL, no automatic replay, explicit process decisions and durable reopen. |
| `npm run smoke:reporting` | Accepted report observed before settlement with unchanged cursor; direct completion with zero corrections; successful correction completed with exactly one; failed correction paused with exactly one and `system.report_error`. SQLite reopen passed. |
| `npm run smoke:tasks` | 3 total / 1 prechecked / 2 runnable; both imported tasks completed in order via real reporting, source Markdown unchanged and task input persisted. |
| `npm run smoke:capabilities` | Required-feature incompatibility and model-selection rejection launched zero invocations; supported fresh reporting launched one; unavailable correction and explicit resume each retained one prior invocation, with no correction/fresh fallback. Durable outcomes checked. |
| `npm run smoke:boundaries` | Synthetic OpenCode/Claude correction and provider-failure paths passed: selected environments, scrubbed logs/diagnostics, sequential settlement, durable reopen; provider failure had zero correction. |
| `npm run validate -- examples/overnight.yaml` | **Valid, 8 steps, zero warnings**, unchanged hash prefix `8a4912284968`. |

All **13 §9 scenarios plus pause/stop/resume** now have exercised sufficient
evidence. Rows 2/11 use the newly named management scenario; row 3 uses the
strengthened existing CLI case. The other rows reuse existing assertions, not a
new duplicate integration/browser suite. No unresolved acceptance blocker or
production defect was found.

Cleanup evidence:

- Browser output explicitly confirmed durable reopen, **5 + 1 + 1 owned children
  gone**, each foreground owner exit **0**, listener/discovery absence and owned
  root removal. Disposable Playwright contexts/browser instances exited with the
  suite; no screenshots, traces, profiles or videos were retained.
- New debugging scenario independently required all four recorded groups gone,
  daemon exit **0**, actual `ECONNREFUSED` from its old listener, removed discovery
  and unchanged complete run/attempt/input/transition/event history on read-only
  reopen after owner exit. Management fixture removal asserted root absence.
- Recovery smoke explicitly cleaned owned processes/sessions/leases/databases
  after each durable reopen; reporting/tasks smokes removed their disposable
  projects, sessions, logs and databases. Capability/boundary fixtures closed
  databases and removed their owned roots after checking durable results.
- Independent post-run glob checks found no `.tmp-management-*`,
  `.tmp-recovery-smoke-*` or `.tmp-recovery-*` roots in the repository, and no
  `/tmp/workflowz-chromium-*`, `wf-browser-output-*`, `wf-report-smoke-*`,
  `wf-tasks-smoke-*`, `wf-capability-smoke-*` or `wf-boundary-smoke-*` roots.
  A post-run `pgrep -af` for management/recovery/fake-agent/browser-daemon and
  foreground `bin/wf ... daemon start` fixtures returned no matches (exit 1).
  No unrelated processes were signalled or historical/uncertain artifacts deleted.
- No throwaway script was needed. Existing Phase 8.5 failure-teardown evidence
  remains applicable to the unchanged browser fixture; no new intentional failure
  was injected or claimed in this pass.

**Phase 9.1 complete.** Only its checkbox is closed. Phases **9.2–9.5** and the
**final MVP gate remain incomplete**. README/spec/architecture and the canonical
example intentionally remain unchanged: no product contract changed.

Limits: fake providers prove deterministic offline behavior, not current live
authentication, provider availability or paid-account compatibility. Chromium
desktop/390px coverage is not cross-browser/physical-mobile/accessibility proof.
SIGKILL cases do not simulate every power-loss/storage fault. Existing Linux
`/proc`/local SQLite requirements, non-atomic identity checks/signalling,
escaped-descendant limits, operator-asserted cleanup trust and absence of rollback
or exactly-once external effects remain unchanged.

## Phase 9.2 — focused sample workflows

Started from clean `main` at `1dbc6cc`, tracking `origin/main`. This pass is
offline 9.2 then 9.3 with separate milestone commits and standing push permission;
no live providers, credentials, downloads or global configuration changes.

Added exactly five YAML samples; the canonical overnight file is unchanged:

| Sample | Steps | Task source / authored behavior |
| --- | --- | --- |
| `minimal-single-step.yaml` | 2 | No tasks; one agent report then end |
| `task-loop.yaml` | 4 | Two-item `sample-tasks.md`; explicit next/implement/complete loop |
| `implement-review-commit.yaml` | 7 | Same checklist; review revise loop and explicit Git staging/commit |
| `human-checkpoint.yaml` | 2 | No tasks; pause transition, explicit operator inspection/jump/revision/resume |
| `command-only.yaml` | 3 | No tasks/agents; read-only Node version and Git status |
| `overnight.yaml` (retained) | 8 | Existing `tasks.md`; unchanged hash prefix `8a4912284968` |

`examples/README.md` indexes prerequisites, task sources and execution risks.
The checkpoint is not an approval kind: plain resume repeats the paused step;
jump or prompt revision is an explicit separate operator choice. Mutating samples
are documentation only: validation never executes them. README's read/example
indexes and stale authorization/status notes now describe this bounded pass.

`src/app/validate-cli.test.ts` discovers and parameterizes every `examples/*.yaml`
through the actual CLI/compiler/path checker, requiring success and zero warnings.
The original overnight eight-step assertion remains unchanged. No production
source, schema, adapter, dependency, migration or runtime behavior changed.

Executed on Node.js v26.8.2 / npm 11.19.1:

| Exact command | Result |
| --- | --- |
| `for file in examples/*.yaml; do npm run validate -- "$file" || exit; done` | Six CLI runs exit 0; every sample valid with zero warnings, counts above; overnight unchanged |
| `node --test dist/app/validate-cli.test.js` | 10 tests / 1 suite pass, zero failures/cancellations/skips |
| `npm run check` | Typecheck/lint pass; 807 tests / 88 suites pass, zero failures/cancellations/skips/TODOs; existing informational lint suggestions only |

**9.2 complete.** Only 9.2 is newly checked here. 9.3 remains next; 9.4–9.5
and the final MVP gate remain open. No provider-backed verification is claimed.

## Phase 9.3 — operational and failure audit

Started after 9.2 was committed/pushed as `9482d70`. Offline only; no production
changes are planned. The pre-edit audit below maps every requested boundary to
existing evidence and identifies only focused coverage/documentation gaps.
`C` means `npm run check`; paths and named cases are executable source evidence.
Final exercised results are recorded after gap closure below.

| Required boundary | Existing test / documentation evidence | Pre-edit gap / disposition |
| --- | --- | --- |
| Validate diagnostics and exit codes | `src/app/validate-cli.test.ts`: located duplicate-key diagnostic/exit 1, unreadable file/exit 2, missing root/exit 1, valid examples/exit 0 | Sufficient; retain overnight assertion |
| Management diagnostics / exit codes, daemon unavailable, blank/unsafe state directory | `src/app/management.test.ts`: immutable import/preview case checks unreadable/invalid input, stale/wrong-state controls; README management exit 0/1/2 contract | Add direct process-boundary unavailable/no-auto-start, malformed command and blank/unsafe directory assertions |
| Invalid report rejection | `src/runner/report-server.test.ts`: malformed/authority/origin/token rejection with unchanged full state; real `wf` undeclared/409/410 errors | Sufficient; no duplicate 9.1 scenario |
| Unknown harness, capability errors, unavailable resume | `src/engine/compile.test.ts`: unknown-harness fixture and unsupported capabilities; `src/adapters/capabilities.test.ts`: required launch/model/reasoning/exact-resume rejection with zero extra launches and useful durable explanation; `src/runner/run-service.test.ts`: unavailable/lost session no fresh fallback | Sufficient; fake/offline only |
| Attempt log paths, bounded logs/captures/diagnostics | `src/test-support/adapter-conformance.ts`: separate original/correction paths; `src/adapters/process.test.ts`: log cap head/marker, stdout/stderr cap, byte-bounded Unicode diagnostic; architecture §4.7: 16 MiB log + marker / 64 KiB captures / 4 KiB diagnostics | Add direct daemon layout/log-file assertions; reuse supervisor cap tests |
| Known-secret scrubbing; no report tokens/credentials in diagnostic/durable state | `src/adapters/boundaries.test.ts`: all five adapters × report/provider-error/crash check scrubbed state/logs and diagnostic bounds; `src/adapters/secrets.test.ts`: representations across every byte boundary; report server rejects protected credentials; management case checks no token output | Sufficient; only known injected secrets/representations, not arbitrary harness-owned files |
| Report HTTP 128 KiB, handoff 64 KiB, summary/issue 4 KiB, data 32 KiB, oversized 413 | `src/contracts/report.test.ts`: UTF-8/field/data/depth/node rejection; report-server invalid body case sends 131073 bytes → 413 | Add one real HTTP exact-limit acceptance and CLI handoff boundary coverage; retain over-limit rejection |
| Bounded acknowledgment reads | `src/app/report-cli.ts`: bounded response reader; existing real CLI test only checks ordinary acknowledgments | Add real CLI oversized acknowledgment rejection with synthetic server |
| Strict API request schemas | Management authority case rejects extras/malformed JSON; management contracts reject authority extras/cursors/reasons/unknown recovery; browser selected-input case rejects extras/nonallowlisted operations and malformed JSON | Sufficient |
| Host / Origin / cookie / custom-header; separate bearer authority | `src/app/browser.test.ts`: exact Host/Origin/JSON/header and separate bearer/cookie authority, one-use/rotation/expiry/logout and in-flight revocation; management/report servers reject browser Origin and wrong tokens | Sufficient; Host/cookie/custom-header are browser rules, not new management/report requirements |
| Management/browser 2 MiB body limits | Management authority case sends 2097153 bytes → 413; browser malformed/oversized case exceeds 2 MiB → 413 | Sufficient |
| State directory precedence / ownership / permissions / symlinks | Management state-selection case checks explicit > environment > XDG, blank explicit; authority case checks 0700/0600 and unsafe/symlink discovery rejection | Add current-user ownership, canonical directory alias/unsafe target, blank environment, home fallback coverage without changing permissions globally |
| O_NOFOLLOW discovery, 0600, 4096-byte cap | Management authority case rejects symlink and 0644 discovery; `src/app/state-directory.ts` checks opened descriptor ownership/type/size | Add exact 4096/4097 and ownership/type/schema cases; retain real symlink rejection |
| Logs/WAL/lease layout; no stale discovery takeover | README management section; competing-owner case rejects lease competition and preserves original discovery | Add direct layout and stale-discovery/lease-authority evidence if not already asserted |
| Foreground explicit start, no auto-start/detach | README management start command and foreground lifetime; CLI source awaits owner close | Add unavailable-client leaves no state/listener discovery; existing daemon child remains live until explicit shutdown |
| SIGINT/SIGTERM/daemon stop pause-after-current/drain; acknowledgment vs exit | Management graceful SIGTERM and API-stop-held-step cases; management-service shutdown admission case | Parameterize signal case for SIGINT too; strengthen clean exit/listener/discovery assertions |
| Restart reconciliation without automatic driving | Existing management graceful/crash/committed-cursor cases and runner recovery suites; README recovery/startup paragraphs | Sufficient; no replay/automatic signals; explicit disposition/resume retained |
| Client/browser disconnect independence | Management start returns while held child still runs; permanent `test/browser/lifetime.spec.mjs` actual reload/last-tab closure evidence accepted in 9.1; README management/browser sections | Reuse accepted 9.1 browser evidence; no browser code changed |

### Focused gap closure

- Added `src/app/state-directory.test.ts`: six cases for blank environment/home
  fallback, newly created 0700/current-user directory, canonical directory alias
  and unsafe target, foreign directory/discovery ownership, exact 4096 versus
  4097 discovery bytes, non-file/invalid-schema discovery, real CLI unavailable
  without auto-creation/start, and distinct blank/unsafe startup versus malformed
  CLI failures. Ownership rejection uses real filesystem metadata with a mocked
  caller UID; it does not chown files or require root. Existing real discovery
  symlink/0644 rejection tests remain unchanged.
- Added `src/app/report-cli.test.ts`: exact 65536-byte UTF-8 handoff transmission;
  65537-byte rejection before any request; oversized success/error acknowledgments
  fail nonzero without echoing synthetic authorization or untrusted response text.
  All listeners/children/files are disposable, bounded and torn down.
- Added one report-server integration boundary: exact 4096-byte summary/issue,
  65536-byte handoff and 32768-byte serialized data survive real acceptance in an
  exactly 131072-byte padded HTTP request, without a cursor transition. Existing
  oversized/undeclared/credential-bearing rejection tests are retained.
- Parameterized the existing daemon signal scenario for both SIGINT and SIGTERM:
  held owner/group remains alive with no transition until release, then clean exit,
  group absence, refused listener, removed discovery, paused committed cursor and
  unchanged history on reopen. Separate explicit resume executes the next effect
  once. Local validation works after exit; unavailable management never auto-starts.
- Extended the existing API-stop case with canonical state-directory alias and
  actual `state.sqlite`/WAL/`.runner-lock`/`logs/`/attempt-log layout assertions.
  Shutdown acknowledgment still returns while the held step drains; mutations
  reject; owner exit/discovery removal follow settlement.
- Extended the existing competing-owner case: valid-shaped stale discovery cannot
  bypass a live writer lease and is not overwritten by the rejected contender.
  Crash retains old discovery; only a successful explicit new owner replaces it.
- README already documents foreground startup, all three graceful shutdown paths,
  acknowledgment versus exit, no auto-driving/replay and disconnect independence.
  Added only previously unstated discovery limits/canonical alias behavior and
  concise log bounds/known-secret limits with links to the existing contracts.

Two independent test-only slices (report CLI bounds and daemon lifecycle) were
delegated; integration, matrix, state-directory tests, HTTP exact limits and docs
remained parent-owned. No production/app/HTTP implementation, dependency, schema,
migration or approval semantics changed. No production defect was identified.

### Exercised acceptance and cleanup

Node.js **v26.8.2**, npm **11.19.1**. Commands executed sequentially:

| Exact command | Observed result |
| --- | --- |
| `npm run check` | Typecheck/lint pass; **819 tests / 90 suites**, zero failures/cancellations/skips/TODOs. Includes every matrix C case and all new boundaries. Informational lint suggestions remain. |
| `node --test dist/app/state-directory.test.js dist/app/report-cli.test.js dist/app/validate-cli.test.js dist/app/management.test.js dist/app/browser.test.js dist/contracts/report.test.js dist/runner/report-server.test.js dist/adapters/process.test.js dist/adapters/boundaries.test.js dist/adapters/capabilities.test.js` | **182 tests / 16 suites**, zero failures/cancellations/skips/TODOs. |
| `for file in examples/*.yaml; do npm run validate -- "$file" || exit; done` | All six valid, zero warnings; step counts unchanged from 9.2; overnight **8 steps**, hash prefix `8a4912284968`. |

The first 9.3 `npm run check` stopped at Biome formatting in two newly added
management-test expressions, before tests. The targeted diagnostic command
`./node_modules/.bin/biome check src/app/state-directory.test.ts src/app/report-cli.test.ts src/app/management.test.ts src/runner/report-server.test.ts --max-diagnostics=50`
identified the two wraps. Surgical formatting correction preceded the successful
complete command sequence above; no production change or behavioral failure.

An additional in-memory subprocess smoke ran the real CLI against an owned
temporary `wf-ops-93-*` state root with only PATH inherited. Its exact command
sequence (`STATE`, `RUN_ID` and `EVENT_ID` denote values returned by this run):

```bash
bin/wf --state-dir "$STATE" --json daemon start
bin/wf --state-dir "$STATE" --json run create examples/command-only.yaml
bin/wf --state-dir "$STATE" --json run status "$RUN_ID"
bin/wf --state-dir "$STATE" --json run start "$RUN_ID" --expected-event "$EVENT_ID"
bin/wf --state-dir "$STATE" --json run status "$RUN_ID"  # bounded polling until completed
bin/wf --state-dir "$STATE" --json run tasks "$RUN_ID"
bin/wf --state-dir "$STATE" --json run reports "$RUN_ID"
bin/wf --state-dir "$STATE" --json daemon stop
```

Observed ready → explicit start → completed; exactly `node_version/succeeded` and
`git_status/succeeded`, zero tasks/reports. The first attempt log contains
`v26.8.2`. After foreground owner exit 0, read-only SQLite reopen preserved these
attempts/log paths; the old listener refused connection and discovery was absent.
The owned root was removed. No agent or mutating sample was executed.

Final cleanup: the new test fixtures close their HTTP listeners, reap bounded
children and remove owned roots. Management teardown additionally checks persisted
owned process identities before removing state. Post-run glob found no repository
`.tmp-management-*` / `.tmp-recovery-*`, or `/tmp/wf-state-audit-*`,
`wf-report-cli-*`, `wf-ops-93-*`, `wf-reports-*`, `wf-boundaries-*`,
`wf-capabilities-*`, `wf-validate-*` roots. Exact process check:

```bash
pgrep -af '[m]anagement-daemon.mjs|[f]ake-(agent|codex|pi|omp|claude|opencode).mjs|[b]in/wf.*daemon.*start'
```

No output, exit 1 (no matches). No unrelated files/processes were removed or
signalled. No throwaway script file remains; the runtime smoke lived in memory.

All matrix gaps are closed by the named additions or existing exercised evidence.
**9.3 complete.** No documented product gap or production defect was found.
Actual Chromium/disconnect proof is reused from accepted 9.1; this pass exercised
browser HTTP boundary tests, not a new Chromium run. No production/app/HTTP code
changed, so no affected browser suite was required. No dependencies/downloads,
credentials, paid/live providers or global harness/configuration changes.
Phases **9.4–9.5 and the final MVP gate remain open**.

## Phase 9.4 — task-oriented user guide

Documentation-only acceptance, starting from clean `cb604e4` (Phase 9.3). Read the
required contribution/product/architecture/roadmap/schema/compatibility/sample
references in order, then checked operator behavior against `bin/wf`,
`package.json`, `src/app/`, `src/runner/`, adapters and existing tests. Two
read-only audits independently checked recovery/control and harness contracts;
the guide and integration remained single-owner documentation work.

### Documented surface

- Added `docs/user-guide.md` as the task-oriented entry point, with a contents
  list and eleven sections: boundaries; installation; configuration/state;
  provider-free quick start; workflow/task authoring/import; foreground daemon
  and UI pairing; lifecycle/monitoring/reporting; intervention/recovery; harness
  setup; troubleshooting; shutdown/cleanup/deferred scope.
- Included a seven-topic operator path: install/configure, start daemon, launch
  UI, run/monitor workflows, import tasks, troubleshoot adapters, recover
  interruption. Exact schemas/API contracts stay in the existing references.
- Added prominent README reading/layout links and current offline 9.1–9.4
  status, retaining all existing headings and implementation/history sections.
- Corrected the pre-existing `examples/README.md` paused-browser link fragment:
  the heading's en dash is removed by Markdown heading slugging. The guide's
  task-import reference was corrected by the same local anchor check.

The guide explains separate create/start authority, fresh event cursors and no
blind mutation retry, default unrestricted permissions, explicit process
settlement, immutable task/revision history, CLI-only recovery and per-task
settings, exact recovery event/attempt/reason requests, external-cleanup
attestation consequences and a separate resume after non-ending disposition.
It does not advertise offline probes as authentication or general live support.

### Exercised verification

Node.js **v26.8.2**, npm **11.19.1**. No installation/provisioning command was run;
dependencies and compiled tooling were already present.

| Exact command / check | Observed result |
| --- | --- |
| `npm run check` | Typecheck/lint/build pass; **819 tests / 90 suites**, zero failures/cancellations/skips/TODOs; existing informational lint suggestions only |
| `for file in examples/*.yaml; do npm run validate -- "$file" || exit; done` | All six valid, zero warnings: command-only 3 steps, human-checkpoint 2, implement-review-commit 7, minimal-single-step 2, overnight 8, task-loop 4; overnight hash prefix still `8a4912284968` |
| In-memory standard-library Python Markdown check through `functions.eval` | All **12** repository Markdown files checked outside fenced code; **127** relative links resolve, zero missing paths or heading/explicit-anchor targets after the two fragment corrections; no dependencies/downloads |
| `git diff --check` | Exit 0, no whitespace errors |

The Markdown check resolves paths relative to each referring document, skips
external schemes, and compares fragments with explicit HTML IDs and
lowercase/punctuation-stripped/deduplicated heading slugs. External URLs were
not fetched; no remote-link availability claim is made.

### Provider-free quick-start proof and cleanup

An in-memory Python subprocess driver started the actual foreground CLI owner
with only `PATH` and `WF_STATE_DIR` inherited. Dedicated state:
`/tmp/opencode/wf-quickstart-65mh4904` (0700); discovery was 0600 and never printed.
The driver owned and awaited every CLI process; no throwaway script file was
created. Exact command sequence below; `RUN_ID`, `STOP_ID` and event values were
returned by this smoke, not guessed:

```bash
export WF_STATE_DIR=/tmp/opencode/wf-quickstart-65mh4904
bin/wf daemon start                 # separate owned foreground process
bin/wf daemon status
bin/wf workflow validate examples/command-only.yaml
bin/wf --json run create examples/command-only.yaml
bin/wf --json run status "$RUN_ID"
bin/wf run start "$RUN_ID" --expected-event 1
bin/wf --json run status "$RUN_ID"
bin/wf --json run events "$RUN_ID" --after 0 --limit 100
bin/wf --json run tasks "$RUN_ID"
bin/wf --json run reports "$RUN_ID"
bin/wf --json run create examples/command-only.yaml
bin/wf --json run status "$STOP_ID"
bin/wf run stop "$STOP_ID" --expected-event 16 --reason "Cancel the second ready smoke run without executing it"
bin/wf --json run status "$STOP_ID"
bin/wf daemon stop
```

The first run went ready → explicit running → completed, with **15 events** and
exactly `node_version/succeeded` and `git_status/succeeded`, both exits 0.
Tasks/reports were empty, and the first invocation log contained `v26.8.2`.
Stopping the already-completed fast sample would be invalid; the second ready
run proved reasoned cancellation without racing its execution or creating an
attempt. It reached stopped with no execution.

Owner exited **0** after shutdown admission. Each persisted invocation PID and
process group was absent, the owner PID was gone, the former loopback listener
refused connection, and `daemon.json` was absent. A `node --input-type=module -e`
read-only `node:sqlite` inspection preserved completed/stopped runs, exactly the
two successful command attempts and zero reports. Only after this proof was the
owned root removed; its absence was asserted. The user's default state was never
used. No agent sample, provider or mutating sample was executed.

### Contradictions and remaining limits

- `spec.md` §2.1 describes manual paused task re-import, but no such management
  command exists; schema decision 30 and architecture §3.2 correctly state
  re-import is unimplemented. The guide documents creating a new run for a new
  snapshot, not silently refreshing an existing run.
- `spec.md` §2.2's broad create/duplicate/delete/export workflow language exceeds
  current immutable-revision import/list/save/create controls. The guide does
  not invent mutable named-workflow CRUD.
- The architecture §1 diagram mentions SSE and §6 proposes a UI log tail;
  implemented browser/management contracts use polling/paginated events and
  expose no raw-log endpoint. The guide documents the actual surface.
- Historical implementation-time statements about pending live harness gates
  are superseded only by the compatibility note's later scoped results. The guide
  distinguishes those historical live results from fresh offline conformance.
  No provider/model/authentication claim was refreshed here.
- Illustrative design `timeout` and permissive session selectors are not accepted
  operator contracts: the guide uses `timeout_seconds`, required agent `session`,
  exact non-creating adapter resume and explicit recovery disposition before
  management resume.

These are documentation/design-scope mismatches, not a production defect found
by this pass. `spec.md` and `architecture.md` were intentionally unchanged.
Phase 9.5 may reconcile outstanding scope/deferred-feature descriptions during
its separately authorized reliability/dead-weight review; this guide does not
implement or close them.

No Chromium suite was run: browser-facing behavior did not change, and accepted
browser evidence remains historical. No harness probe or authentication command
was needed. **No production code, tests, dependencies, migrations, providers,
downloads, credentials or global harness/configuration changed.** No commit or
push was made. **Only 9.4 is newly checked; 9.5 and the final MVP gate remain open.**

## Phase 9.5 / final gate — dead weight and explicit MVP boundaries

Owner authorized committing/pushing and optional cheap live execution. The
accepted 9.4 operator-guide work was committed **first and separately** as
`8aa5f8a` (`docs: add operator guide and record Phase 9.4 evidence`).
This pass stayed offline: the requested fixtures prove deterministic control,
reporting and recovery without refreshing paid provider/authentication claims.

### Audit method, evidence and decisions

Scope: `src/` (contracts, engine, store, runner, adapters, app, web and
test-support), `scripts/`, `bin/` and `test/`, plus canonical design/operator
documents. Exact case-sensitive unfinished-marker inventory:
`grep` tool pattern `\b(TODO|FIXME|XXX|HACK)\b|unimplemented|not implemented`.
Only `src/adapters/capabilities.test.ts`'s unsupported structured-report-fallback
assertion matched; lower-case roadmap references and deferred timer variables
are not unfinished work. No hidden implementation TODO was removed by renaming.

Graph project `home-phagmaier-Code-workflowz` was ready/full/watched, generation
`2026-10-20T02:52:27Z`, later refreshed to `2026-10-20T03:01:47Z`.
`check_index_coverage` checked all four scopes and 17 exact evidence paths:
source/scripts/bin had no recorded gaps and matching metadata. The intentional
invalid fixture `test/fixtures/workflows/invalid/yaml-syntax.yaml:1–7` is unusable
to the graph; direct source read confirmed its unclosed YAML sequence.
Coverage is best effort, not proof of completeness. Generated `dist/` and
dependencies were intentionally excluded.

`search_graph(max_degree=0, exclude_entry_points=true)` was fully paged for
Function (7), Method (17), Type (2), Interface/Class (0 each), and Variable
(191, all YAML data, not source dead code). Names below omit the common graph
prefix `home-phagmaier-Code-workflowz.`. Source reads, qualified-name graph
search/`trace_path(direction: both, include_tests: true)` and TypeScript-native
LSP references distinguished callbacks/types from absent consumers. A graph
OPTIONAL-MATCH/count query returned an inconsistent empty census; it was
reported to tool QA and **not used as negative evidence**. An initial delegated
no-consumer claim for the recovery fixture was independently disproved and
withdrawn; only the corrected parent evidence is used below.

| Candidate / qualified symbol or bounded group | Reference/call evidence | Decision and safety rationale |
| --- | --- | --- |
| `src.contracts.management.DaemonAccess` (`src/contracts/management.ts`, formerly line 84) | Graph Type census: zero degree. LSP references: declaration only. Repository-wide exact identifier/qualified-name search: declaration only. Actual discovery consumer `src/app/state-directory.ts:34–46` infers the result of `daemonAccessSchema.parse`. | **Removed**, one unused exported type alias. Type-only erasure means no runtime output/behavior change; schema, inferred return, RPC, discovery validation and persistence are unchanged. No documented deferred or test consumer. |
| `src.app.daemon.finish` | LSP: declaration, Promise resolver assignment, `closing.then(finish, fail)`. | **Retained**; callback/resolver is live despite zero graph call degree. |
| `src.app.management-cli.shutdown` | LSP: declaration and SIGINT/SIGTERM registration/removal; invokes `owner.close`. | **Retained**; real CLI lifecycle callback, not dead branch. |
| `src.app.meta-smoke-cli.stop` | LSP: declaration and SIGINT/SIGTERM registration/removal; aborts smoke controller. | **Retained**; opt-in smoke cancellation, not executed against providers here. |
| `src.engine.paths.test.everything` | `paths.test.ts:104–111` passes this `StatFn` into `checkReferencedPaths`. | **Retained**; test-only filesystem seam is explicitly protected by this audit's rules. |
| `src.app.browser.test.receiving` | `browser.test.ts:190–224` assigns the Promise resolver and invokes it on HTTP continue before rotating authorization. | **Retained**; deterministic partial-request security test synchronization. |
| `src.runner.limits.test.resumeForReportCorrection` | Object implements `AgentAdapter`; LSP follows the interface to `run-service.ts:436,500–502`; test observes the remaining invocation budget. | **Retained**; interface-dispatched regression coverage, not a disconnected function. |
| `src.test-support.adapter-conformance.start` | `adapter-conformance.ts:64–82` supplies the wrapped adapter to `RunService`, records inputs then delegates launch. | **Retained**; shared adapter conformance instrumentation; one forwarding call is purposeful. |
| The 17 zero-degree constructor methods: `src.store.database.InstanceLockError`; `src.engine.run-configuration.RunConfigurationError`; `src.contracts.report.ReportRejected`; `src.app.meta-smoke.MetaCredentialError`; `src.adapters.agent-adapter.ResumeUnavailableError`; `src.contracts.parse-workflow.Locator`; `src.runner.report-server.ReportServer`; `src.store.run-store.RunStore`; `src.app.browser-service.BrowserService`; `src.app.http-body.HttpRequestError`; `src.adapters.pi-events.PiEvents`; `src.engine.interpolate.InterpolationError`; `src.adapters.output.OutputCapture`; `src.engine.run-coordinator.RunStateError`, `UnknownAttemptError`, `UndeclaredOutcomeError`; `src.adapters.probe.CapabilityProbeError` | Exact `new ClassName` source searches find callers: database lease rejection; task specialization/cursor validation; strict report rejection; credential-loader error classification; adapter resume preflight; YAML locator; `RunService` report channel; coordinator/management store; browser transport; bounded HTTP body; Pi/omp event parsing; interpolation; process output capture; coordinator state/outcome errors; installed adapter probes. Constructor entry edges are not reliably represented as method calls. | **All retained**; instances/errors are live runtime paths. No constructor/body or error message changed. |
| `src.app.management.test.Recovery` | LSP: declaration and `f.ok<Recovery>` type argument at lines 858/860. | **Retained**; test-local DTO, graph misses the type use. |
| `src.test-support.recovery.startRecoveryFixture` / `untilRecovery` | Graph gives three incoming fixture/test callers and outgoing cleanup/environment paths. LSP finds eight references for `startRecoveryFixture`; source additionally finds `scripts/smoke-recovery.mjs:9,16` importing compiled support. Both runner recovery suites consume these helpers. | **Retained**; real SIGKILL/orphan cleanup fixtures, not dead production modules. |
| Other test-support modules: `scripted-agent`, `adapter-conformance`, `paths`, `workflows`; smoke/browser wrappers | Consumers in adapter/runner/app tests, `scripts/smoke-*.mjs`, `test/browser/daemon.mjs`; browser fixture supplies all five fake registry entries. `package.json` wires build/validate/probe/smoke/browser entry scripts; `bin/wf` dispatches report versus management. | **Retained**; executable/test entry modules are not removable merely for low degree. |
| `src.app.workflow-validation.validateWorkflow` / `inspectWorkflow` | LSP gives 11 declaration/import/type/call references for `validateWorkflow`. Graph traces `inspectWorkflow` to parser/compiler/path checks, with callers `validateWorkflow` and browser draft handling. | **Retained**; thin summary wrapper shares one validation pass and preserves CLI/RPC/browser diagnostics. Not a duplicate validator or a redundant one-caller abstraction. |
| Management `shutdown` / `browser-access` dispatch throws; browser `logout` guard | `daemon.ts:94–108` intercepts management transport/lifecycle operations; browser transport intercepts logout. Strict unions still include these operations and direct service calls must not silently accept them. | **Retained**; intentional layer guards, not missing RPC implementations. |
| Management/browser schemas, `READS`, CLI option mapping and browser op branches | `contracts/management.ts`, `contracts/browser.ts`, `management-cli.ts:38–203`, `ManagementService.handle/dispatch`, `BrowserService.handle` and both transports traced together. CLI consumes/checks option leftovers; schema operations route to service or explicit transport/lifecycle branches. Browser deliberately has a narrower authority allowlist while reusing edit/workflow schemas. | **Retained**; no never-wired documented flag/RPC or duplicate authoritative contract established. Similar bounded IDs/control fields do not justify an API refactor. |
| Unsupported structured-final report fallback / `supportsStructuredFinalOutput: false` | Capability assertion plus factory snapshots and runner's acknowledged report-only path; spec §4.2 now explicitly defers fallback. | **Retained and documented deferred**; deleting the capability distinction would misrepresent supported behavior. |
| Early re-import, mutable library CRUD, SSE/log-tail, `timeout` and permissive resume prose | Actual strict schemas/dispatch, immutable task import, dashboard polling, adapter exact-session paths and recovery admission disagree with the older sketches, as recorded in 9.4. | **Removed/corrected as documentation**, not implemented by expanding behavior. Canonical spec §8 lists gaps/non-goals; architecture, schema decision 30, README and guide §11 agree. |

No other unused module/export, dead/unreachable production branch, duplicated
authority or trivial one-caller abstraction was proven removable. This is a
bounded conservative audit, not a formal dead-code proof. The compiler's
existing `noUnusedLocals`/`noUnusedParameters` and full gate supplement graph
inspection. No test-only/deferred seam, migration, report validation, recovery
rule, asserted CLI output or RPC shape changed. No new permanent test was added
for type erasure; existing behavioral suites and actual-surface smokes verify
the retained contracts instead of testing source text.

### Documentation cutover

`spec.md` §8 is the single skimmable deferred/non-goal list, linked by README,
architecture and guide §11. It covers supervisor/automatic quality/rollback,
parallel/queued/distributed scheduling, explicit foreground service lifecycle,
immutable task sources and workflow revisions, polling/local logs, CLI-only
task settings and recovery, in-tree versus dynamic adapters, nested/arbitrary
transition execution, reporting fallback, presentation/integrations and lack of
isolation. Spec §§2.1/2.2/3.2/4.2/6/7 and architecture §§1/3.2/4/6/8 now describe
the implemented surface. The one-paragraph rationale in spec §8 explains why
re-import merging, mutable library entities and another transport are not added
merely to satisfy aspirational prose. Historical phase-local live-verification
notes remain historical; later compatibility acceptance is not rerun or broadened.

### Integrated real-CLI gate and owned cleanup

An in-memory Python standard-library subprocess driver created only
`/tmp/opencode/wf-final-gate-m05xdvv4` (0700), with a private `state/` and
disposable project containing fixture `spec.md`, `AGENTS.md`, two Markdown tasks,
YAML and a file-gated command script. Child environment contained only `PATH`
and explicit `WF_STATE_DIR`; the user's default state was never selected.
The workflow uses `task.next → command → task.complete → task.next`, ending
on exhaustion. The command appends the selected task ID, then awaits an owned
release file. It uses `timeout_seconds: 60` and no agent/provider factory.

Exact CLI sequence (status condition polling repeats are collapsed; IDs and
event cursors came from inspection):

```bash
export WF_STATE_DIR=/tmp/opencode/wf-final-gate-m05xdvv4/state
# cwd: /tmp/opencode/wf-final-gate-m05xdvv4/project; bin/wf is the repository executable
bin/wf --json daemon start                         # owned foreground process 617138
bin/wf --json workflow validate workflow.yaml
bin/wf --json tasks preview workflow.yaml
bin/wf --json workflow import workflow.yaml
bin/wf --json workflow list
bin/wf --json run create --revision 1
RUN_ID=run_be56daed-4aa5-47c3-92e9-0fc00b08450d
bin/wf --json run status "$RUN_ID"
bin/wf --json run start "$RUN_ID" --expected-event 2
bin/wf --json run status "$RUN_ID"
bin/wf --json run reports "$RUN_ID"
bin/wf --json run events "$RUN_ID" --after 0 --limit 100
# Driver sends SIGKILL only to owned owner 617138 and awaits exit (-9).
bin/wf --json daemon start                         # replacement foreground process 617371
bin/wf --json run status "$RUN_ID"
bin/wf --json run recovery "$RUN_ID"
bin/wf --json run resume "$RUN_ID" --expected-event 9 \
  --reason "Must refuse unresolved interrupted work" # expected exit 1
bin/wf --json run recovery-terminate "$RUN_ID" \
  --request /tmp/opencode/wf-final-gate-m05xdvv4/terminate.json
bin/wf --json run recovery "$RUN_ID"
bin/wf --json run recovery-decide "$RUN_ID" \
  --request /tmp/opencode/wf-final-gate-m05xdvv4/decision.json
bin/wf --json run status "$RUN_ID"
# Driver writes release and removes only its fixture tasks.md, proving immutable import.
bin/wf --json run resume "$RUN_ID" --expected-event 13 \
  --reason "Explicitly execute the reviewed retry and remaining imported task"
bin/wf --json run status "$RUN_ID"
bin/wf --json run reports "$RUN_ID"
bin/wf --json run events "$RUN_ID" --after 0 --limit 3
bin/wf --json run events "$RUN_ID" --after 3 --limit 1000
bin/wf --json daemon stop
```

Both JSON requests used fresh `expectedEventId`, the exact interrupted
`attemptId` and nonblank reasons. Termination asked to end the verified orphan;
decision selected `action: retry`, explicitly acknowledging the first recorded
effect would repeat. No token/discovery content was printed.

Observed: valid definition with no diagnostics; preview/import/list/ready
creation; first task starts; crash leaves stale discovery and a surviving
owned command. Replacement owner rotates discovery, records `interrupted/alive`
and **does not replay**. Premature resume exits 1:
`interrupted runs require an explicit recovery decision before resume`.
Termination records `gone`; retry decision stays paused without another effect.
Separate resume finishes both stable task IDs even with checklist removed:
**2/2 completed**, attempts `interrupted/succeeded/succeeded`, **7 committed
transitions**, **34 ordered unique events**, zero reports (command-only).
The first task's effect occurs twice only after explicit retry; second occurs
once. Paginated events concatenate without duplication.

A throwaway assertion initially expected nine transitions; inspection showed
the correct seven (three picks, two successful work steps, two task completions;
neither interrupted work nor terminal `end` commits a transition). The driver
expectation was corrected; no production/test contract changed. The completed
run itself was not rerun to hide this driver error.

Before shutdown and after owner exit, exact independent read-only snapshots
were obtained with:
`node --input-type=module -e '<open WorkflowDatabase(file,{readOnly:true}); new RunCoordinator(db).inspect(runId); close>' FILE RUN_ID`
from the repository. Entire snapshots compared equal, including tasks,
attempts, revisions, transitions, retained history and events.

Cleanup assertions: crash owner exit **SIGKILL/-9**, replacement owner graceful
exit **0**; owner PIDs/groups **617138, 617371** absent; every invocation
PID/group **617308, 617576, 617595** absent; TCP connections to former loopback
ports **38891, 35161** refused; final `daemon.json` absent. Only after those
checks and durable reopen did the driver remove its exact owned root and assert
its absence. No default state, project, harness state or unrelated `/tmp` tree
was removed. The owned fixture scripts/request files disappeared with that root.

### Final verification matrix and verdict

| Exact command / exercised surface | Observed result | Limit |
| --- | --- | --- |
| `npm run check` | Typecheck, Biome, build and **819 tests / 90 suites** pass; 819 passes, **0 failures/cancellations/skips/TODOs**. Delta from 9.4: **0 tests, 0 suites, 0 failures/skips/TODOs**. | Existing informational Biome style suggestions remain; no lint failure. Offline fixtures, not fresh provider compatibility. |
| `for file in examples/*.yaml; do npm run validate -- "$file" || exit; done` | All **6 valid / 0 warnings**: command-only 3 steps, human-checkpoint 2, implement-review-commit 7, minimal-single-step 2, overnight 8, task-loop 4. Overnight hash prefix unchanged: `8a4912284968`. | Validation executes no workflow; Git/agent samples were not launched. |
| `npm run test:browser` | **3 passed**, one worker, no retries, fresh disposable state and explicit fake-only entries for all registered harnesses. Visual ready/start/blocked/revision/separate resume, intervention/stale decisions and reload/last-tab independence pass. Fixture output proves 5/1/1 owned children gone, each owner exit 0, durable reopen, listener/discovery absence and owned root removal. | Chromium only, bounded desktop/390px coverage. An inherited NO_COLOR/FORCE_COLOR warning is informational; no browser download/provider launch. |
| `npm run smoke:reporting` | Accepted report durable while process active/cursor unchanged; direct success 1 report/0 corrections; correction success 1/1; correction failure paused/0/1 with `system.report_error`; SQLite reopen and temporary cleanup pass. | Synthetic agent sessions through actual `wf report`, not paid providers. |
| `npm run smoke:capabilities` | Required incompatibility/model rejection: 0 launches; fresh reporting: 1 launch; missing correction/explicit resume produce `system.report_error` / `system.resume_unavailable`, no fresh fallback. | Synthetic installed-feature fixtures, not authentication/session availability for current user accounts. |
| `npm run smoke:tasks` | 3 checkboxes, 1 prechecked, 2 runnable; both complete in source order through real reports; Markdown unchanged, prepared context persisted, temporary state removed. | Supported local Markdown subset, not complete CommonMark or re-import. |
| `npm run smoke:boundaries` | OpenCode/Claude synthetic correction succeeds and original process failure routes `system.process_error`; selected environment, scrubbed logs/diagnostics, sequential settlement and durable reopen pass. | Known synthetic credentials only; not isolation or protection against unknown harness-loaded secrets. |
| `npm run smoke:recovery` | Four SIGKILL boundaries: command/retry, correction/skip, between/continue, correction-intent/end; no replay, explicit durable decisions/reopen and owned cleanup pass. | Linux `/proc` identity/process-group limits; operator assertions do not prove escaped descendants absent. |
| Integrated `bin/wf` sequence above, driven with Python standard library | YAML configure/save/list/create, two imported tasks, unattended command, crash inspection/barrier, verified termination, explicit decision and separate resume reach completed 2/2; 3 attempts, 7 transitions, 34 events. Reopen/cleanup assertions pass. | Command-only; repeated first-task effect is deliberate authorized retry, not exactly-once external effects. Initial throwaway transition-count expectation corrected as described above. |

The browser and five required smoke commands were executed in one fail-fast
chain:

```bash
npm run test:browser && npm run smoke:reporting && npm run smoke:capabilities && npm run smoke:tasks && npm run smoke:boundaries && npm run smoke:recovery
```

The exact read-only durable inspection command used by the integrated driver
(before shutdown and again after exit) was:

```bash
node --input-type=module -e \
  'import {WorkflowDatabase} from "./dist/store/database.js"; import {RunCoordinator} from "./dist/engine/run-coordinator.js"; const db=new WorkflowDatabase(process.argv[1],{readOnly:true}); try{console.log(JSON.stringify(new RunCoordinator(db).inspect(process.argv[2])))}finally{db.close()}' \
  /tmp/opencode/wf-final-gate-m05xdvv4/state/state.sqlite \
  run_be56daed-4aa5-47c3-92e9-0fc00b08450d
```

Documentation verification used an in-memory Python standard-library checker
over the 12 known repository Markdown files, outside fenced code. It resolved
relative paths, explicit anchors and GitHub-style deduplicated heading slugs:
**130 relative links, zero missing paths/anchors**. External URLs were not
fetched. The checker created no files or dependencies.

**Final MVP gate passes; 9.5 is checked.** The YAML/CLI integrated gate and
permanent visual-authoring/lifetime scenarios jointly demonstrate the requested
configure → unattended execution → inspection/intervention/recovery scenario
without a supervisor LLM. No production defect was found. Four known prose
mismatches are reconciled, not hidden by implementing extra features or weakening
contracts. Deferred scope remains explicit in spec §8; historical provider
evidence and documented OS/credential/isolation limits are unchanged.

No dependencies/downloads, schema/migration history, report fields, runtime
behavior, global configuration or user/default state changed. No live provider,
authentication or credential/auth-file inspection was used. This pass adds no
permanent test or tool abstraction; throwaway owned fixture files were removed.
Owner review is the next boundary; no further feature scope is authorized by
this completion.

