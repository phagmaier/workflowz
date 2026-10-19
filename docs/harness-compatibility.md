# Harness compatibility note

Probed on this machine with `npm run probe:harnesses` (offline: `--version` and each CLI's help text only; no model is called and no credentials are read). Re-run the probe after any CLI upgrade. The historical table below records CLI interfaces. Phase 6.6 now uses the actual isolated adapter factories for inventory, rather than treating CLI flags as proof of an implemented transport. Static registry metadata and effective installed snapshots are distinct.

| Harness | Installed version | Headless launch | Machine-readable stream | Session resume | Permission mode | Model selection |
| --- | --- | --- | --- | --- | --- | --- |
| `codex` | `codex-cli 0.163.0` | `codex exec [PROMPT]` | `--json` (JSONL) | `codex exec resume [SESSION_ID] [PROMPT]` or `--last` | `-s/--sandbox {read-only,workspace-write,danger-full-access}`; `--dangerously-bypass-approvals-and-sandbox` | `-m/--model` |
| `pi` | `1.3.0` | `pi --print --mode text\|json\|rpc` | `--mode json` / `--mode rpc` | `--continue`, `--resume`, `--session <path\|id>`, `--session-id <id>` | none advertised; only a tool allowlist (`--tools`) | `--model` |
| `omp` | `omp/18.12.2` | `omp --print --mode text\|json\|rpc\|rpc-ui` | `--mode json` / `--mode rpc` | `--resume <id>`, `--continue`, `--restore` | `--approval-mode always-ask\|write\|yolo`, `--auto-approve` | `--model` |
| `opencode` | `opencode v2.0.32` | `opencode run [message]` | `--format json` | `--session <id>` (creates the session if it does not exist), `--continue` | `--auto` (auto-approve anything not explicitly denied) | `--model provider/model` |
| `claude` | `2.1.303 (Claude Code)` | `claude --print` (`-p`) | `--output-format stream-json` | `--resume <session-id>`, `--session-id <uuid>` | `--permission-mode acceptEdits\|auto\|bypassPermissions\|manual\|dontAsk\|plan` | `--model` |

Earlier probes advertised the original informational help markers. The separate `HELP_PROBES` table has now been replaced by factory-backed inventory; see Phase 6.6 below.

## Notes that affect the adapters

- **codex.** `--ephemeral` exists. Correction turns depend on the session being persisted, so the adapter must not pass it. `--output-schema` is available for structured final output but is only a fallback; `wf report` stays the primary contract.
- **pi.** The help text lists no permission-mode flag. The registry therefore sets `supportsPermissionMode: false`. The user's Pi configuration decides tool permissions.
- **omp.** LF JSON framing is shared with Pi, but lifecycle and storage are not identical: no `agent_settled`, `agent_end.isTerminal` and `auto_compaction_*` instead, and a physical title slot before the persisted header. Phase 6.5 verifies the dialect against bundled docs and official source; actual provider streams remain unverified.
- **opencode.** Reverified v2.0.32 help now lists both `service` and `serve`. `run --format json` remains available, but its `--session` creates missing IDs. Phase 6.4 uses the supported invocation-local `serve --stdio` API path instead; it never manages the shared service.
- **claude.** An isolated offline invocation verified that `--output-format stream-json` requires `--verbose` on 2.1.303. `--no-session-persistence` breaks resume and is never passed. See the Phase 6.3 evidence below.

## Unrestricted mode used by the adapters

Chosen by the user: every adapter launches its harness in the unrestricted mode the CLI offers. The runner does not add approval gates or sandboxing, and it does not claim any isolation (spec §6). Each adapter records the mode it used in its attempt events.

| Harness | Unrestricted setting | Notes |
| --- | --- | --- |
| `codex` | `--dangerously-bypass-approvals-and-sandbox` | Help text calls this extremely dangerous and intended for externally sandboxed environments. The user has chosen it anyway. |
| `pi` | none; the flag set has no permission gate | Pi's default tool set is already unrestricted, so the adapter passes no flag. |
| `omp` | `--approval-mode yolo` | Auto-approves read/write/exec tiers; explicit tool/user deny/prompt policies and provider safety checks still apply. |
| `opencode` | v2 session rules `[{action: "*", resource: "*", effect: "allow"}]` | Audited as `session-allow-all`; session rules run after agent rules. Stronger than `--auto`, which preserves explicit denials. No global settings change. |
| `claude` | `--permission-mode bypassPermissions` | `--dangerously-skip-permissions` is the flag form; the mode form also shows which mode was chosen. |

These selections come from installed help or the versioned API contract linked below. Adapter conformance checks the selected mode; live effectiveness remains a separate verification.

## Authentication

Offline inventory does not check authentication. Earlier unverified status-command exits are not authentication evidence. The opt-in Phase 6.8 tool uses documented Codex/Pi/Claude status checks, discards all status output, and retains only the classification below. No credential files are inspected or copied; no login/logout or global configuration change is performed.

## Live verification — Phase 6 passed; milestone 0.5 incomplete

The account owner explicitly authorized the revised Luna/low pass on 2026-10-19. Codex `0.163.0` with `gpt-6-luna` and Pi `1.3.0` with `openai/gpt-6-luna` each completed both report and exact-session correction scenarios. All four workflows returned `complete`, acknowledged actual `wf report`, reopened SQLite successfully and removed their settled targets. No alternate model, higher reasoning or runner retry was used.

The Codex/Pi evidence verifies their exercised authentication, provider framing, helper tool/report environment and persisted-session correction paths—not arbitrary tools, managed settings or every provider. Together with the 697-test offline gate, including all registered adapters' conformance suites, it satisfies the Phase 6 gate. A separately authorized remaining-harness pass then completed Claude and OpenCode direct reporting but stopped at omp's missing OpenAI credential; no remaining-harness correction ran. Milestone 0.5 remains open. See [remaining-pass results](#remaining-milestone-05-results--stopped-at-omp-authentication) and [Codex/Pi verification](implementation-log.md#phase-6-live-acceptance--authorized-lunalow-pass).

The Phase 6.1–6.7 implementation sections below preserve their implementation-time evidence and limitations. Their live-pending statements are superseded only for the paths actually exercised above and in the results below; synthetic evidence alone still does not establish live compatibility.


## Codex adapter implementation (Phase 6.1)

`createCodexAdapter` probes `--version`, `exec --help`, and `exec resume --help` before registration. Current installed evidence remains `codex-cli 0.163.0`; the adapter-specific offline probe returned `{version: "codex-cli 0.163.0", supportsResume: true}`. Required launch markers include JSONL, model/config selection, non-Git working directories, unrestricted mode and stdin. Missing launch capabilities reject creation with a useful error. Missing resume markers disable correction resume and reject an explicitly requested persisted session before launch. No exact minor version is required; advertised features gate use.

The adapter launches `codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox ... -`, or `codex exec resume ... <persisted-UUID> -`. Prompts go through stdin; report endpoint/token only through the environment. Optional `--model` and TOML-quoted `model_reasoning_effort` select workflow parameters. No `--last`, session-name lookup, `--ephemeral` or fresh-session fallback is used. A mismatched session is an error. Version and permission mode are written in invocation events.

The bounded LF JSONL decoder consumes the whole stream independently of bounded stdout capture. It accepts CRLF and UTF-8 split across chunks, ignores unknown future event types, captures `thread.started.thread_id`, and requires `turn.completed` for a clean turn. Malformed/oversized records, `turn.failed` and `error` fail the invocation without report correction. A clean terminal turn without a session identity cannot receive correction. Item payloads and outcome-looking stdout have no reporting authority. No event settles the process; exit/group reaping/pipe closure still control settlement. Timeout/spawn/nonzero process failures retain technical routing.

The Codex process receives only the shared base allowlist plus explicitly selected `CODEX_HOME`, `CODEX_API_KEY`, and report access. `bin/wf` is prepended to PATH. Per-invocation `shell_environment_policy` inherits this reduced environment, permits report-token inheritance, and excludes `CODEX_API_KEY` from tool subprocess inheritance. `features.shell_snapshot=false` avoids capturing invocation authorization in shell snapshots. These overrides edit no global config and do not provide isolation; user/managed configuration or shell startup behavior still needs live compatibility verification. Known injected key/token values are scrubbed from stdout/stderr/logs across chunks.

Sources consulted for this implementation:

- [Official non-interactive mode documentation](https://learn.chatgpt.com/docs/non-interactive-mode) — JSONL event names and explicit-session resume.
- [Official CLI reference](https://learn.chatgpt.com/docs/cli/reference) — stdin, model/config and unrestricted flags.
- [Official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) — reasoning effort, shell snapshots and environment policy.
- Installed `codex --version`, `codex exec --help`, `codex exec resume --help`, plus the adapter's own offline factory probe. Help execution in the sandbox printed an inability to create PATH aliases; it still exited 0 and advertised the expected interface. No configuration or credential file was inspected.

The adapter passes the shared offline conformance suite using `test/fixtures/fake-codex.mjs`, which exercises the real adapter argv/stdin/JSONL/environment/process paths and actual `wf` reports. Fixtures are synthetic, not captured provider streams. This supports `conformance_passed` registry status, **not live support verification**. Milestone 0.5, authentication, actual stream/session compatibility, and opt-in live smoke remain unfinished. Do not mark the full Phase 6 gate complete on this evidence.

## Pi adapter implementation (Phase 6.2)

Reverified `pi --version` as **1.3.0**. The executable resolves to `/home/phagmaier/.local/share/mise/installs/pi/1.3.0/pi/pi`; its adjacent `package.json` identifies **`@earendil-works/pi-coding-agent`**, repository `earendil-works/pi`. Bundled `docs/json.md`, `docs/cli.md`, `docs/session-format.md`, `docs/message-types.md` and `docs/rpc.md`, plus the official v1.3.0 source, informed this implementation. No npm SDK import or assumptions about another Pi fork are needed.

`createPiAdapter()` returned `{version: "1.3.0", supportsResume: true}` using offline version/help probes. Required markers cover print/JSON, model/thinking and session-directory support; the separate exact `--session` marker gates resume/correction. Missing required features reject creation; absent resume disables correction and rejects requested resume before launch. Probes use temporary `PI_CODING_AGENT_DIR`, `PI_OFFLINE=1`, `PI_TELEMETRY=0`, and disabled extensions/MCP/skills/templates/themes/context discovery. Temporary probe config is removed. An initial direct `pi --help` printed a settings lock warning in the restricted environment; subsequent adapter probes used isolated config and succeeded without that warning.

Invocation is `pi --print --mode json --session-dir <unique-directory>`, optionally `--model <model>` and `--thinking <level>`. Prompts use stdin, not argv. No permission flag is invented: normal unrestricted tools remain selected by Pi's configuration and invocation events record `default-unrestricted-tools` plus the version. The runner injects the common `wf` PATH and report environment; no stdout report fallback exists.

The continuous LF-only UTF-8 decoder accepts optional CR before LF, preserves Unicode separators inside strings, bounds each line at 1 MiB, drains oversize records and rejects malformed/truncated records. It tolerates unknown event types. A final non-aborted `agent_settled` is required along with confirmed process/group/pipe settlement. `agent_end` is insufficient, including when `willRetry` is false. Transient failed messages may recover through native retries/overflow recovery; final assistant error/abort/length stops, exhausted retries, compaction failures and protocol failures remain technical failures even if JSON mode exits zero. Official print-mode source checks final assistant errors in text mode only, making stream failure detection necessary for JSON mode.

Each fresh invocation stores sessions in a dedicated directory under the runner's log storage (`pi-sessions`) or explicit adapter `sessionDir`. A matching streamed UUID and bounded persisted v3 session header are required before the absolute file path is saved as the engine's opaque session identity. Resume validates the file, filename UUID and working directory, then passes `--session <full-UUID> --session-dir <that-file-directory>`. The installed CLI source resolves this exact ID before prefix lookup and confines lookup to the supplied directory; missing IDs exit with failure. This deliberately avoids `--session <missing-path>` and `--session-id`, both of which can create a fresh session. Returned identity mismatch is rejected and never replaces the requested durable path. No `--continue`, interactive `--resume`, fork or ephemeral session is used. Correction remains the existing single bounded sequential follow-up.

Runtime inherits the shared base allowlist plus these explicitly selected names when present: `PI_CODING_AGENT_DIR`, `PI_OFFLINE`, `PI_TELEMETRY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_OAUTH_TOKEN`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`. Other providers can use Pi's own auth store; the runner does not inspect it. Codex/Claude/omp state, arbitrary parent variables and other credentials are withheld. Injected known provider keys/tokens and report authorization are scrubbed across stdout/stderr chunk boundaries. This is an environment selection policy, not isolation; Pi tools/extensions retain user access and live tool-environment behavior remains to be verified.

Official references:

- [JSON stream reference at v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/json.md) — LF framing, headers, retries and `agent_settled`.
- [CLI reference at v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/cli.md) — models, thinking, tool defaults and session flags.
- [CLI source at v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/main.ts) — stdin and exact-ID/session selection.
- [Session manager at v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/session-manager.ts) — persistence, missing-path behavior and directory-limited lookup.
- [Print-mode source at v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/modes/print-mode.ts) — JSON headers/events, final status and disposal.

The real adapter passes the complete shared offline conformance suite through `test/fixtures/fake-pi.mjs`, plus Pi-specific retry, settlement, framing, persistence and identity tests. The fixture is synthetic, not a captured provider trace. Pi is now `conformance_passed`; authentication, provider-backed session/resume, actual tool environment and user-resource interactions remain opt-in live-smoke work. No paid calls were made or global harness config edited. Milestone 0.5, 6.8 and the full Phase 6 gate remain open; Claude Code now has separate offline evidence below.


## Claude Code adapter implementation (Phase 6.3)

Reverified the native installed executable at `/home/phagmaier/.local/share/mise/installs/claude/2.1.303/claude`: **2.1.303 (Claude Code)**. `createClaudeAdapter()` returned `{version: "2.1.303 (Claude Code)", supportsResume: true}`. The factory checks required print/input/output/verbose, model/effort and bypass-mode help markers; an absent exact `--resume` flag disables correction and rejects requested resume. Probes use temporary HOME/`CLAUDE_CONFIG_DIR`, nonessential traffic disabled and no inherited credentials, then remove their temporary config. Sandboxed native help returned empty output in one factory check; the approved outside-sandbox path returned the expected interface.

Launch is `claude --print --input-format text --output-format stream-json --verbose --permission-mode bypassPermissions`, optionally `--model <model>`, `--effort <low|medium|high|xhigh|max>` and `--resume <persisted-UUID>`. Prompts use stdin; report authorization uses only environment. Model-specific effort availability remains the CLI/provider's decision. Default persistence and normal configured resources/authentication stay enabled. No `--bare` is passed at runtime because it changes authentication/resource discovery. No session selector, fork or ephemeral flag is used. Invocation events record the version and selected `bypassPermissions` mode; managed restrictions may still affect a real invocation.

The LF-only UTF-8 decoder accepts CRLF and bounds records to 1 MiB. It handles startup events before init, drains the whole stream beyond bounded stdout capture, and rejects malformed, oversized or unterminated records. A final `result` with `subtype: success` and `is_error: false` is necessary; duplicate results, events after result and error results fail closed. Init/result IDs must match. API retry notifications may recover before success. Common process exit/group/pipe settlement is independently required; result text has no reporting authority. Protocol/provider failure bypasses correction even on exit zero.

The terminal UUID supplies the engine's opaque session identity; missing identity cannot authorize correction. Only full UUIDs may resume. The CLI owns persisted transcript storage and lookup; the runner does not inspect transcripts or auth files. Returned mismatch never replaces a requested durable UUID. Same-harness/run/task/revision scoping and one bounded sequential report correction remain unchanged.

Two additional installed checks used a temporary home/config, `--bare`, no credentials, a loopback-only provider URL and a deliberately absent UUID. Without verbose, stream-json failed before execution with the expected validation message. With verbose, exact resume exited 1 with `result/subtype: error_during_execution`, `is_error: true`, the requested `session_id`, zero turns/cost and `No conversation found with session ID: <UUID>`. The adapter recognizes that known unavailable-session result. The real adapter repeated the missing-UUID check with temporary home/config, no credentials and a loopback-only provider URL, using its normal runtime argv (including `bypassPermissions`, without `--bare`): exit 1, `resumeUnavailable: true`, requested UUID retained, no timeout. These checks verify local failure paths, not successful persistence or authenticated resume. No provider calls were made.

Runtime selects the common base allowlist plus these names when present: `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`. Report access and project-local `wf` PATH are injected separately. Known injected keys/tokens are scrubbed across stdout/stderr chunk boundaries. Nested `CLAUDECODE`, Pi/Codex configuration, `NODE_OPTIONS`, arbitrary parent variables and other provider credentials are withheld. Other provider/backend environment configurations are not implemented in this slice. This selection is not isolation: normal Claude settings/hooks/tools retain user access, and live tool environment behavior remains unverified. The adapter withholds the parent subprocess-scrub switch; if user/managed settings enable `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, its credential removal may prevent tools from inheriting report access. That interaction remains a live compatibility check.

Official references consulted, alongside installed help and isolated failure checks:

- [Programmatic CLI guide](https://code.claude.com/docs/en/headless) — stdin, LF stream-json, verbose, terminal result and explicit session resume.
- [CLI reference](https://code.claude.com/docs/en/cli-reference) — print/input/output, model/effort, permission and persistence flags.
- [Environment reference](https://code.claude.com/docs/en/env-vars) — Claude/Anthropic configuration and auth names.

The synthetic `test/fixtures/fake-claude.mjs` CLI runs the real adapter through the entire shared conformance suite with real processes, loopback reporting and `wf`. Additional tests cover terminal/provider failures, LF/CRLF/UTF-8/Unicode separators, oversized/truncated/malformed streams, init/result/session mismatches, unavailable exact resume, capture limits, credential scrubbing and result-before-process-exit. Claude is now `conformance_passed`. Authentication, actual provider framing, successful live persistence/resume, managed/user-resource interactions and tool environment propagation remain opt-in live-smoke work. Milestone 0.5, 6.8 and the full Phase 6 live gate remain unchecked. OpenCode now has separate offline evidence below.

## OpenCode adapter implementation (Phase 6.4)

Reverified `/home/phagmaier/.local/bin/opencode` as **opencode v2.0.32**. Current root help lists both `service` and `serve`; `run --help` advertises optional one-shot message input, `--format json`, create-or-continue `--session`, `--auto`, and `--model provider/model#variant`. Official run source confirms stdin prompt delivery. `serve --help` advertises `--stdio`, `--hostname`, `--port`. `createOpenCodeAdapter()` independently returned `{version: "opencode v2.0.32", supportsResume: true}` from isolated offline version/run/serve/session help probes. The factory requires v2 private-server/model markers; persistence/export help gates correction support. Help is not proof of provider compatibility.

### Integration choice and installed evidence

The adapter deliberately does **not** use `run --session`. An isolated installed CLI experiment used a temporary home/config/data/state/cache, disabled model fetching/project/Claude discovery, no provider credentials, and the deliberately invalid `workflowz-invalid/model` provider/model. `run --format json --auto --session ses_workflowz_create_if_missing` exited 1 with `provider.no-route`, yet a subsequent exact lookup returned that newly created ID with persisted `outcome: failed`. A separate absent-ID `GET` and exact prompt `POST` both returned `404 SessionNotFoundError`; a subsequent lookup remained 404. No provider route was available and no paid model request was made.

Official v2.0.32 CLI source confirms `step_finish` is a model-step boundary. Execution success itself is not emitted as a terminal JSON record; the CLI waits/reconciles internally. Its selection source explicitly creates an absent requested ID. Checking availability before calling `run` would leave a deletion race. The chosen API path has no create-on-resume route, including between lookup and admission.

The real adapter repeated installed checks using isolated temporary config/home, no credentials and disabled external model discovery: missing explicit ID returned `resumeUnavailable: true` with the requested ID retained, while an invalid-provider fresh invocation returned `providerError` from persisted `outcome: failed`, even though the private server/bridge exited zero. These are offline negative checks, not authenticated successful session/resume verification.

### Invocation and settlement

One common-supervised Node bridge launches `opencode serve --stdio --hostname 127.0.0.1 --port 0` in its owned process group. A random invocation-local password protects the loopback endpoint. The bridge holds stdin as the official ownership lease; EOF ends the private server. No `service start`, service settings, daemon discovery, shared service connection or global configuration edits are performed.

Fresh execution uses `POST /api/session` with cwd, model and explicit session permission rules. Resume uses only `GET /api/session/:id`, then exact-ID updates/admission; it never calls create, fork, recent or prefix selectors. IDs must match `ses_` plus a bounded safe opaque suffix; cwd must match. The generated prompt message ID and session must be acknowledged by `POST /api/session/:id/prompt`.

`POST /api/experimental/session/:id/wait` must acknowledge idle with 204, then exact metadata must show the same ID/cwd, an idle timestamp covering admission and advancing beyond any previous execution, and `outcome: succeeded`. Failed/interrupted/stale/missing/mismatched evidence is technical failure. Readiness/API JSON are each bounded at 1 MiB with fatal UTF-8 decoding; malformed, oversized and truncated responses fail closed. Strict bounded LF bridge records carry only identity/terminal diagnostics, never report authority. This minimal API implementation does not consume provider text/tool/SSE events, so the registry explicitly sets `supportsEventStream: false`. Unknown API fields are tolerated through boundary schemas; incompatible used fields fail.

The bridge closes the lease after terminal evidence/error and waits for server exit. The common supervisor still confirms process/group/pipe settlement. A hung server after success or missing-session evidence must time out/stop, not route early. The private password is supplied through bridge stdin/server environment and removed by installed stdio-server code before tool inheritance. Known injected lease/report/provider secrets are scrubbed from diagnostics. The session store is CLI-owned; the runner never reads auth files/transcripts or directly edits the OpenCode database.

### Model, permissions and environment

`model` accepts `provider/model` or `provider/model#variant`. Existing `reasoning_effort` selects the named model variant and requires an explicit provider/model with no embedded variant; conflicting selection is rejected. Provider-specific variant availability remains OpenCode's decision. No guessed `--effort` flag is used.

Selected unrestricted mode is the official v2 session ruleset `[{action: "*", resource: "*", effect: "allow"}]`, applied at creation or exact resume update and audited as **`session-allow-all`** alongside the CLI version. Session rules are evaluated after agent rules, last match wins. This deliberately overrides denials for this session, rather than using `--auto`'s auto-approve-unless-denied semantics. No mandatory approvals, global permission changes, isolation or rollback claims are added. Interactive forms/questions are not automatically answered by this minimal API client; a blocking form can require stop or a configured timeout. Successful live tool/permission behavior remains unverified.

Runtime environment is the common base allowlist plus: `XDG_CACHE_HOME`, `OPENCODE_CONFIG_DIR`, `OPENCODE_CONFIG`, `OPENCODE_DB`, `OPENCODE_DISABLE_MODELS_FETCH`, `OPENCODE_MODELS_PATH`, `OPENCODE_CONFIG_PROJECT_DISABLE`, `OPENCODE_DISABLE_CLAUDE_CODE`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENROUTER_API_KEY`. Report access/project-local `wf` PATH are injected separately. The parent's server password, server URL, simulation flag, arbitrary variables, nested harness config and other credentials are withheld. Other provider authentication can use OpenCode's normal store/config; this project does not inspect those files. This is deliberate environment selection, not isolation. Tool environment propagation remains live-smoke work.

### Sources and limits

Context7 lookup was attempted but unavailable because its configured API key was rejected; current official documentation and exact-version official source were read directly instead:

- [Current v2 CLI documentation](https://opencode.ai/v2/docs/cli) — automation, private/shared server ownership.
- [v2.0.32 one-shot run](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/cli/src/run/run.ts) and [noninteractive loop](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/cli/src/run/noninteractive.ts) — stdin, step JSON, explicit wait and error results.
- [Session targeting](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/cli/src/session-target.ts) — absent requested IDs create sessions.
- [Private server lease](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/cli/src/services/standalone.ts) and [server process](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/cli/src/server-process.ts) — readiness JSON, stdio ownership, Basic auth and credential removal.
- [API session contract](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/protocol/src/groups/session.ts), [handlers](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/server/src/handlers/session.ts) and [session operations](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/session/session.ts) — exact non-creating prompt admission and wait.
- [Session metadata](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/schema/src/session.ts), [inbox acknowledgment](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/schema/src/session-inbox.ts) and [permission rules](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/schema/src/permission.ts) — terminal outcome/idle, identity and unrestricted session settings.

`fake-opencode.mjs` is a synthetic CLI/private HTTP API server, not a captured provider stream. The real adapter passes the entire shared conformance suite as harness `opencode`, plus framing, terminal/provider failure, deleted/missing/mismatched sessions, stale evidence, invalid admission, environment scrubbing and process settlement cases. Registry status is `conformance_passed`. Authentication, successful live sessions/resume, actual provider behavior, resource/config interactions and tool environment remain unverified. Milestones 0.5, 6.8 and the full Phase 6 live gate stay unchecked. Phase 7 daemon locking/recovery limits remain unchanged.

## omp adapter implementation (Phase 6.5)

Installed executable resolves to `/home/phagmaier/.local/share/mise/installs/github-can1357-oh-my-pi/18.12.2/omp`; version is **`omp/18.12.2`**. The distribution is a standalone compiled binary, not an adjacent npm package. Versioned official package metadata identifies **`@oh-my-pi/pi-coding-agent` 18.12.2**, repository `can1357/oh-my-pi`. Installed `omp read omp://` exposed 134 bundled documentation files; CLI, approval and session references were read through that offline command. Current official versioned source and RPC/retry/environment references were also consulted. Context7 lookup failed because its configured API key was rejected; direct official sources supplied documentation.

### Launch, evidence and native recovery

`createOmpAdapter()` performs only isolated `--version` / `--help` probes and returns the shared Pi-family adapter with **identity `omp`**. It requires print/JSON, model/thinking, session-directory and yolo approval markers. A separate exact `--resume` marker gates correction; `--session-dir` or Pi's `--session` cannot imply it. Probe home/agent/config/data/state/cache are temporary, no provider credentials are inherited, telemetry initialization is disabled, and probe data is removed.

Runtime invocation is `omp --print --mode json --session-dir <dedicated-directory> --approval-mode yolo`, with optional `--model <selector>` and `--thinking <off|minimal|low|medium|high|xhigh|max|auto>`. Prompts are read from non-TTY stdin to EOF; no `-` marker or prompt argv is used. Model matching and model-specific thinking availability remain omp's responsibility. No ephemeral, continue, restore, fork or import flags are passed. `yolo` selects unrestricted approval tiers, **not** an override of explicit tool/user deny/prompt policies or provider safety checks. It does not provide isolation or rollback.

Print mode emits a logical v3 session header, followed by LF JSON records. Its incremental `message_update` omits full snapshots; `message_end` carries completed assistant evidence. Unlike installed Pi, omp has **no `agent_settled` frame**. Its terminal `agent_end.isTerminal: true`, successful final assistant stop and completed native retry/compaction lifecycles are necessary. Nonterminal/yielded/awaiting-async ends do not suffice. `auto_retry_end.success: false`, unrecovered assistant error/abort/length, failed `auto_compaction_end`, error notices and protocol failures bypass correction even at exit zero. Native transient failures can recover within a single invocation; the runner adds no retry. RPC's `session_settled` is a separate transport feature and is not accepted as print success.

The shared LF decoder's omp dialect uses fatal UTF-8 decoding, a 1-MiB record bound, CRLF tolerance and continuous consumption beyond stdout capture. Unknown event types are tolerated; content has no report authority. Installed print source waits for recovery/event persistence, stdout delivery and disposal and returns nonzero on terminal provider failure. The common supervisor independently requires process exit, group reaping and pipe closure. Neither terminal records nor accepted reports permit early routing/correction.

### Exact persisted resume and installed negative checks

Fresh invocations use private persistent directories under `omp-sessions` beside logs, or explicit adapter `sessionDir`. A streamed UUID must match a persisted v3 header/filename/cwd before the absolute journal path becomes durable identity. Current files have a 256-byte physical title slot before the header; legacy header-first files are accepted too. `omp-session.ts` checks bounded journal records and retains only header/transfer metadata, rejecting malformed, truncated or over-1-MiB records rather than trusting a partial history. A latest valid `session-transfer` departure is unavailable because omp would auto-fork that stale copy.

Resume revalidates file/header/UUID/cwd, then passes **`--resume <absolute-journal-path>`**, never UUID/prefix/latest lookup. Official installed-version source uses `SessionManager.open(..., {throwIfMissing: true})` for this path branch and rereads after asynchronous cwd checks. Missing or empty files cannot mint replacement sessions. ID lookup can search prefixes/global state and calls a permissive open after lookup, so Pi's UUID strategy is deliberately not reused. Returned session/cwd mismatches retain the requested engine identity and fail explicitly. Same-harness/run/task/revision scoping and exactly one sequential bounded report correction remain runner-owned.

Isolated installed startup initially failed before session lookup with missing SQLite tables (`auth_credential_blocks`, then other initialization tables). To exercise admission without touching user state, negative experiments used a temporary **empty database schema** constructed from the official credential-store/agent-storage DDL, with zero credentials. With that fixture, installed missing-path resume exited **1**, emitted `Session \"<path>\" not found.`, and created no journal. An independent smoke through the actual adapter validated a journal, deleted it in an invocation-local launcher immediately before the installed CLI opened it, and observed **exit 1, requested identity retained, no replacement, no timeout**. No initialization workaround was added to the adapter. Successful startup with ordinary user configuration and successful provider-backed resume remain unverified.

### Environment and references

Runtime selects the common base allowlist plus these names when present: `PI_CODING_AGENT_DIR`, `PI_CONFIG_DIR`, `OMP_PROFILE`, `PI_NO_TITLE`, `OPENAI_API_KEY`, `OPENAI_CODEX_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_OAUTH_TOKEN`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OMP_AUTH_BROKER_URL`, `OMP_AUTH_BROKER_TOKEN`. Report access and project-local `wf` PATH are injected separately. Known injected keys/tokens are scrubbed across output chunk boundaries and disk logs. Arbitrary parent values, nested harness state, Pi-only offline/telemetry settings, implicit session-directory overrides and other credentials are withheld. Other authentication/configuration can use omp's own resources; the runner never inspects user auth files. omp can load its normal settings/extensions/dotenv files, so this environment selection is not isolation or a claim that all tool inheritance is verified.

Official references, alongside installed version/help and bundled docs:

- [Package identity](https://github.com/can1357/oh-my-pi/blob/v18.12.2/packages/coding-agent/package.json), [CLI reference](https://github.com/can1357/oh-my-pi/blob/v18.12.2/docs/cli-reference.md), [approval modes](https://github.com/can1357/oh-my-pi/blob/v18.12.2/docs/approval-mode.md).
- [CLI stdin/session selection](https://github.com/can1357/oh-my-pi/blob/v18.12.2/packages/coding-agent/src/main.ts), [strict file open](https://github.com/can1357/oh-my-pi/blob/v18.12.2/packages/coding-agent/src/session/session-manager.ts), [session format](https://github.com/can1357/oh-my-pi/blob/v18.12.2/docs/session.md), [transfer auto-fork](https://github.com/can1357/oh-my-pi/blob/v18.12.2/packages/coding-agent/src/session/session-transfer.ts).
- [Print events/exit/disposal](https://github.com/can1357/oh-my-pi/blob/v18.12.2/packages/coding-agent/src/modes/print-mode.ts), [session event types](https://github.com/can1357/oh-my-pi/blob/v18.12.2/packages/coding-agent/src/session/agent-session-events.ts), [native retries](https://github.com/can1357/oh-my-pi/blob/v18.12.2/docs/non-compaction-retry-policy.md), [RPC dialect differences](https://github.com/can1357/oh-my-pi/blob/v18.12.2/docs/rpc.md#yield-vs-settled), [environment](https://github.com/can1357/oh-my-pi/blob/v18.12.2/docs/environment-variables.md).
- Empty negative-check fixture DDL only: [credential store](https://github.com/can1357/oh-my-pi/blob/v18.12.2/packages/ai/src/auth/sqlite-credential-store.ts), [agent storage](https://github.com/can1357/oh-my-pi/blob/v18.12.2/packages/coding-agent/src/session/agent-storage.ts).

`fake-omp.mjs` is a synthetic offline CLI, not a recorded provider trace. All shared conformance cases run through the real adapter as `omp`; additional tests cover dialect framing, native retry/compaction, terminal/provider failures, unavailable/deleted/mismatched/moved sessions, secret/environment boundaries and settlement. Registry status is `conformance_passed`, not authenticated/live verification. No paid calls, dependencies, global harness edits, daemon or UI work were added. Milestones 0.5, 6.8 and the full Phase 6 live gate remain open; successful live sessions/streams, permissions/tool environment and resource interactions still need opt-in verification.


## Capability snapshots and preflight (Phase 6.6)

`npm run probe:harnesses` now uses the same isolated version/help factories as execution. It reports effective resume, model, reasoning and event-stream capabilities. Required launch features still gate factory creation; missing optional model/thinking/effort/resume selectors disable those features while permitting supported fresh work. Failed/truncated required evidence is never accepted. Failed optional Codex resume and OpenCode run/session evidence disables only the affected features. Exact flag matching avoids confusing `--session-dir` with `--session` or longer flags with supported ones.

`adapter.capabilities` describes this implemented transport, rather than every potential CLI feature. All current adapters report `supportsStructuredFinalOutput: false`: schema-constrained stdout reporting is not implemented. OpenCode retains `supportsEventStream: false`, and Pi retains `supportsPermissionMode: false` while using normal unrestricted tools. Reasoning support is now explicit metadata for the existing workflow field. Provider/model-specific reasoning availability, authentication and successful live sessions remain unproven.

The static compiler registry remains offline data. At preparation of each selected effective attempt, the service checks its actual adapter snapshot. Unsupported requested model/reasoning selection routes `system.spawn_error`; unsupported explicit resume routes `system.resume_unavailable`. Explanations survive into durable failure/attention records. Known adapter option/session validation messages are retained; arbitrary exceptions remain generic. No graph-wide upfront rejection, hidden retries, workflow fields or new permission gates were introduced. A clean missing report on a fresh invocation without correction support still produces `system.report_error`, without launching fresh correction.

Snapshots are made when factories run; recreate adapters after upgrading/replacing the CLI. Capability evidence cannot establish runtime session availability. Existing exact journal/API/CLI admission checks and deletion-race protections remain authoritative. No authentication or provider call is part of this milestone. Phase 6.7 boundary evidence is below; opt-in live smokes remain Phase 6.8 and Phase 0.5 remains open.

## Environment and diagnostic boundary audit (Phase 6.7)

This offline audit traced all five runtime factories/adapters, their event/session helpers, the OpenCode bridge, capability probes, reporting CLI/server and common supervisor. Existing explicit environment names listed above remain supported; no provider flags, global configuration or unrestricted permission choices changed.

| Owned subprocess | Environment source | Output boundary |
| --- | --- | --- |
| Codex | base allowlist + `CODEX_HOME`/`CODEX_API_KEY` + current report access and `wf` PATH | common per-channel filter, continuous JSONL observer, bounded captures/log |
| Pi | base + existing `PI_ENV_NAMES` + current report access and `wf` PATH | same common boundary; LF/session evidence preserved |
| omp | base + existing `OMP_ENV_NAMES` + current report access and `wf` PATH | same Pi-family boundary; omp terminal/journal rules preserved |
| Claude Code | base + existing Claude/Anthropic names + current report access and `wf` PATH | common boundary; stream-json evidence preserved |
| OpenCode Node bridge | base + existing OpenCode/provider names + current report access and `wf` PATH | common boundary; strict internal session/result/error protocol |
| OpenCode private server | explicitly reselect the bridge's OpenCode/base names and current report access, then add invocation-local `OPENCODE_PASSWORD` | separately scrub stdout/stderr before merging diagnostics; outer supervisor independently scrubs/caps evidence |
| Offline version/help probes | existing factory-specific deliberate environment and temporary config | same supervisor; separate bounded stdout/stderr; failed/truncated evidence stays failed |
| Ordinary workflow commands | unchanged base allowlist plus **all** explicit workflow `env` overrides | unchanged command output/capture behavior; no new harness restrictions |

The base list remains `PATH`, `HOME`, `LANG`, `LC_ALL`, `TERM`, `TMPDIR`, `USER`, `LOGNAME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`. OpenCode separately selects `XDG_CACHE_HOME` as before. Parent report tokens, arbitrary daemon variables, nested-harness markers and unselected provider credentials are withheld. Authentication through the selected environment or normal harness-managed stores remains supported; the runner does not inspect credential files. Synthetic CLI fixtures now also start from explicit temporary environments rather than inheriting real parent provider credentials.

Known injected key/token/password values and URL userinfo authorization are scrubbed in their literal, canonical JSON-escaped, URL component (upper/lower percent hex), form-encoded, Base64 and Base64url forms. OpenCode's `opencode:<private-password>` Basic representation is registered explicitly, and URL userinfo pairs cover Basic authorization. Arbitrary chunks and overlapping known values are handled against original bytes. Per-stream filtering precedes event parsing and bounded output capture; the disk log is filtered again after stdout/stderr merge. The nested OpenCode filter prevents interleaved credential fragments from evading outer matching. Its diagnostic merge retains short lines with at most 4 KiB pending per channel; long lines can interleave.

Report authorization remains invocation-scoped, rotated for correction, revoked on settlement/stop/shutdown and limited to one logical attempt. Known injected credentials and issued token values remain redaction/rejection-only memory until report-channel close, so correction and later same-channel attempts also scrub retired values. That history travels only in adapter memory/private bridge stdin, never argv, persisted input or child environment; only the current report token enters the child environment, alongside the existing selected provider credentials. Memory for known authorization grows with distinct injected values/channel invocations and is discarded on close. Adapters register their known process credentials with the channel synchronously before any request handler runs. Reports containing known injected credential/token representations are rejected without mutation; reports remain exactly v1. Runner-owned durable output/preflight/launch/session/diagnostic boundaries recheck registered credential/token representations as defense in depth.

Useful evidence stays available: stdout/stderr capture heads are 64 KiB each; `invocation_settled.data.diagnostics` retains at most 4096 UTF-8 bytes of scrubbed stderr plus capture-truncation flags; the combined stream file retains up to 16 MiB plus the cap marker. Original and correction logs use `.log` / `.log.correction`. Continuous adapter parsers still see terminal/session evidence beyond stdout capture. OpenCode retains its internal protocol/API summaries and server diagnostics; this does not add a provider/tool event stream. Combined stream logs may interleave channels and are not guaranteed replayable JSONL. Provider/protocol/process failures still bypass correction, and terminal events still require actual process/group/pipe settlement.

**Actual limit:** an allowlist is not isolation. Matching known values/representations cannot prove arbitrary user/provider text has no unknown secret. Credentials discovered inside a harness, custom/mixed/nested encodings, deliberately separated fragments and tokens from an earlier closed channel are outside matching coverage. Harness-owned transcripts/journals/config/auth and tool-created files are not rewritten. Unrestricted tools retain user access, and their further environment/resource behavior remains unverified. No paid/provider calls, credential-file inspection, global edits, dependencies or new approval gates were needed. Authentication/live success remains Phase 0.5/6.8; daemon/management/UI work remains deferred.

`npm run smoke:boundaries` independently exercises OpenCode's real bridge/server and Claude's real process adapter against synthetic local CLIs: successful same-session correction, provider failure without correction, known-secret output, selected environments, bounded durable diagnostics, sequential settlement and SQLite reopen. Normal tests exercise all five adapters' success/provider-error/nonzero paths, poisoned nested bridge environment, encoded report-token rejection, byte boundaries/overlap/Unicode, disk-log merge and cap behavior. All credentials in these fixtures are synthetic.


Final installed offline inventory for 6.7 again passed all five factories at the versions above. Default `/tmp` extraction of omp's native addon returned `EDQUOT`; repeating only the probe scratch directories under a disposable workspace `TMPDIR` passed and removed those directories. No installed/global setup or adapter workaround changed. The sequential full gate passed 667 tests; exact commands, the initial environmental failures and independent smoke results are in [implementation verification](implementation-log.md#phase-67--deliberate-child-environments-credential-scrubbing-and-bounded-diagnostics).

## Opt-in live smoke tooling (Phase 6.8)

`npm run smoke:harnesses -- --help` describes the separate developer-only command. Required selections: one registered `--harness`, explicit `--model`, `--scenario report|correction`, `--timeout-seconds 1..300`, absolute `--artifacts-dir`; optional `--reasoning-effort`. No default provider/model, all-harness sweep, workflow retry or fallback model. Without `--execute`, it prints the exact selection/invocation bound without probes, authentication checks or smoke artifacts; npm still builds `dist/` first. Ordinary build/test/check/inventory paths never execute a provider.

Execution reuses the real factory dispatch used by inventory, the common adapter/supervisor, `RunService`, private report server and SQLite inspection/reopen. Normal HOME/config/auth/resource discovery is preserved; only target projects and runner artifacts are disposable. Existing unrestricted permissions remain selected. This is not isolation: normal hooks/extensions/resources can execute, discover credentials, affect user files and make their own requests.

### Authentication admission

| Harness | Harness-owned check | Evidence retained |
| --- | --- | --- |
| Codex | `codex login status` | Exit 0: `available` (credentials present, not entitlement/provider success); exit 1: `unavailable` |
| Pi 1.3.0 | `pi auth check --model <selected-model> --no-refresh` | Exit 0: ready; exit 1: not ready; exit 2: invalid/check failure. No `--credentials`, key-printing or token-printing command |
| Claude Code | `claude auth status` | Documented exit 0: logged in; exit 1: not logged in. JSON/account output is discarded |
| OpenCode, omp | No status command implemented/assumed | `status_unsupported`, not a pass; explicit execution may still use normal locally configured authentication |

Both output channels have zero capture limit and no log path for these checks. Status commands use the existing explicit base/relevant harness environment selections, normal resource discovery, a 15-second supervisor timeout and no interactive authentication. Unexpected exits, spawn/signal/timeout failures block execution as `authentication_check_failed`; uncertain status-process cleanup blocks execution and preserves the target. An available status is not proof of billing entitlements or model availability. Unsupported checks never masquerade as successful verification; later provider failures remain failures.

Current official and installed documentation consulted:

- [Codex CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli#codex-login), plus installed `codex login --help`: status exits zero when credentials are present.
- [Pi v1.3.0 CLI credential commands](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/cli.md#credential-commands), plus the installed bundled `docs/cli.md`: `check` exit semantics, model selection and `--no-refresh`. No authentication check was run against the user's account during offline implementation.
- [Claude CLI reference](https://code.claude.com/docs/en/cli-reference), plus installed `claude auth status --help`: status JSON/exit semantics.
- [Codex model guidance](https://learn.chatgpt.com/docs/models) and installed Pi `docs/models.md` / `docs/providers.md`: explicit selectors and normal provider auth. Model entitlement was unverified during tooling implementation; the authorized Luna/low execution below now establishes success for these selections on this account. Context7 lookup was attempted but rejected its configured API key; official sources supplied the evidence.

### Scenarios and retained evidence

`report` requests one tool command: run the generated `smoke-report.mjs` using the runner's absolute Node executable. That helper invokes the real `wf report complete`, requires exit 0, writes a credential-free acknowledgment marker and remains alive briefly so acknowledgment precedes settlement. The workflow disables correction: a missing original report fails without another paid invocation.

`correction` deliberately replaces the fresh smoke prompt with a request to reply `READY` without tools/reporting. The normal runner may then issue exactly one report-only correction in the exact persisted session, capped at 30 seconds or the lower chosen timeout. The correction prompt requests the same helper. The tool requires two ordered cleanly settled invocations and matching original-settled/correction-start/correction-settled identities. An accidental original report, missing identity, unavailable resume, failed correction or missing acknowledgment fails this scenario; none is reported as verified incompatibility or a pass without actual evidence.

Success requires one logical attempt, one exact expected report/summary, durable acceptance before final settlement, declared `complete`, a completed run, real helper acknowledgment and a closed/reopened SQLite database preserving report/attempt/session/correction history. Only the existing runner decides whether the process/group/pipes settled. No raw `AgentHandle`, report-access object, injected secret list or inspected-state dump is serialized by the smoke tool.

Every admitted execution creates a mode-0700 `wf-<harness>-<scenario>-*` directory containing `evidence.json` (mode 0600), `state.sqlite` and adapter `logs/`. Evidence allowlists version, selected model/effort, effective capabilities, permission modes, outcome, status classification, invocation/correction counts, SHA-256 session fingerprints, acknowledgment and reopen results. Existing scrubbed 64-KiB captures, 4-KiB durable stderr and 16-MiB-per-invocation logs apply; correction logs remain separate. Known-value scrubbing does not recognize unknown credentials, and harness-owned transcripts/journals may contain tool environments; those files are not copied, rewritten or deleted.

Settled success/failure removes only its generated `project/`, preserving evidence/logs/SQLite for local review. `cleanup_uncertain` preserves the target too and never reports success. SIGINT/SIGTERM request the existing service stop and await settlement. Failure categories distinguish unsupported capability/probe, unavailable authentication, failed authentication check, adapter-signaled provider/protocol failure, execution failure, smoke assertion failure and uncertain cleanup. `provider_failure` reflects adapter `providerError` evidence (which can include protocol/transport errors), not proof that a billable request reached a provider. Inspect the scrubbed logs/SQLite for technical details; do not publish them without review.

<a id="proposed-live-pass--authorization-still-required"></a>

### Authorized live pass — Luna/low execution evidence

The account owner explicitly approved resuming these exact selections and bounds on 2026-10-19. Codex `gpt-6-luna` and Pi `openai/gpt-6-luna`, both at `low` reasoning, passed all four workflows below. Keep GPT smoke usage on Luna/low unless explicitly instructed otherwise; do not automatically upgrade models, increase reasoning or change providers. This supersedes the previously paused proposal, not its historical plan-only evidence.

```bash
export PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH
export TMPDIR=/home/phagmaier/.local/state/workflowz/live-smoke-6.8/scratch
mkdir -p "$TMPDIR"
for scenario in report correction; do
  npm run smoke:harnesses -- --execute --harness codex --model gpt-6-luna \
    --reasoning-effort low --scenario "$scenario" --timeout-seconds 60 \
    --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-6.8 || break
  npm run smoke:harnesses -- --execute --harness pi --model openai/gpt-6-luna \
    --reasoning-effort low --scenario "$scenario" --timeout-seconds 60 \
    --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-6.8 || break
done
```

Four standalone workflows; at most **six harness invocations** (two direct reports plus two pairs of original/correction), sequential, stop on the first failure. These are invocation bounds, not provider-request bounds: harness-native recovery, normal hooks/resources and multi-turn tool use may make additional requests. Four original invocations are each bounded to 60 seconds; two corrections to 30 seconds each: at most 300 seconds of configured agent execution, plus factory/status checks, build and process cleanup. Status checks are at most 15 seconds each; existing version/help probes have their own 15-second limits. This is not a total wall-clock deadline.

Targets were unique children of the named artifact parent (`wf-*/project`), never this checkout. Probe scratch used the named non-`/tmp` scratch directory. Normal auth HOME/config and unrestricted permission selections were retained; no credential files were inspected by the developer, no login/logout was performed and no global configuration was edited. The program removed all four settled targets while retaining evidence, logs, SQLite and harness-owned state. **There is no enforceable dollar cap in this tool**; time and invocation bounds do not guarantee a spend limit. Claude/OpenCode/omp provider execution was not authorized or performed.

Retained artifact parent: `/home/phagmaier/.local/state/workflowz/live-smoke-6.8`.

| Harness | Scenario | Invocations | Corrections | Result | Artifact directory |
| --- | --- | --- | --- | --- | --- |
| Codex | report | 1 | 0 | passed / complete | `wf-codex-report-blA2nZ` |
| Pi | report | 1 | 0 | passed / complete | `wf-pi-report-xGYhJE` |
| Codex | correction | 2 | 1 | passed / complete | `wf-codex-correction-6aUv2k` |
| Pi | correction | 2 | 1 | passed / complete | `wf-pi-correction-TeHAIg` |

Each retained `evidence.json` records authentication `available`, helper acknowledgment, durable reopen and target removal. Both correction runs have matching original/correction session fingerprints; their SQLite histories show original settlement, correction request, correction start, report acceptance and correction settlement in that order, with both exits zero. Original logs show `READY` without a report; correction logs show the helper invocation and clean terminal framing. Status admission alone is not entitlement evidence; the subsequent successful provider execution supplies evidence for these selected models on this account.

<a id="remaining-milestone-05-pass--proposal-only-not-authorized"></a>

### Remaining milestone 0.5 pass — authorized plan

After the preparation-only checks, the account owner explicitly approved these selections and bounds on 2026-10-19. The completed Codex/Pi pass above is unchanged. The first three report scenarios ran in order; execution stopped at omp's failure, so none of the three correction scenarios ran. The following preserves the authorized plan, not a claim that all six workflows passed; actual results and limits follow below.

| Harness | Installed offline version | Requested explicit model | Reasoning effort |
| --- | --- | --- | --- |
| Claude Code | `2.1.303` | `claude-haiku-5-5` | `low` |
| OpenCode | `2.0.32` | `openai/gpt-6-luna` | `low` (named variant) |
| omp | `18.12.2` | `openai/gpt-6-luna` | `low` |

Selection evidence and remaining risks:

- [Claude's model overview](https://platform.claude.com/docs/en/models/overview) identifies `claude-haiku-5-5` as a pinned snapshot, not a moving family alias. [Claude Code model configuration](https://code.claude.com/docs/en/model-config) documents Haiku 5.5 support from version 2.1.293 and `low` effort. This proposes a small model for a reporting-only task; it does not claim access on this account.
- [OpenCode v2 model documentation](https://opencode.ai/v2/docs/models) defines provider/model selection and named reasoning variants. The adapter maps the existing effort field to the `low` variant. Local Luna catalog/variant availability remains unverified; do not create custom model/config entries or switch providers to force success.
- [omp 18.12.2 CLI reference](https://github.com/can1357/oh-my-pi/blob/v18.12.2/docs/cli-reference.md) documents provider/model selection and `--thinking low`; its [model documentation](https://github.com/can1357/oh-my-pi/blob/v18.12.2/docs/models.md) describes configured catalog/resolution behavior. The proposed explicit provider-qualified selector preserves the account's Luna/low preference, but normal configuration and fuzzy resolution are not an exact-model guarantee. Local availability remains unverified.
- No runner retry, fallback model, provider switch, reasoning increase, login/logout, global config change or additional paid diagnostic run is included. If a selection is unavailable, stop and report the incompatibility.
- **Native substitution is not prevented by this smoke tool.** Claude documents that a restricted `--model` can be replaced by the default; normal harness configuration/resources may also alter model behavior or make auxiliary requests. Evidence records requested settings, not an attestation of every provider request. Review available actual-model evidence before claiming the selected model passed; any observed substitution invalidates that claim and stops the pass, but may already have incurred usage. OpenCode's current transport has no provider event stream, so do not invent actual-model evidence from the requested selector alone.

Exact authorized command plan, preserved for review. Only the first three smoke commands below ran; **do not restart or continue it without new authorization** after the stop-on-first-failure boundary:

```bash
export PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH
export TMPDIR=/home/phagmaier/.local/state/workflowz/live-smoke-0.5/scratch
mkdir -p "$TMPDIR"
```

Run the following commands **one at a time**, in this order; do not paste them as an unattended batch. After each command settles, inspect its scrubbed evidence/logs/SQLite before starting the next. Stop at the first failed smoke, uncertain cleanup or observed model substitution; do not add a diagnostic provider call.

```bash
npm run smoke:harnesses -- --execute --harness claude --model claude-haiku-5-5 --reasoning-effort low --scenario report --timeout-seconds 60 --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-0.5
npm run smoke:harnesses -- --execute --harness opencode --model openai/gpt-6-luna --reasoning-effort low --scenario report --timeout-seconds 60 --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-0.5
npm run smoke:harnesses -- --execute --harness omp --model openai/gpt-6-luna --reasoning-effort low --scenario report --timeout-seconds 60 --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-0.5
npm run smoke:harnesses -- --execute --harness claude --model claude-haiku-5-5 --reasoning-effort low --scenario correction --timeout-seconds 60 --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-0.5
npm run smoke:harnesses -- --execute --harness opencode --model openai/gpt-6-luna --reasoning-effort low --scenario correction --timeout-seconds 60 --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-0.5
npm run smoke:harnesses -- --execute --harness omp --model openai/gpt-6-luna --reasoning-effort low --scenario correction --timeout-seconds 60 --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-0.5
```

Bounds and acceptance:

- Six standalone workflows, in the shown order, at most **nine sequential harness invocations**, stop at the first failure. No repeat of Codex/Pi.
- Six originals at most 60 seconds each; three corrections at most 30 seconds each: **450 seconds maximum configured agent execution**, plus builds, version/help probes, status checks and process cleanup. This is neither a provider-request count nor a total wall-clock bound.
- Claude status admission uses the existing output-discarding `claude auth status` check (at most 15 seconds each execution). OpenCode/omp retain `status_unsupported`; successful provider execution, not that classification, would establish usable authentication for the exercised path.
- Normal HOME/auth/config/resources and existing unrestricted permission selections stay enabled. Targets are unique `wf-*/project` children under the named artifact parent, never this checkout. Retain private evidence/logs/SQLite and harness-owned state; remove only settled generated targets. Preserve uncertain targets and stop.
- **No enforceable dollar cap.** Native retries, tool turns, hooks/resources, auxiliary models or provider-side behavior can add requests/cost; an unavailable selection or failure does not authorize switching models or trying again.
- Each report workflow must complete through the real helper acknowledgment; each correction must prove exactly one clean same-session follow-up after the original omitted its report. Require one logical attempt, one exact accepted report, sequential settlement and durable SQLite reopen. Inspect scrubbed evidence before recording compatibility, and distinguish requested model from observed model.
- Milestone 0.5 remains unchecked until its per-harness evidence is reviewed against the acceptance criteria. Plan-only output, help flags, unsupported auth status or partial success cannot close it. Phase 7, daemon management, management CLI, UI and subagent delegation remain outside this preparation.

Preparation verification on 2026-10-19: all five isolated installed factories passed again with the versions above (Codex/Pi unchanged). All six smoke selections built and printed `execute: false`, the proposed exact model and `reasoningEffort: low`; report plans allowed one invocation and correction plans two with a 30-second correction bound. No authentication checks, provider calls or smoke artifact writes occurred. The temporary offline-probe scratch directory was removed. Context7 lookup rejected its configured API key; the linked official sources supplied documentation instead.

### Remaining milestone 0.5 results — stopped at omp authentication

Executed separately with Node.js v26.8.2, reviewing each result before advancing. Artifact parent: `/home/phagmaier/.local/state/workflowz/live-smoke-0.5`.

| Harness / scenario | Result | Invocations / corrections | Authentication classification | Artifact directory |
| --- | --- | --- | --- | --- |
| Claude / report | passed / `complete` | 1 / 0 | `available` | `wf-claude-report-p8hwmh` |
| OpenCode / report | passed / `complete` | 1 / 0 | `status_unsupported` | `wf-opencode-report-H5Cedr` |
| omp / report | `execution_failure` / `system.process_error` | 1 / 0 | `status_unsupported` | `wf-omp-report-qbmi0O` |

Claude `2.1.303` used requested `claude-haiku-5-5`/low and `bypassPermissions`. Its streamed assistant model and terminal `modelUsage.canonicalModel` both identify `claude-haiku-5-5`, with no other model usage reported. Actual helper acknowledgment, one accepted report before exit-zero settlement, completed run, durable reopen and settled-target removal passed. This establishes the exercised live reporting/tool path, not authenticated correction/resume.

OpenCode `2.0.32` completed its private API/helper/report path with requested `openai/gpt-6-luna`/low and `session-allow-all`. One accepted report preceded exit-zero settlement and run completion; helper acknowledgment, durable reopen and target removal passed. `status_unsupported` is not an authentication-status pass; successful execution establishes usable authentication for this path. The transport does not expose provider-model usage, so the requested Luna selector is **not independent proof of the actual model used**.

omp `18.12.2` launched once with requested `openai/gpt-6-luna`/low and `yolo`, then exited **1** with **`No API key found for openai.`** SQLite records one settled invocation, `system.process_error`, a paused run, one logical attempt and zero reports. No correction was requested, no report acknowledgment occurred and no durable session fingerprint was established. Cleanup settled and removed the generated target. This is a native credential-resolution failure, not evidence that Luna is unsupported, an adapter protocol defect or proof of a billable provider request. No credential file was inspected, login attempted, provider switched or retry added.

**Stopped after three invocations. All Claude/OpenCode/omp correction scenarios remain unrun.** The failed omp evidence does not claim the smoke's success-only durable-reopen assertion; separate read-only SQLite inspection recovered its paused history. Private evidence/logs/databases and scratch remain; harness-owned state was not copied, rewritten or removed.

**Observed diagnostic credential exposure:** OpenCode's normal MCP startup diagnostics included a configured MCP API key not known to the runner's injected-value scrubber. The value is deliberately omitted here and was not committed; do not publish the raw log or database. The containing artifact directory is mode 0700; the runner-owned log and database were additionally restricted to 0600 without rewriting their contents. This confirms the documented unknown-secret limitation, not an all-secrets scrub guarantee. Treat the exposed MCP key as sensitive and rotate/revoke it through its owner if valid; no global config/authentication change or automatic revocation was performed.

Milestone **0.5 stays unchecked** for the unverified correction/session paths and omp authentication. Phase 6's Codex/Pi gate remains satisfied. Any further execution requires new authorization; resolving omp credentials or selecting another provider is not authorized by this stopped pass.

### omp authentication prerequisite — offline findings

Investigated on 2026-10-19 without retrying the failed execution or inspecting user credentials/configuration. The installed 18.12.2 bundled provider documentation agrees with the versioned official references below.

- **Provider identity matters.** `openai/gpt-6-luna` selects provider `openai`; its documented environment credential is `OPENAI_API_KEY`. `openai-codex` is a separate provider whose environment credential is `OPENAI_CODEX_OAUTH_TOKEN`. Codex/Pi/current-assistant authentication is not evidence of an available credential for omp's `openai` provider. Changing to an `openai-codex/...` selector would be a provider change requiring new approval, not an authentication repair for the approved selector.
- **The selector exists in the versioned public catalog.** The v18.12.2 `models.json` entry for `openai/gpt-6-luna` specifies `openai-responses`, `https://api.openai.com/v1`, reasoning support and effort levels including `low`. This establishes bundled catalog metadata only—not this account's entitlement, effective local catalog/configuration, actual model usage or successful inference. Exact provider/model references precede fuzzy matching; preserve the explicit selector and verify actual-model evidence when available.
- **Credentials have precedence.** Documented resolution is runtime override, configured `models.yml` key, stored OAuth, login-sourced stored API key, extension config fallback, provider environment, then other stored API keys. Supplying an environment variable need not override higher-priority credentials. Profiles/config roots and auth-broker mode can change the active store. No active store, key value, profile setting or broker configuration was inspected.
- **No runner allowlist fix is indicated.** `src/adapters/pi.ts` already selects both `OPENAI_API_KEY` and `OPENAI_CODEX_OAUTH_TOKEN` for omp when supplied by the caller's environment, alongside the existing config/profile/broker names. The failed run proves only that native resolution found no usable credential for `openai` on that invocation; it does not identify which credential source was absent or why.
- **The disposable target changes project discovery.** omp documents launch-cwd `.env` discovery, followed by active agent/config-root/home `.env` files, with nonempty process values first. The smoke runs under its generated `wf-*/project`, not this checkout or another existing project. A key available only through another project's `.env` therefore cannot be assumed available to this path. This is a documented distinction, not an observed cause; no `.env` file was read or copied.

The owner-controlled prerequisite is usable authentication for **omp provider `openai`** in the normal environment/profile used by the smoke. The owner can provision it through their normal secret-management/harness setup; do not paste secrets into chat, put keys in workflow YAML/argv, copy another harness's auth files, add dummy credentials or change providers to bypass this prerequisite. No provisioning or login is authorized here. Native login can refresh the catalog online, so it is not an offline diagnostic. Catalog availability alone is not credential validation; no new auth/status/usage/model-refresh command was run against user state.

Sources:

- [v18.12.2 providers](https://github.com/can1357/oh-my-pi/blob/v18.12.2/docs/providers.md#credentials-and-precedence) — provider-scoped auth, precedence, provider environment mapping and dotenv discovery. Independently read with the installed binary's `read omp://docs/providers.md` command using empty inherited environment and disposable HOME/config/state/cache/cwd/TMPDIR.
- [v18.12.2 model resolution](https://github.com/can1357/oh-my-pi/blob/v18.12.2/docs/models.md#runtime-model-resolution) and [public bundled catalog](https://github.com/can1357/oh-my-pi/blob/v18.12.2/packages/catalog/src/models.json) — exact selector and Luna metadata, not a live account probe.
- [v18.12.2 environment reference](https://github.com/can1357/oh-my-pi/blob/v18.12.2/docs/environment-variables.md#1-modelprovider-authentication) and [CLI reference](https://github.com/can1357/oh-my-pi/blob/v18.12.2/docs/cli-reference.md#model-selection) — credential namespaces, discovery and model/thinking selectors.

Context7 again rejected its configured API key; public versioned sources and installed bundled documentation supplied the evidence. The isolated documentation command exited 0; its owned scratch directory was explicitly removed and absence checked. No normal harness state or retained live artifacts were opened, changed or published.

#### Minimal remaining execution proposal — not authorized

Only after owner-controlled authentication provisioning and **new explicit approval** of these exact selections/bounds:

| Order | Harness | Scenario | Model / effort | Maximum invocations |
| --- | --- | --- | --- | --- |
| 1 | omp | report | `openai/gpt-6-luna` / low | 1 |
| 2 | Claude Code | correction | `claude-haiku-5-5` / low | 2 |
| 3 | OpenCode | correction | `openai/gpt-6-luna` / low | 2 |
| 4 | omp | correction | `openai/gpt-6-luna` / low | 2 |

This omits successful Codex/Pi scenarios and successful Claude/OpenCode direct reports. Four standalone workflows, at most **seven sequential harness invocations**, originals at most 60 seconds and corrections at most 30 seconds: **330 seconds maximum configured agent execution**, excluding builds/probes/status/cleanup. Preserve the existing artifact parent, normal resources, unrestricted permissions, real helper acknowledgment, exact-session and durable-reopen assertions. Review each result before advancing; stop on first failure, uncertain cleanup or observed model substitution. No fallback, increased reasoning, provider switch, extra paid diagnostics or runner retries. Native retries/resources can add requests; no dollar cap is enforceable. OpenCode still lacks independent actual-model evidence and its private artifacts must not be published. This proposal authorizes neither provisioning nor execution; milestone 0.5 remains unchecked.

### Standing Meta Contributor selection and secret source

**Owner decision (2026-10-19): use `meta/muse-spark-1.3-contributor`, low reasoning, for OpenCode and omp. The credential is `MUSE_SPARK_API_KEY` in `~/.config/secrets.zsh`.** This supersedes the earlier OpenAI/Luna remaining-pass proposal for these two harnesses. Do not ask the owner again where the key is, request its value in chat, require a new OpenRouter account, or repeat the OpenAI authentication discussion. Codex/Pi's completed Luna evidence and Claude's Haiku selection are unchanged. These are local smoke preferences, not engine restrictions.

The owner explicitly approved Contributor mode and offline integration using the named secret source. Meta documents that Contributor-mode content (including submitted code, prompts and responses) may be used for model training in exchange for discounted API pricing. API usage is not assumed free or covered by a Muse subscription. No automatic switch to Standard mode, another model/provider or higher reasoning is authorized.

`npm run smoke:meta -- ...` is the reusable account-local entry point:

```bash
PATH=/home/phagmaier/.local/share/mise/installs/node/26.8.2/bin:$PATH \
npm run smoke:meta -- --harness omp --scenario report --timeout-seconds 60 \
  --artifacts-dir /home/phagmaier/.local/state/workflowz/live-smoke-meta
```

It accepts `omp|opencode`, `report|correction`, explicit timeout/artifact parent and optional `--execute`; model and low reasoning are pinned by this convenience command. The generic `smoke:harnesses` and workflow APIs remain unrestricted. Without `--execute`, it reads no secret, creates no smoke artifacts and runs no harness/probe/authentication/provider command; npm still builds first. Local named-key loading is approved and need not be reauthorized. **Paid execution still requires approval of the exact scenarios and bounds; neither the stopped pass nor offline integration approval resumes provider execution.**

Credential handling:

- Read only the named assignment from the approved source; never source/execute `secrets.zsh` or import its other keys. Accept one nonempty raw/single-/double-quoted literal assignment with optional `export` and comment. Reject missing, duplicate, expanded, escaped or command-bearing assignments with a fixed credential-free error. Single-quoted shell metacharacters remain literal data, not executable text.
- Open/fstat the source, require a current-user-owned regular file with no group/other permissions and at most 1 MiB. Initial metadata-only inspection found mode 0600 and one supported literal assignment; no value was printed, copied into repository files or included in tool output.
- Map the value to `MODEL_API_KEY` in the invocation's adapter environment without mutating `process.env`. Do not pass the original `MUSE_SPARK_API_KEY` alias to children. This imports only one key from the file, not every existing credential in the launcher's normal environment.
- omp already catalogs the exact Meta Contributor model. OpenCode gets a v2 `providers.meta` Responses configuration under the generated target's `.opencode/opencode.json`: environment-name reference only, explicit low variant and encrypted reasoning inclusion, no literal key. The normal target cleanup removes it after settlement. No global provider/config/auth files are edited.
- Both adapter environment boundaries now select `MODEL_API_KEY` and `META_API_KEY`; the existing filter registers them for stream/log/diagnostic scrubbing and report rejection. OpenCode reselects them for its private server too. Offline probes still receive neither key. Harness-owned stores/transcripts are not inspected or rewritten.

This is targeted developer tooling, not automatic credential discovery, a credential management service, isolation or a guarantee that arbitrary tools/resources cannot expose secrets. Preserve the prior OpenCode unknown-secret warning; do not publish raw artifacts. Loader readiness, catalog entries and synthetic fixtures do not establish account entitlement, live authentication, actual-model usage or exact-session provider compatibility. Milestone 0.5 remains unchecked.

Sources: [Meta API authentication](https://dev.meta.ai/docs/authentication), [Contributor pricing/data use](https://dev.meta.ai/docs/pricing-rate-limits), [Meta third-party agent integration and encrypted reasoning](https://dev.meta.ai/docs/coding-agents), [omp v18.12.2 catalog](https://github.com/can1357/oh-my-pi/blob/v18.12.2/packages/catalog/src/models.json), [omp credential mapping](https://github.com/can1357/oh-my-pi/blob/v18.12.2/docs/environment-variables.md), [OpenCode v2 providers](https://opencode.ai/v2/docs/providers) and [configuration schema](https://opencode.ai/config.json). Meta's example OpenCode config uses older `provider`/`npm` names; this implementation uses the v2 `providers`/`package` contract instead. Context7 remains unavailable because its configured API key is rejected.

Offline verification: the actual `meta-smoke-cli` command completed report and exact-session correction through each real adapter against synthetic CLIs, including real helper acknowledgment, SQLite reopen, removed targets and scrubbed synthetic credentials. Installed OpenCode `models --standalone` accepted the generated v2 configuration under an isolated home with a loopback-only fixture endpoint and synthetic key; it listed `meta/muse-spark-1.3-contributor` and made zero fixture requests. The approved real local loader also succeeded with its value withheld; this is not provider authentication. Full Node.js v26.8.2 gate: **704 tests, 77 suites, zero failures/cancellations/skips**, typecheck/lint passed. Exact verification and limits are in the implementation log.

#### Proposed Meta verification — no execution yet

Run omp report, OpenCode report, omp correction and OpenCode correction, each separately and reviewing evidence between commands. All use `meta/muse-spark-1.3-contributor`/low through `smoke:meta`. Four workflows, at most six sequential invocations, 60-second originals and 30-second corrections: at most 300 seconds configured agent execution plus builds/probes/cleanup. Stop at the first failure, uncertain cleanup or observed model substitution. No fallback, provider switch, increased reasoning, extra paid diagnosis or runner retry. No dollar cap; native retries/hooks/resources can add requests. New Meta direct reports are necessary because the earlier OpenCode success used another provider. Claude correction remains separate and unrun.
