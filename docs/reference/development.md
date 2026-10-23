# Development reference

Use [README.md](../../README.md) for orientation and [AGENTS.md](../../AGENTS.md) for the
contribution workflow. [IMPROVEMENTS.md](../../IMPROVEMENTS.md) is the active backlog;
[the design](../DESIGN.md) and [user guide](../USER_GUIDE.md) describe current product behavior.
Run commands below from the repository root; package.json is authoritative for scripts.
Historical evaluations are evidence, not authorization for new live-provider calls.
Bundled third-party skills are excluded from Biome; product source/tests remain checked.

## Setup and commands

Requirements: Linux with `/proc`, Node.js 26 or newer (verified with v26.8.2) and npm (verified with 11.19.1). State databases require a local filesystem with reliable SQLite locks. The test suite runs offline and makes no model calls.

```bash
npm ci                       # install the exact versions in package-lock.json
npm run build                # compile TypeScript and build the React app (ui/)
bin/wf --help                # project-local CLI, after building
npm run check                # typecheck + Biome lint + tests (offline core gate)
npm run test:browser         # separate offline Chromium smoke; provision browser first, below
npm run typecheck            # tsc --noEmit for src/ and ui/, strict mode
npm run lint                 # Biome check (lint and formatting)
npm run format               # Biome auto-fix
npm test                     # build, then node:test over dist/**/*.test.js and ui/src/**/*.test.ts
npm run validate -- examples/overnight.yaml   # strict parse, compile, and path checks
npm run smoke:reporting      # real wf report + SQLite + fake-session correction, no model calls
npm run smoke:tasks          # immutable Markdown import + fake task loop + persisted context
npm run smoke:capabilities   # offline installed-feature preflight + real fixture reporting
npm run smoke:boundaries     # synthetic credential/environment/log boundaries + real reporting
npm run smoke:recovery       # real owner SIGKILL + process identity + no replay, offline
npm run smoke:harnesses -- --help  # opt-in live tool; no provider execution without --execute
npm run probe:harnesses      # isolated factory capability probes of codex, pi, omp, opencode, claude
```

Process tests start real children: `sh`, `sleep`, and `node`. Linux `/proc` is required for supervised process identity; unsupported identity environments fail before launch.

`npm run validate` exits 0 for a runnable workflow (warnings allowed), 1 when it has errors, and 2 when the file cannot be read. Diagnostics are printed as `file:line:column: severity [code] path: message`.

## Verification by change

Use this matrix when defining the selected finding's acceptance checks. `package.json` owns
the command definitions; record the exact commands and results in IMPROVEMENTS.md.

| Change | Required verification | When to expand |
| --- | --- | --- |
| Documentation or agent instructions | Check local links/anchors and referenced commands/paths. Validate affected workflow examples offline. | Execute a runnable recipe and its meaningful failure case when adding executable guidance. |
| Workbench UI | Meaningful regression, `npm run check`, relevant `npm run test:browser -- <specs>`, visual review, keyboard/focus and responsive checks for the changed interaction. | Run the full browser suite when shared shell, navigation, focus or editor changes have effects beyond the focused scenarios. |
| Runtime, persistence, authority or adapter behavior | Meaningful regression and `npm run check`, including the affected lifecycle, settlement, timeout/Stop, recovery and redaction cases. | Add the relevant offline smoke from Setup and commands when the change crosses its process/service boundary; use browser scenarios for changed UI/API behavior. |
| Workflow/schema or runnable examples | Validate affected YAML with the actual CLI; exercise changed command behavior in private disposable state. | Include author-facing success/failure evidence and the relevant browser/runtime checks for the executable paths the example promises. |

First run the focused regression against the defect, then verify the fix. Run the core gate
and Chromium suite sequentially: both launch supervised children, and running them together
has killed a browser worker under local resource pressure. Once the selected checks pass,
repeat or broaden them when a new change, failure or uncovered behavior warrants it.
Record untested browsers, manual owner checks and live-provider limits explicitly.

## Offline Chromium smoke prerequisites

Use the Playwright version pinned in `package-lock.json`. Install dependencies
with `npm ci`, then provision that version's Chromium explicitly, before running the suite:

```bash
./node_modules/.bin/playwright install chromium --no-shell
npm run test:browser
# Optional: npm run test:browser -- --headed
```

The command builds the real application and runs bounded Chromium scenarios for the React
interface (`test/browser/*.spec.mjs`, including the owner-walkthrough regression), sequentially,
with no test retries. It never installs packages/browsers or invokes a provider. A missing browser
fails with provisioning guidance. `npm run check` remains browser-independent and offline.

