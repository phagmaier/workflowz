# Harness compatibility reference

> Archived for the UI-focused reset on 2026-10-20. This is reference/history, not the current work plan or agent instructions. Use [DESIGN.md](../DESIGN.md) and [AGENTS.md](../AGENTS.md) for active direction.

This describes the implemented adapters. Version numbers and provider-backed results below
are recorded evidence from MVP development, not a fresh inspection of installed CLIs or accounts.
Use `npm run probe:harnesses` after changing a CLI: it uses isolated version/help factories,
without authentication checks or model calls. It cannot establish provider access or session availability.

## Implemented transports

| Harness | Recorded CLI version | Launch and completion evidence | Exact resume |
| --- | --- | --- | --- |
| `codex` | `0.163.0` | `codex exec --json`, JSONL terminal evidence | `codex exec resume` with persisted UUID |
| `pi` | `1.3.0`, `@earendil-works/pi-coding-agent` | `--print --mode json`, final non-aborted `agent_settled` | Validated journal UUID in its dedicated session directory |
| `omp` | `18.12.2`, oh-my-pi | `--print --mode json`, successful assistant and terminal `agent_end.isTerminal` | Validated absolute journal path via strict `--resume` |
| `opencode` | `2.0.32` | Invocation-local leased `serve --stdio`, v2 API admission/wait/persisted success | Exact existing session API; CLI `run --session` can create missing sessions and is not used |
| `claude` | `2.1.303` | Print/verbose stream JSON, terminal successful `result` | `--resume` with persisted UUID |

