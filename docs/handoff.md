# Fresh-agent handoff — Agent Workflow Runner

Continue implementation in `/home/phagmaier/Code/workflowz`. The next implementation milestone is **Phase 6.2, the Pi adapter**. Do not jump to daemon management or UI.

## Repository and verification state

- Branch: `main`; remote: `origin` (`https://github.com/phagmaier/workflowz.git`).
- The previously uncommitted reporting/task/revision work was committed and pushed as `d8ec593` (implementation) and `0cd02da` (matching spec synchronization).
- This handoff accompanies the following Codex adapter commit. Use `git log -3 --oneline` and `git status --short` to obtain its exact hash and verify the checkout. Preserve any later user changes.
- Phases 1–5 are complete. Phase **6.1 is complete with offline conformance evidence**. Phase **6.2 is next**. Milestone **0.5 remains unchecked**; the full Phase 6 live gate is incomplete.
- Final gate for the Codex work: **336 tests passed, zero failures/cancellations/skips**, with typecheck/lint passing on Node **v26.8.2**. Biome reported 105 informational suggestions, no errors. Details are in `docs/implementation-log.md`.
- The installed Codex adapter factory performed offline probes and returned `{version: "codex-cli 0.163.0", supportsResume: true}`. No live model/provider calls were made. Credential files were not read; global harness configs were not changed.

Use this Node version explicitly; the default shell may select v26.7.0:

```sh
PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH npm run check
```

`npm ci --offline --ignore-scripts` previously succeeded with the committed lockfile. No new dependencies were added for Codex. Loopback/process tests require approved execution outside the sandbox here: sandboxed listening returns `EPERM`. This is an execution-environment constraint, not a product approval gate.

## Read before designing or editing

Follow `AGENTS.md`. Read in order:

1. `README.md`
2. `spec.md`
3. `architecture.md`
4. `todo.md`
5. `examples/overnight.yaml`

Then read `docs/schema-v1.md`, `docs/implementation-log.md`, and `docs/harness-compatibility.md`. Their implementation notes distinguish implemented behavior from roadmap/illustrative interfaces.

Use the installed `codebase-memory` skill for structural exploration. Project: `home-phagmaier-Code-workflowz`. The index still contains documentation but does not track source files: symbol searches were empty and coverage checks returned `not_tracked`. Call coverage checks for relied-on paths and read source directly for those gaps. Do not treat missing graph symbols as absent code. No sub-agents were used; do not delegate unless authorized by user/applicable instructions.

## What the Codex task added

- `src/adapters/codex.ts`: `createCodexAdapter(options?)` probes version, exec help and resume help offline, then returns a runnable adapter. Required launch flags are feature-detected; missing resume capability disables report correction and rejects requested resume before launch. Register explicitly in `RunService` options as `new Map([["codex", adapter]])`.
- `src/adapters/codex-events.ts`: bounded LF JSONL decoding, UTF-8 chunk support, CRLF, optional final LF, 1 MiB line bound, UUID session capture, terminal/failure evidence. Unknown event types are tolerated. Malformed/oversized records, `turn.failed` or `error` cause technical failure. Item content and outcome-looking stdout have no reporting authority.
- Prompts use stdin. Launch is `codex exec ... -`; resume is `codex exec resume ... <exact-persisted-UUID> -`. Never use `--last`, session-name lookup, `--ephemeral`, or a fresh fallback. An unexpected returned identity is rejected and never replaces the requested session in durable state.
- Model and reasoning effort are forwarded. Per-invocation config enables report environment delivery, excludes the Codex API key from tool inheritance, and disables shell snapshots. The user previously chose unrestricted harness modes; Codex uses `--dangerously-bypass-approvals-and-sandbox`. No global config is edited.
- The environment is the common allowlist plus selected `CODEX_HOME`, `CODEX_API_KEY`, report endpoint/token, and project-local `bin/wf` on PATH. Other harness variables/credentials are withheld. Injected known secrets are scrubbed across stdout/stderr boundaries.
- `AgentHandle.launchInfo` optionally supplies CLI version/permission mode. `RunService` passes these through the coordinator into invocation-start events.
- `src/adapters/process.ts` gained optional stdin and a continuous scrubbed stdout observer before bounded capture. Existing commands keep ignored stdin. `ProcessResult.stdinError` records failed delivery. Stream parsing continues past the 64 KiB stdout capture limit.
- `test/fixtures/fake-codex.mjs` is a synthetic CLI boundary over the existing fake-agent fixture. It exercises real adapter argv/stdin/env/JSONL and actual `wf` reports without providers. Captured fixture env values redact key/token/secret contents.
- `src/adapters/codex.test.ts` runs the full shared adapter conformance suite plus invocation/compatibility/session/metadata cases. `codex-events.test.ts` covers framing; process tests cover stdin, closed pipes and scrubbed streaming beyond capture limits.
- `src/test-support/adapter-conformance.ts` now accepts async factories for offline probes. Session matching compares original settlement identity to correction-start identity, since real harnesses can discover session IDs after process launch.
- Only Codex has `conformance_passed` in the harness registry. Pi, omp, OpenCode and Claude remain `planned`.
- No schema migrations were needed for Codex. Official documentation links and exact installed-version evidence are in `docs/harness-compatibility.md`.