Linux needs `/proc`, `sh`, and Chromium's shared libraries/fonts (including NSS, ATK/AT-SPI,
X11/XCB, xkbcommon, CUPS, DRM/GBM, Pango/Cairo and ALSA). On officially supported Debian/Ubuntu,
the explicit administrator provisioning command is
`./node_modules/.bin/playwright install-deps chromium`; **the smoke command never runs it**.
Other distributions must provide equivalent packages themselves. Headless execution needs no
display server; `--headed` needs a display. Browser binaries normally live in Playwright's user
cache; set `PLAYWRIGHT_BROWSERS_PATH` consistently during provisioning and execution to choose
another location. Never point tests at a personal browser profile.

See the current official [browser provisioning](https://playwright.dev/docs/browsers),
[Linux support](https://playwright.dev/docs/intro#system-requirements) and
[isolated fixture](https://playwright.dev/docs/test-fixtures) documentation. The smoke uses the
full pinned Chromium via its `chromium` channel, not an arbitrary installed Chrome.

Each scenario starts an owned foreground daemon process with scripted test adapters or a
real adapter pointed explicitly at a repository fake CLI, a temporary project/database, and
ordinary UI pairing. Installed harnesses and providers are never invoked. The failure scenarios
exercise the real OpenCode bridge against its fake local API server through settlement,
history, the run heading and saved Output. Fake reports use the actual supervised
child and `wf report`; no production fake-provider switch or fixture-control endpoint exists.
Read-only durable inspection occurs after owner exit. Teardown closes owned tabs, stops active
work through existing controls, reaps the owner/children, checks listener/discovery removal,
and removes owned state and runner output on success or failure. Uncertain cleanup preserves
state and fails rather than deleting evidence. No browser profile, trace, video or credential
artifact is retained.

`npm run test:browser -- app-acceptance.spec.mjs` verifies the optional
[browser acceptance recipe](../../examples/browser-acceptance/README.md) through ordinary
command steps. A private synthetic form target has broken/fixed input-retention variants;
API/page checks pass in both, while the authored browser command fails/passes respectively.
The fixture supplies the provisioned browser cache explicitly to the runner's private HOME,
uses fresh contexts, and removes its owned records and in-memory target on settlement.

## Local application commands

After building, `bin/wf daemon start` starts the explicit foreground owner. A separate terminal
using the same state directory can run `bin/wf ui` to obtain the local address and one-use pairing
code. The React interface is served at `/ui/`; old `/ui/app/` hash bookmarks redirect there.
The [user guide](../USER_GUIDE.md) describes the current UI. `WF_SHOTS=DIR npm run test:browser` saves
credential-free screenshots for visual review. `bin/wf daemon stop` requests graceful shutdown after the current step; the owner may still
be draining when that client returns. `bin/wf --help` lists management commands.

State selection is `--state-dir DIR` > `WF_STATE_DIR` >
`${XDG_STATE_HOME:-~/.local/state}/workflowz`. Use a private current-user-owned directory (0700).
Tests use disposable state; do not point fixtures at personal runner state. Never remove live
SQLite/discovery/lease files to force a takeover. See [ownership and recovery](architecture.md#7-process-lifecycle-and-crash-recovery).

## Provider-backed smoke tooling

Ordinary build/check/test/browser commands never execute providers. `npm run probe:harnesses`
uses isolated offline version/help probes; it does not verify authentication or model access.

`npm run smoke:harnesses -- --help` describes explicit harness/model/scenario/time/artifact
selection. Without `--execute`, the command prints a plan after building; it makes no provider
calls or authentication checks and creates no smoke artifacts. Adding `--execute` can incur
charges and runs normal harness resources with their configured user-level access. Timeouts
bound supervision, not billing or arbitrary external effects.

The account-specific `smoke:meta` convenience command retains its existing pinned selection and
literal named-key loader. It is not generic workflow configuration. See [compatibility and local
smoke selections](harness-compatibility.md#local-smoke-selections) before using it. Completed live
runs in the archive do not authorize additional executions. Keep artifacts private: known-value
redaction cannot identify every secret loaded by harnesses or tools.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `src/contracts/` | Strict YAML/report/control contracts and validation |
| `src/engine/` | Compiler, routing, reducer and coordinator |
| `src/store/` | SQLite ownership, migrations, transactions and persistence |
| `src/adapters/` | Harness integration, process supervision, probes and environment/log boundaries |
| `src/runner/` | Sequential execution, preparation, reporting, task import and recovery |
| `src/app/` | CLI entry points, daemon and management/browser application services |
| `ui/` | React + TypeScript browser UI, built into `dist/ui-app/` by Vite |
| `src/test-support/`, `test/fixtures/` | Offline fake adapters and process/workflow fixtures |
| `test/browser/` | Disposable daemon/Chromium scenarios |
| `examples/` | Valid sample definitions and illustrative task inputs |
| `docs/` | User/design guides, technical references and archived evaluations/history |

`src/architecture.test.ts` verifies import boundaries. SQLite uses built-in `node:sqlite`; core
unit/integration tests use `node:test`. Dependency versions are authoritative in `package.json`
and `package-lock.json`, rather than a separately maintained version table.