Prompts use stdin. A report or terminal event never settles an operation by itself: process exit,
group reaping and pipe closure must also complete. Outcomes come only from acknowledged `wf report`.
Resume is scoped to the same harness/run/task/revision and never silently creates a fresh session.
Clean missing reports permit at most one configured exact-session correction; original technical
failures bypass correction. See [architecture §4–5](architecture.md#4-agent-adapter-interface).

## Unrestricted mode used by the adapters

Adapters select these modes by default and record them in invocation events. There is no YAML
permission field or mandatory approval gate. The dashboard shows configured selections before
Start/Resume; actual invocation evidence is separate. Global harness settings are not rewritten.

| Harness | Setting | Notes |
| --- | --- | --- |
| `codex` | `--dangerously-bypass-approvals-and-sandbox` | Full-access execution |
| `pi` | No permission-mode flag | Normal unrestricted tools; registry permission-mode capability is false |
| `omp` | `--approval-mode yolo` | Explicit tool/user restrictions and provider policies still apply |
| `opencode` | Session rules `[{action: "*", resource: "*", effect: "allow"}]` | Audited as `session-allow-all`; rules apply after agent rules |
| `claude` | `--permission-mode bypassPermissions` | Session persistence stays enabled for exact resume |

This is user-level host access. Neither environment selection nor process supervision provides
isolation or rollback; escaped descendants and arbitrary external effects remain outside group ownership.

## Capabilities and models

The compiler checks static registry capabilities without spawning a CLI. Adapter factories expose
frozen installed/implemented capability snapshots; preparation checks the effective settings of
each attempt. Unsupported model/reasoning selection routes `system.spawn_error`; unsupported
explicit resume routes `system.resume_unavailable`, before provider execution or correction.
Missing optional correction support still permits fresh work. Recreate adapters after CLI changes.

All adapters advertise `supportsStructuredFinalOutput: false`; there is no stdout/file reporting
fallback. OpenCode also advertises `supportsEventStream: false`: its private API exposes bounded
invocation evidence, not provider text/tool streams. OpenCode models use `provider/model#variant`;
`reasoning_effort` supplies a named variant only with an explicit model lacking an embedded variant.
Conflicting selectors are rejected. Availability and actual provider behavior remain harness-owned.

## Authentication and selected environment

Install and authenticate harnesses through their own supported setup. Set supported environment
variables before starting the daemon; changing a client's shell does not change a running daemon.
The runner does not copy auth stores, log users in or pass its full parent environment to children.

Base names are `PATH`, `HOME`, `LANG`, `LC_ALL`, `TERM`, `TMPDIR`, `USER`, `LOGNAME`,
`XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_STATE_HOME`. Ordinary commands add every explicit
workflow `env` override. Keep secrets out of workflow files.

Additional selected names, when present:

| Harness | Names |
| --- | --- |
| Codex | `CODEX_HOME`, `CODEX_API_KEY` |
| Pi | `PI_CODING_AGENT_DIR`, `PI_OFFLINE`, `PI_TELEMETRY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_OAUTH_TOKEN`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` |
| omp | `PI_CODING_AGENT_DIR`, `PI_CONFIG_DIR`, `OMP_PROFILE`, `PI_NO_TITLE`, `OPENAI_API_KEY`, `OPENAI_CODEX_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_OAUTH_TOKEN`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OMP_AUTH_BROKER_URL`, `OMP_AUTH_BROKER_TOKEN`, `MODEL_API_KEY`, `META_API_KEY` |
| OpenCode | `XDG_CACHE_HOME`, `OPENCODE_CONFIG_DIR`, `OPENCODE_CONFIG`, `OPENCODE_DB`, `OPENCODE_DISABLE_MODELS_FETCH`, `OPENCODE_MODELS_PATH`, `OPENCODE_CONFIG_PROJECT_DISABLE`, `OPENCODE_DISABLE_CLAUDE_CODE`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENROUTER_API_KEY`, `MODEL_API_KEY`, `META_API_KEY` |
| Claude Code | `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` |

Report access and the project-local `wf` PATH are injected separately. OpenCode reselects the
environment for its private server and adds an invocation-local password. Codex invocation config
preserves reporting access for tools, excludes its API key from tool inheritance, and disables shell
snapshots. Other normal harness settings/hooks/resources remain in effect. Managed environment
scrubbing can interfere with report inheritance and needs verification in the actual setup.

The opt-in smoke tool uses credential-free output capture for Codex/Pi/Claude authentication
status; OpenCode/omp report `status_unsupported`. Status presence does not establish entitlement
or provider success. See [smoke tooling](development.md#provider-backed-smoke-tooling).

## Logs and verification limits

Known injected credentials, report tokens and specified JSON/URL/Base64 representations are
scrubbed before observers, capture and logs; reports containing those known values are rejected.
Per-invocation stdout/stderr capture heads are 64 KiB each, durable stderr diagnostics 4 KiB,
and combined stream logs 16 MiB plus a cap marker. Correction has its own log. Combined diagnostic
logs may interleave streams and are not guaranteed replayable JSONL.

Unknown credentials loaded inside harnesses/tools, arbitrary transformations and harness-managed
files/transcripts are outside that guarantee. A previous OpenCode diagnostic exposed an unknown
configured MCP credential; raw artifacts remain private and require review before sharing.

All five adapters have synthetic offline launch/report/session/settlement conformance coverage.
OpenCode's private HTTP wait follows the configured invocation supervision rather than an
HTTP client's implicit five-minute deadline. It does not follow redirects or retry API
mutations. Bridge protocol errors now include a safe category/code in saved Output and a
nonzero bridge exit; they remain technical failures that bypass report-only correction.
For the extended offline regression after building, run
`WF_TEST_OPENCODE_WAIT_MS=310000 node --test --test-name-pattern='allows delayed wait headers' dist/adapters/opencode.test.js`.
The ordinary suite uses a short delay; the extended form holds actual response headers for
310 seconds, without authentication or a provider call.
Recorded live reporting and exact-session correction passed for Codex/Pi, OpenCode/omp, and Claude
in their selected versions/accounts/models. These results do not verify every resource, provider,
tool, managed setting or future version. Source references, earlier failures and exact scoped
results are preserved in the [compatibility history](history/harness-compatibility.md) and
[implementation log](history/implementation-log.md).

## Local smoke selections

The existing account-specific developer preferences are Luna/low for Codex/Pi, Haiku/low for Claude,
and `meta/muse-spark-1.3-contributor`/low for OpenCode/omp. These are smoke preferences, not engine
restrictions or defaults for user workflows. `smoke:meta` pins its Meta selection and parses only
the literal `MUSE_SPARK_API_KEY` assignment from the previously selected `~/.config/secrets.zsh`;
it never sources the shell file. The key is mapped in memory to the adapter environment, with no
global config change. The previous source/selection decision remains recorded; no credential
value belongs in repository files or chat.

Contributor mode was selected with its data-use implications; the [historical decision and loader
details](history/harness-compatibility.md#standing-meta-contributor-selection-and-secret-source)
remain available. Completed paid passes do not authorize additional execution. The cleanup did not
inspect credentials, run probes, authenticate or call providers.