## Next task: Phase 6.2

Implement the smallest runnable Pi adapter against the existing interface and shared conformance suite.

1. Inspect the actual installed `pi --version` / `pi --help` and installed official/package docs. The recorded version is **1.3.0**, but verify again. Identify the installed fork/package rather than assuming an npm import or upstream event shape.
2. Verify headless JSON/RPC framing, session identity/persistence/resume and model flags. Pi-family streams must split **only on LF**, with a streaming UTF-8 decoder. `agent_end` can precede automatic retries; **`agent_settled`**, followed by confirmed process/group/pipe settlement, is the relevant boundary. Do not copy Codex terminal-event semantics to Pi.
3. Keep providers/harness parsing in adapters. The runner owns report acceptance, correction budget and routing. Reuse the common supervisor, report channel, async conformance factory and fixture pattern.
4. Preserve exact same-session resume. If unavailable, fail explicitly; never start fresh. Report correction cannot overlap the original invocation and is limited to one bounded follow-up.
5. Build an offline Pi CLI fixture and run the full shared conformance suite against the real adapter. Include Pi-specific retries/settlement/session framing cases. Register `conformance_passed` only after those tests pass.
6. Update schema decisions/architecture/spec when behavior choices need clarification, compatibility evidence, implementation log and `todo.md`. Do not check milestones whose complete acceptance criteria have not passed.

The previous compatibility note says Pi help advertises `--print`, `--mode json|rpc`, `--session`, `--resume`, `--continue`, and `--model`, with **no permission-mode flag**. The user chose normal unrestricted Pi tools; do not invent an approval gate or unsupported flag. Verify the installed interface.

Phases 6.6–6.8 have partial foundations (probes, allowlists, scrubbing) but remain unchecked. Authentication, actual provider event framing/session compatibility and opt-in live smoke still need work for every harness. Offline fixtures/help markers alone do not satisfy milestone 0.5 or the full Phase 6 gate. No live-smoke script has been added yet. Do not silently run paid calls as part of the normal test suite.

## Existing core to preserve

- Coordinator is the canonical state owner. Mutations and corresponding audit events share transactions. Caught nested transaction failures make the outer transaction rollback-only.
- One globally running/pausing run and one active attempt. A report is not process settlement. Confirm process-group reaping and pipe closure before routing/dispatch; uncertain cleanup leaves the attempt active and blocks another dispatch. Stop affects only the requested owned run.
- Reports are strict bounded v1: exactly `{outcome, summary, issue?, handoff?, data?}`. IDs and transitions come from engine authority. `bin/wf` uses environment authorization, waits for acknowledgment, and submits via private loopback `POST /internal/reports`.
- At most one accepted report per attempt. Tokens are memory-only, rotated for correction, revoked on settlement/stop/shutdown, and rechecked after body arrival. Never persist/log authorization or credentials.
- Exactly one report correction after a clean missing report, in the same persisted session/logical attempt, at most 30 seconds (service can shorten). Prompt forbids source modifications. Failed correction becomes `system.report_error`; original process/provider failures retain technical outcomes and bypass correction. Preserve accepted reports for diagnosis.
- Session lookup is latest persisted same-harness/run/task/**revision**. New revisions do not inherit old revision IDs' sessions. Parameter edits within a revision retain scope. Identical YAML/source-dir content can reuse an existing revision ID.
- Markdown import is read-only and immutable. Stable run-local IDs derive from original source order, including excluded prechecked gaps. Source text/hash/check state/positions/body/headings persist; no automatic re-import or write-back.
- Agent preparation reads current configured instructions, adds task context and only explicitly selected latest same-task reports, and freezes the input before authorization is generated. Missing explicit placeholders fail before launch; missing selected history is omitted until produced.
- Task overrides are separate run configuration: `{steps: {step_id: {model?, prompt?, skip?: {outcome}, on?}}}`. Existing executable steps only; skips choose a declared outcome without process/report and do not imply task completion. Attempts freeze parameters. Configuration edits require ready/paused state, no active attempt and a reason.
- Paused revisions preserve task IDs/progress/source, historical definitions/attempts/reports/input snapshots and revision associations. Validate all unfinished task settings; require an explicit compatible cursor for removal/kind change or incompatible task state.
- Migrations **1–6 are append-only**: 3 correction counter, 4 task imports/source metadata, 5 attempt inputs, 6 task overrides/attempt parameter snapshots. Never rewrite migration history.
- Keep observed attempt outcomes separate from routed retry-exhaustion outcomes.
- No supervisor LLM, hidden retries, mandatory tests/reviews/commits/approvals, arbitrary per-task graph rewrites, or claims of isolation/rollback. Tests and reviews are workflow steps only when authored.

Known Phase 7 work remains: daemon instance lock, PID/start identity checks, conservative orphan reconciliation, management CLI and retry backoff enforcement. Existing process-group ownership has documented PID-reuse/escaped-descendant limitations. No daemon or UI was implemented in this session.
