# Harness compatibility note

Probed on this machine with `npm run probe:harnesses` (offline: `--version` and each CLI's help text only; no model is called and no credentials are read). Re-run the probe after any CLI upgrade. Each row below records what the **installed** help text advertises and what the registry claims (`src/adapters/harness-registry.ts`).

| Harness | Installed version | Headless launch | Machine-readable stream | Session resume | Permission mode | Model selection |
| --- | --- | --- | --- | --- | --- | --- |
| `codex` | `codex-cli 0.163.0` | `codex exec [PROMPT]` | `--json` (JSONL) | `codex exec resume [SESSION_ID] [PROMPT]` or `--last` | `-s/--sandbox {read-only,workspace-write,danger-full-access}`; `--dangerously-bypass-approvals-and-sandbox` | `-m/--model` |
| `pi` | `1.3.0` | `pi --print --mode text\|json\|rpc` | `--mode json` / `--mode rpc` | `--continue`, `--resume`, `--session <path\|id>`, `--session-id <id>` | none advertised; only a tool allowlist (`--tools`) | `--model` |
| `omp` | `omp/18.12.2` | `omp --print --mode text\|json\|rpc\|rpc-ui` | `--mode json` / `--mode rpc` | `--resume <id>`, `--continue`, `--restore` | `--approval-mode always-ask\|write\|yolo`, `--auto-approve` | `--model` |
| `opencode` | `opencode v2.0.32` | `opencode run [message]` | `--format json` | `--session <id>` (creates the session if it does not exist), `--continue` | `--auto` (auto-approve anything not explicitly denied) | `--model provider/model` |
| `claude` | `2.1.303 (Claude Code)` | `claude --print` (`-p`) | `--output-format stream-json` | `--resume <session-id>`, `--session-id <uuid>` | `--permission-mode acceptEdits\|auto\|bypassPermissions\|manual\|dontAsk\|plan` | `--model` |

All five binaries advertised every marker in `HELP_PROBES` (`src/adapters/probe.ts`) on this machine.

## Notes that affect the adapters

- **codex.** `--ephemeral` exists. Correction turns depend on the session being persisted, so the adapter must not pass it. `--output-schema` is available for structured final output but is only a fallback; `wf report` stays the primary contract.
- **pi.** The help text lists no permission-mode flag. The registry therefore sets `supportsPermissionMode: false`. The user's Pi configuration decides tool permissions.
- **omp.** Shares Pi's `--mode` framing per the architecture note. The help text confirms the flags but not the event schema, so the Pi-family framing still needs live verification in the adapter's smoke test.
- **opencode.** The help text lists no `serve` subcommand. The one-shot `run --format json` path is the one the probe covers. The `service` subcommand manages a background server; the long-lived path was not evaluated.
- **claude.** `--output-format stream-json` is documented as requiring `--verbose` in the architecture note. The installed help text does not state that requirement, so the adapter must verify it (for example in its smoke test) rather than rely on either source. `--no-session-persistence` is documented as breaking resume, so the adapter must not pass it.

## Unrestricted mode used by the adapters

Chosen by the user: every adapter launches its harness in the unrestricted mode the CLI offers. The runner does not add approval gates or sandboxing, and it does not claim any isolation (spec §6). Each adapter records the mode it used in its attempt events.

| Harness | Unrestricted setting | Notes |
| --- | --- | --- |
| `codex` | `--dangerously-bypass-approvals-and-sandbox` | Help text calls this extremely dangerous and intended for externally sandboxed environments. The user has chosen it anyway. |
| `pi` | none; the flag set has no permission gate | Pi's default tool set is already unrestricted, so the adapter passes no flag. |
| `omp` | `--approval-mode yolo` | Alternatively `--auto-approve`. |
| `opencode` | `--auto` | Auto-approves anything not explicitly denied. |
| `claude` | `--permission-mode bypassPermissions` | `--dangerously-skip-permissions` is the flag form; the mode form also shows which mode was chosen. |

These are the flags seen in the installed help text. Confirm them in each adapter's conformance test.

## Authentication

The probe does not check authentication. `codex login status`, `claude auth status`, and `pi auth check --provider openai` each exited with status 0 when run once, but the meaning of that status was not verified for each CLI, and no output was kept. Authentication should be verified per adapter in its opt-in live smoke test, using the CLI's own status command and recording only pass or fail. Credentials are never read or stored by this project.

## Live verification (not yet done)

No paid model call has been made. The live smoke test for each adapter (todo 6.8) is the place to confirm event framing, the settle boundary, and resume behavior against the versions above.


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
