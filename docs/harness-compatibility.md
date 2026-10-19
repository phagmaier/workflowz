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
