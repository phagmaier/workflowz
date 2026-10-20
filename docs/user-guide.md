# Agent Workflow Runner — user guide

Run a local workflow, inspect its history, and recover deliberately when execution
is interrupted. This is the operator entry point; the [schema reference](schema-v1.md),
[architecture](../architecture.md), [harness compatibility evidence](harness-compatibility.md)
and [sample inventory](../examples/README.md) contain the detailed contracts.

## Contents

1. [What the runner does](#1-what-the-runner-does)
2. [Requirements and installation](#2-requirements-and-installation)
3. [Configuration and private state](#3-configuration-and-private-state)
4. [Quick start without a provider](#4-quick-start-without-a-provider)
5. [Author and import workflows and tasks](#5-author-and-import-workflows-and-tasks)
6. [Start the daemon and launch the UI](#6-start-the-daemon-and-launch-the-ui)
7. [Run and monitor](#7-run-and-monitor)
8. [Intervene and recover](#8-intervene-and-recover)
9. [Set up harnesses and diagnose adapters](#9-set-up-harnesses-and-diagnose-adapters)
10. [Troubleshooting](#10-troubleshooting)
11. [Shutdown, cleanup and deferred scope](#11-shutdown-cleanup-and-deferred-scope)

## 1. What the runner does

The runner follows a user-authored deterministic graph of command, agent, task and
end steps. There is **no supervisor LLM**. Reviews, tests, commits and human
checkpoints run only when the workflow author includes them. A valid agent report
is an input to routing, not a certification of code quality.

One foreground daemon owns local SQLite state. Within that state database, only
one run and one command/agent operation execute at a time; multiple saved runs may
be inspected. The browser and CLI are clients, not execution owners.

**Not a sandbox, rollback system or isolation boundary.** Commands and unrestricted
agents can change anything accessible to the user, including files outside the
project. Same-user processes can access private user files. Stopping a run does
not undo changes. Process groups cannot contain descendants that deliberately
escape them. The runner cannot guarantee exactly-once external side effects.

A crash never authorizes automatic replay, report routing, correction or signals.
Startup marks uncertain work interrupted; the operator must inspect and choose a
recovery disposition before explicitly resuming.

## 2. Requirements and installation

- Linux with readable `/proc` for process identity and supervision.
- Node.js **26+**; verified development runtime **v26.8.2**.
- npm; verified **11.19.1**.
- A local filesystem with reliable SQLite locks. Network filesystems and hard-link
  database aliases are unsupported.
- `sh`, `sleep` and `node` for the offline process tests; Git for the command-only
  sample. Agent workflows additionally need their chosen harness binaries on the
  daemon's `PATH`.

From the repository root:

```bash
node --version
npm --version
npm ci
npm run build
bin/wf --help
```

`npm ci` installs the lockfile's project-local dependencies and may need network
access or a populated npm cache. It is an installation step, not part of an
already-provisioned offline run. Do not replace global harness installations or
configuration to install this tool. SQLite uses Node's built-in `node:sqlite`;
there is no separate database server or native SQLite build step.

Use the project-local **`bin/wf`**, not an assumed globally installed `wf`. Build
again after updating the checkout; the executable loads compiled files in `dist/`.
The optional offline core gate is:

```bash
npm run check
```

It typechecks, lints, builds and runs the full offline test suite without calling
providers. It neither needs nor provisions Chromium. `npm run test:browser` is a
separate developer smoke requiring the lockfile-matched Playwright Chromium and
Linux shared libraries/fonts. Provisioning browsers/libraries is an explicit,
potentially online operation; see [Chromium prerequisites](../README.md#offline-chromium-smoke-prerequisites).
No browser automation is needed for ordinary UI use.

Harness CLIs are **installed and authenticated separately** through their own
supported setup. The runner does not install them, log them in, copy auth stores
or supply provider entitlements. Do not put credentials in workflows or reports.

## 3. Configuration and private state

There is **no application config file**. State selection, highest precedence first:

1. `bin/wf --state-dir DIR ...`
2. `WF_STATE_DIR`
3. `${XDG_STATE_HOME:-~/.local/state}/workflowz`

Use the same selection for the daemon and every management client. Relative state
paths resolve from the client's current directory; absolute paths avoid ambiguity.
A blank explicit path or blank `WF_STATE_DIR` is an error, not a fallback request.

The state directory must belong to the current user and be private; use mode
**0700**. A new directory is created that way. A directory symlink is accepted only
through its canonical private target; it does not create another owner.
Database file symlinks, including links to not-yet-created files, share the eventual
target's writer lease. Create target parent directories before startup.

| Entry | Purpose / handling |
| --- | --- |
| `state.sqlite` | Authoritative runs, immutable revisions, tasks, reports and events |
| SQLite WAL/SHM files | Live SQLite transaction state; do not remove while owned |
| `state.sqlite.runner-lock` | Kernel-backed exclusive writer lease; never unlink it to force takeover |
| `logs/` | Attempt logs and adapter session artifacts; retain for local diagnosis |
| `daemon.json` | Private port/token discovery, published atomically by the owner, mode 0600 |

**Never publish `daemon.json`, pairing codes, report tokens, credentials or raw
artifacts without review.** Discovery must be an owner-only regular file, not a
symlink, and at most 4096 bytes. A stale file does not establish ownership or permit
lease takeover. Only an explicitly started owner that acquires the database lease
publishes fresh discovery.

Workflow configuration belongs in YAML: project paths, stages, model/reasoning,
transitions and optional limits. Use [accepted schema fields](schema-v1.md#accepted-fields),
not illustrative design snippets. For example, the implemented duration field is
`timeout_seconds`, not `timeout`, and agent steps require `session: fresh` or
`session: resume`.

Authentication and tool permissions remain harness-owned. Adapters deliberately
select each harness's unrestricted mode by default; there is no YAML permission
field or mandatory approval gate. See [permission selections](harness-compatibility.md#unrestricted-mode-used-by-the-adapters).
The daemon passes a selected environment, not its full shell environment. Set
supported harness environment variables **before starting the daemon**; changing a
client shell does not change an existing daemon's environment. See the compatibility
reference for each adapter's selected names. Environment selection is not isolation.

## 4. Quick start without a provider

This walkthrough uses [command-only.yaml](../examples/command-only.yaml):
`node --version`, `git status --short`, then end. It has no agents or tasks and does
not mutate the repository. Its output can reveal local filenames. **Other samples
may launch paid providers or stage/commit changes when started.** Validation alone
never executes workflow steps.

Run from this checkout's root after installation. In terminal A, build, allocate a
private disposable state directory, print its path for terminal B, and keep the
daemon in the foreground:

```bash
npm run build
mkdir -p /tmp/opencode
export WF_STATE_DIR="$(mktemp -d /tmp/opencode/wf-quickstart-XXXXXX)"
printf '%s\n' "$WF_STATE_DIR"
bin/wf daemon start
```

In terminal B, from the same checkout, set `WF_STATE_DIR` to the **exact printed
absolute path** (replace the example suffix; do not allocate another directory):

```bash
export WF_STATE_DIR=/tmp/opencode/wf-quickstart-REPLACE
bin/wf daemon status
bin/wf workflow validate examples/command-only.yaml
bin/wf --json run create examples/command-only.yaml
```

Create returns `{"runId":"..."}` for a **ready** run. Set the returned ID, inspect
it, then use that inspection's numeric `expectedEventId`:

```bash
RUN_ID='REPLACE_WITH_RETURNED_RUN_ID'
bin/wf --json run status "$RUN_ID"
EVENT_ID=123  # replace with the inspected expectedEventId
bin/wf run start "$RUN_ID" --expected-event "$EVENT_ID"
bin/wf --json run status "$RUN_ID"
bin/wf --json run events "$RUN_ID" --after 0 --limit 100
bin/wf --json run tasks "$RUN_ID"
bin/wf --json run reports "$RUN_ID"
```

Poll `run status` until `run.status` is `completed`. Expect successful
`node_version` and `git_status` attempts, a final `done` cursor and no tasks/reports.
Start acknowledges admission, not completion. Create/import/preview never execute;
**start/resume do**.

`expectedEventId` is the last event for the inspected run, not a step number.
Every existing-run control uses that cursor. Events can arrive between inspection
and control; stale requests are rejected rather than applied to changed state.
Inspect again and reconsider the action; never blindly increment the ID or retry.

To finish:

```bash
bin/wf daemon stop
```

This acknowledges graceful shutdown; wait for terminal A's foreground command to
exit. `daemon.json` should then be absent. Do not issue `run stop` against an
already completed run; it is terminal. For a deliberate cancellation before
execution, create a second ready run, inspect its event ID, and use the `run stop`
command in [Intervention](#normal-controls-and-manual-overrides).

Keep the disposable state for inspection or, **only after owner exit and confirmed
absence of owned work**, remove the exact directory allocated above. Never remove
a live database, discovery or lease to make a failed command succeed. For regular
use choose a persistent private state directory instead of `/tmp`.

## 5. Author and import workflows and tasks

### Validate and save a definition

Start with the [sample inventory](../examples/README.md), choosing read-only or
mutating behavior deliberately. The full field/transition/placeholder contract is
in [schema v1](schema-v1.md). Commands use argv arrays without an implicit shell;
shell syntax requires explicitly invoking a shell. Changing directory inside one
command does not affect later steps.

Validate without a daemon:

```bash
bin/wf workflow validate path/to/workflow.yaml
# Equivalent development validator (builds first):
npm run validate -- path/to/workflow.yaml
```

Diagnostics use `file:line:column: severity [code] path: message`. Exit **0** means
valid (warnings allowed), **1** invalid, **2** unreadable input or malformed CLI
usage. Fix errors before creating a run; inspect warnings such as unbounded cycles
rather than interpreting validity as a safety assessment.

With the daemon running, save an immutable revision and create a run from it:

```bash
bin/wf workflow import path/to/workflow.yaml
bin/wf workflow list
bin/wf run create --revision 1  # replace 1 with the returned revisionId
bin/wf run list
```

Alternatively, `run create path/to/workflow.yaml` saves/selects a revision and
creates a ready run directly. Revisions preserve exact definition text and its
original absolute source directory; identical text/directory can reuse an ID.
Runs have independent task snapshots, progress and history. Saving a revision does
not start a run or update an existing run. There is no mutable named-workflow CRUD
or automatic task refresh behind these commands.

### Resolve project and input paths

- `project.root` resolves relative to the original workflow file's directory.
- Relative checklist, project/step instruction, `prompt_file` and step `cwd` paths
  resolve against the resulting project root, **not** the shell's current directory.
  Absolute paths remain absolute. `cwd` defaults to project root.
- `{{run.cwd}}` currently means project root; a subprocess `cd` does not redefine it.
- Project instructions precede step instructions. Each attempt reads current
  configured instruction/prompt files and freezes its assembled input; earlier
  attempts retain their historical content. No implicit full transcript is added.
- Explicit missing placeholder values fail before launch; they are not empty-string
  fallbacks. Selected report context with no history yet is omitted instead.

Saved revisions retain their original directory even when a later CLI command is
run elsewhere. A revision of an existing run also resolves paths against that
original directory, not the directory containing the replacement YAML file.

### Import a Markdown checklist

Configure the source in YAML, relative to project root:

```yaml
tasks:
  source:
    kind: markdown_checklist
    path: todo.md
```

Use a workflow containing `task.next` and explicit `task.complete` as in
[task-loop.yaml](../examples/task-loop.yaml). Do not start that agent sample until
you have reviewed its provider/mutation prerequisites.

```bash
bin/wf tasks preview path/to/workflow.yaml
bin/wf tasks preview path/to/workflow.yaml --include-completed
bin/wf run create path/to/workflow.yaml
# Deliberately include prechecked items as pending work:
bin/wf run create path/to/workflow.yaml --include-completed
```

Preview shows total, prechecked and runnable counts without creating anything.
Creation rereads and freezes the actual Markdown text/hash and inclusion setting;
a preview is not authoritative. The parser accepts ordinary hyphen/asterisk
checkboxes, keeps source order, headings and continuation text, and treats nested
items as independent tasks, not dependencies. Prechecked items are excluded by
default; `--include-completed` queues them as pending while retaining original
check state. IDs are stable within that run, not a synchronization key across runs.
See [parser limits](schema-v1.md#task-import-and-context-decisions-phase-5154).

Editing the Markdown later does not change an existing run, and the runner does
not write completion back to it. Existing runs can start/resume/revise without
the consumed checklist still being present; other live referenced inputs retain
validation. Creating another run from a saved revision reads the **current**
checklist at its saved location. There is no automatic or manual in-place task
re-import command; create a new run for a new snapshot.

## 6. Start the daemon and launch the UI

The daemon must be explicitly started and kept alive. It does not auto-start,
detach or install a background service:

```bash
bin/wf --state-dir /absolute/private/state daemon start
# Another terminal, same state directory:
bin/wf --state-dir /absolute/private/state ui
```

Open the printed `http://127.0.0.1:PORT/ui/` address and enter the separately printed
pairing code. The command prints an address; it does not launch your browser.
The port is ephemeral; there is no implemented fixed-port flag.

- Codes work once and expire after **five minutes**. Requesting a new code
  invalidates the unused previous one.
- Pairing rotates the single browser session, whose lifetime is **12 hours**.
  Logout revokes the session; daemon restart revokes sessions and codes. Pair again
  after restart or expiry. Do not share codes or `wf ui --json` output.
- Browser cookie authority is separate from management bearer authority and
  attempt-scoped report authority. Do not paste daemon/report tokens into the page.
- Use the exact printed loopback address, not a substituted `localhost`, remote
  proxy or forwarded hostname; Host/Origin checks are intentionally strict.
- Closing/reloading/logging out of the tab does **not** stop, pause or cancel work.

### Prepare and operate in the browser

1. Select a saved immutable revision, upload YAML, or enter the original absolute
   directory and choose **New workflow in this directory**. Browsers cannot infer
   an uploaded file's original path.
2. Choose the absolute project root, ordered instructions and optional checklist;
   explicitly choose whether to include prechecked items. Preview tasks read-only.
3. Edit stages/transitions/policies visually or edit YAML. Stable IDs and `start` /
   `goto` determine execution, not display order. Apply a visual field group before
   leaving it. YAML text is authoritative; after text edits choose **Validate YAML
   draft** before saving/creating. Invalid text is retained for correction.
4. Save an immutable workflow revision; import/create tasks into a ready run.
   Neither action executes. Unsaved drafts disappear on reload; saved runs do not.
5. Inspect the run dashboard, review effective harness/model/reasoning and inputs,
   and the configured permission modes shown for every agent stage in the selected
   revision, even before a task/engine cursor reaches an agent. Commands and
   unrestricted tools can modify any user-accessible files, including outside the
   project; no isolation or rollback is provided. Selection is configuration;
   invocation events separately record observed launch evidence.
   Then deliberately **Start**. Agent starts/resumes can incur charges.
6. Inspect current task/stage, elapsed time, accepted reports, events and attention.
   Use **Pause after current**, **Stop now**, or reasoned **Resume** as appropriate.

A rejected/ambiguous control disables execution controls until **Refresh run**.
Do not repeat a mutation merely because its response was lost. Paused revision and
manual intervention controls explain their consequences and leave execution
paused; details are below. Per-task settings and all interrupted recovery,
termination/cleanup-confirmation/disposition authority remain in the **CLI**.
The dashboard cannot bypass process/recovery barriers.

## 7. Run and monitor

### Lifecycle and inspection

Created runs are `ready`. Explicit start enters `running`; a pause request can
show `pausing` until the current operation settles, then `paused`. Reaching `end`
means `completed`; explicit stop means `stopped`. Uncertain startup work becomes
`interrupted`. Completed/stopped runs are terminal, not resumable. There is no
automatic driving after daemon restart, even for saved retry waits.

```bash
bin/wf --json run status RUN_ID
bin/wf --json run tasks RUN_ID
bin/wf --json run reports RUN_ID
bin/wf --json run events RUN_ID --after 0 --limit 100
```

Status contains `run` (including `status`, `revisionId`, `cursorStepId`,
`activeTaskId`, `retryNotBefore`), `expectedEventId`, `activeAttempt`, effective
`current` kind/harness/model/reasoning, `configuredPermissions` (agent step ID,
harness and selected mode), `elapsedMs`, `progress`, `tasks`,
`latestReport`, `attention` and `driveFailure`. Active settings are frozen attempt
settings; paused settings reflect current task parameters. Elapsed wall time
includes pauses and downtime, not just provider execution.

Events use increasing global `eventId`s filtered to the run. `--after` is exclusive
and defaults to **0**; `--limit` defaults to **100**, allowed **1–1000**. JSON returns
`{events,nextAfter,hasMore}`. Fetch subsequent pages using `nextAfter` until
`hasMore` is false; gaps in IDs are normal. There is no live event-stream endpoint.
The dashboard polls every two seconds, fetches 100 events per page and retains at
most 300 fetched events on screen; use CLI pagination for older history.

For imported queues, progress counts engine-accepted completed tasks / imported
runnable total. `task.complete` or deliberate manual completion advances that
count; an accepted agent report alone does not. Empty queues show counts without
a percentage. Graph-only workflows have `progress: null` and **no percentage**.
Attention items preserve category/severity, message and originating attempt IDs;
inspect them alongside reports/events before choosing continuation.

### Reports and settlement

Agents receive the declared outcomes and report instructions. Inside their
runner-provided environment they submit, for example:

```bash
wf report complete --summary "Finished the requested work" --handoff-file handoff.md
```

This is not an operator run-control command. The injected `WF_REPORT_ENDPOINT` and
`WF_REPORT_TOKEN` authorize one attempt invocation only, never management. The
body is exactly `{outcome,summary,issue?,handoff?,data?}`; no IDs or transitions.
`outcome` must be declared by that step, `summary` nonblank. The helper waits for
acknowledgment; exit 0 means accepted, nonzero means rejected/failed, not routing.
The first accepted report is immutable; stdout/final model text has no report
authority and no structured-final-output fallback is implemented.

An accepted report **does not advance execution until the process, group and
streams settle cleanly**. Original provider/process/protocol/spawn/timeout failures
route their system error even if a report was accepted; retained reports remain
diagnostic evidence.

A clean execution without a valid report permits **at most one** same-session,
report-only correction (default budget 1, optionally 0), capped at 30 seconds or a
lower remaining limit. Missing identity/resume support or failed correction routes
`system.report_error`, pausing by default unless authored routing says otherwise.
Provider/process failures in the original invocation do **not** trigger correction.
A stage retry is separate, must be explicitly authored and can repeat side effects.

For exact UTF-8 bounds, JSON depth/node limits, token lifecycle and HTTP codes see
[reporting decisions](schema-v1.md#reporting-decisions-phase-4).

### Limits and retries

Optional workflow limits bound committed step executions, total elapsed wall time
and agent stdout/stderr silence. Resume/revision/restart do not replenish counters
or reset the original start time. Increase an exhausted limit through a validated
revision before resuming. `retry.max_attempts` includes the first execution; retry
backoff is durable (`run.retryNotBefore`) and no new attempt starts before it is
due. Explicit pause/restart does not erase the remaining wait.

Idle timeout is activity detection, not useful-progress detection. Any output
resets it; silent legitimate work can time out. It applies to agents/correction,
not commands, and OpenCode's minimal API exposes less activity. See the
[limit/retry decisions](schema-v1.md#limit-and-retry-decisions-phase-74).

## 8. Intervene and recover

### Normal controls and manual overrides

Inspect status immediately before **each** control; replace all IDs below with
that inspection's values. These are choices, not a batch to paste and execute:

```bash
bin/wf run pause RUN_ID --expected-event EVENT_ID
bin/wf run stop RUN_ID --expected-event EVENT_ID --reason "Cancel this operation; inspect partial changes"
bin/wf run resume RUN_ID --expected-event EVENT_ID --reason "Reviewed the paused cursor and inputs"
```

- **Pause after current** does not kill the child. It waits for settlement and
  preserves the routed next cursor. A policy pause can instead retain the current
  step: plain resume may rerun it, not approve or skip it.
- **Stop now** terminates the owned process group and waits for reaping/stream
  settlement before recording `stopped`; files may be partially changed. It also
  cancels a ready run without executing it. Do not use it to resolve interruption;
  use recovery disposition `end` after process resolution.
- **Resume** requires paused state and a nonblank reason. It executes the selected
  cursor from the beginning, not from an instruction within a process. A previous
  drive/control must fully settle before another operation is admitted.

Paused manual overrides use a JSON file containing exactly one decision:

| Choice | `edit.json` content |
| --- | --- |
| Jump to a compatible stage | `{"action":"jump","stepId":"review","reason":"Inspect the existing changes next"}` |
| Skip using a declared normal outcome | `{"action":"skip","outcome":"complete","reason":"Operator chose this route without execution"}` |
| Accept an unfinished task complete | `{"action":"mark-task-complete","taskId":"TASK_ID","reason":"Verified this task externally"}` |

```bash
bin/wf run override RUN_ID --expected-event EVENT_ID --request edit.json
```

All are audited, preserve history and leave the run paused. Skip creates no report
or process and does not activate/complete tasks, even when skipping `task.complete`.
A retry route on a skip pauses. Manual completion clears the active-task pointer
only when completing that active task; it does not repair an incompatible cursor.
Inspect, optionally choose a compatible jump, then explicitly resume. Repeating a
stage can repeat commits, tool actions or provider usage; no override repairs or
rolls back project files.

### Revise future execution and per-task settings

For ready or paused runs with no active attempt, replacement YAML creates/selects
an immutable revision while retaining task IDs/progress/source snapshot, reports,
old attempts and inputs. It cannot change project root or task source. Use a
nonblank reason; supply `--cursor STEP_ID` if the old cursor is removed, changes
kind or otherwise needs a compatible replacement:

```bash
bin/wf run revise RUN_ID --expected-event EVENT_ID --file revised.yaml --reason "Change the remaining stages"
```

Future occurrences use the new revision; historical attempts do not change.
Sessions are scoped to harness/run/task/**revision**: a new revision cannot reopen
an old revision's session. Existing pending task settings must still validate.
A paused revision stays paused and needs separate explicit resume. In the browser,
**Edit paused revision** pins the exact run/revision/event; applying requires a
reason and consequences confirmation. After stale authorization, refresh the run
then explicitly refresh edit authorization; a changed revision requires reopening
the draft rather than silently rebasing it.

CLI-only per-task settings replace one unfinished task's full settings:

```json
{"overrides":{"steps":{"implement":{"model":"chosen-model","prompt":"Implement {{task.text}}"},"check":{"skip":{"outcome":"complete"}}}},"reason":"Specialize this unfinished task"}
```

```bash
bin/wf run task-overrides RUN_ID --task TASK_ID --expected-event EVENT_ID --request settings.json
```

Use existing executable step IDs; model/prompt require agents. Selected `on`
entries may also be replaced. `{"overrides":{"steps":{}},"reason":"Clear task settings"}`
clears them. No per-task harness/session/outcome/graph rewrite is accepted. See
[run-local configuration](schema-v1.md#run-local-configuration-decisions-phase-55).

### Interrupted-run operator checklist

After a daemon crash or interrupted shutdown, explicitly restart the owner with
its original state directory. Startup reconciles running/pausing runs into
`interrupted`, preserving committed cursors and accepted reports. It does not
signal surviving work, replay steps or infer success. An unresolved operation can
block execution of **all runs in that database**.

1. **Stop issuing execution controls.** Inspect project files and any external
   effects (commits, remote operations, tool jobs). Neither process absence nor a
   retained report proves success or safe repetition.
2. **Inspect durable evidence** and note its exact `expectedEventId` and
   `attempt.attemptId` (or null between committed steps):

   ```bash
   bin/wf --json run recovery RUN_ID
   bin/wf --json run events RUN_ID --after 0 --limit 100
   bin/wf --json run reports RUN_ID
   ```

   Recovery includes run/cursor/revision, interrupted attempt, retained report,
   invocation log references, last process observation, separate operator
   resolution, process barrier and action hints. Inspection itself neither signals
   nor refreshes OS observations.
3. **Refresh process evidence**, using the current recovery/status event ID:

   ```bash
   bin/wf --json run reconcile RUN_ID --expected-event EVENT_ID
   ```

   `gone` clears that observed process barrier, not interruption or uncertain
   side effects. `alive`, `mismatch` or `unknown` remains blocked unless explicitly
   resolved. Reinspect after every mutation; do not reuse old request files.
4. **Resolve any surviving/unknown operation**, choosing the applicable path below.
   Multiple legacy unresolved attempts must be resolved one at a time. Termination
   has no automatic retry; fresh evidence decides the next safe action.
5. **Choose a workflow disposition**, only after all process barriers are resolved.
   Review its side-effect consequences, submit a fresh exact request, inspect the
   resulting paused/stopped state, then separately resume a non-ending decision.

### Resolve processes without pretending they succeeded

For a verified owned orphan, write `recovery.json` from a **fresh** recovery view:

```json
{"expectedEventId":123,"attemptId":"EXACT_INTERRUPTED_ATTEMPT_ID","reason":"Terminate the verified orphan before selecting a continuation"}
```

```bash
bin/wf run recovery-terminate RUN_ID --request recovery.json
bin/wf --json run recovery RUN_ID
```

Termination records intent before signals, rechecks Linux identity before TERM
and KILL, and waits at most one second after each signal for group disappearance.
Unknown/mismatched ownership cannot authorize killing an arbitrary or reused PID.
Failed or uncertain termination remains blocked; a restart never repeats its
signals automatically. Escaped descendants require independent investigation.

For an unidentified/mismatched operation, **independently establish and settle all
surviving work first**. Only then create a fresh confirmation file:

```json
{"expectedEventId":124,"attemptId":"EXACT_INTERRUPTED_ATTEMPT_ID","reason":"Independently checked and settled all surviving work","confirmedNoSurvivingOperation":true}
```

```bash
bin/wf run recovery-confirm RUN_ID --request confirmation.json
bin/wf --json run recovery RUN_ID
```

**`confirmedNoSurvivingOperation: true` is a consequential operator assertion.**
It clears that attempt's execution barrier without changing unknown/mismatched
OS evidence into `gone`. It does not kill anything, prove success, undo effects or
provide an escape hatch around a freshly verified live owned group (which rejects
confirmation). A false assertion can permit overlapping external work; the runner
cannot verify escaped or unidentified processes for you.

### Decide what happens next

Every recovery mutation file requires the inspected **`expectedEventId` + exact
`attemptId` + nonblank `reason`**. `attemptId` is JSON **null** for a committed
between-step interruption, not a guessed older attempt ID. Reasons are bounded to
4096 characters. `run reconcile` is the exception in CLI shape: it takes the
inspected `--expected-event` flag and refreshes evidence, rather than a decision
file. Stale/duplicate decisions reject; inspect again instead of editing just the
number to force a decision through.

For example, after resolving the process barrier and reviewing whether repetition
is safe, write a fresh `decision.json`:

```json
{"expectedEventId":125,"attemptId":"EXACT_INTERRUPTED_ATTEMPT_ID","reason":"Reviewed filesystem and external effects; deliberately repeat this stage","action":"retry"}
```

```bash
bin/wf run recovery-decide RUN_ID --request decision.json
bin/wf --json run status RUN_ID
# Use the NEW status expectedEventId, only after reviewing the selected cursor:
bin/wf run resume RUN_ID --expected-event NEW_EVENT_ID --reason "Execute the reviewed recovery plan"
```

| `action` | Consequence / additional fields |
| --- | --- |
| `retry` | Reselect the interrupted stage; a new logical attempt starts only on later resume |
| `continue` | Preserve a committed between-step cursor; requires that interruption context and `attemptId: null` |
| `skip` | Add declared `outcome`; record a manual transition, not a successful agent report |
| `jump` | Add task-compatible `stepId`; choose a different cursor explicitly |
| `end` | Record `stopped`, not completed; no resume |

All non-ending decisions leave the run **paused** and require a separate resume.
They never promote the old interrupted report/session/correction/input history to
successful settlement. Retained history remains available for diagnosis.
[Exact recovery contracts and limitations](../architecture.md#76-phase-72-explicit-headless-recovery)
remain authoritative. Recovery is CLI-only, not a dashboard bypass.

## 9. Set up harnesses and diagnose adapters

Install the selected binary and provision its provider/account through that
harness's own supported setup before starting the daemon. Authentication may use
normal harness-managed stores or specifically selected environment names. An auth
setup for another harness/provider is not proof that this one can use the selected
model. Never paste credentials into reports, YAML, argv, chat or diagnostic output.

The versions below are **recorded compatibility evidence**, not automatically
installed requirements or a promise that every provider/tool configuration works.
`model` and `reasoning_effort` are YAML fields; model-specific availability remains
the harness/provider's decision.

| Harness / binary (recorded version) | External authentication expectation | Model / reasoning mapping | Resume / correction and important limits |
| --- | --- | --- | --- |
| `codex` / `codex` (0.163.0) | Existing Codex account/config or selected Codex key environment | `model` → `--model`; effort → `model_reasoning_effort` invocation config | Exact persisted UUID via `exec resume`, never latest/fresh fallback; unrestricted bypass mode; managed-config interactions beyond exercised setup unverified |
| `pi` / `pi` (1.3.0, earendil package) | Pi provider auth store or selected provider environment | `model` → `--model`; effort → `--thinking`: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` | Exact UUID within dedicated persisted session directory after file/header/cwd checks; missing session fails; default unrestricted tools, no permission flag |
| `omp` / `omp` (18.12.2, oh-my-pi) | omp's selected provider/profile/store or supported provider/broker environment; not interchangeable with Pi/Codex login | `model` → `--model`; effort → `--thinking`, Pi levels plus `auto` | Exact absolute persisted journal path; rejects missing, malformed or moved-away sessions, no fork/fresh fallback; `yolo` does not override explicit denials/provider policy; isolated fresh-database initialization failure remains documented |
| `opencode` / `opencode` (2.0.32) | OpenCode provider store/config or selected provider environment | `provider/model#variant`, or `provider/model` without a variant plus effort as named variant; do not supply both variant and effort | Private invocation-local `serve --stdio` + exact-ID API; never CLI create-if-missing resume; session allow-all rules; no provider event stream, no actual-model attestation, no automatic answers to interactive forms |
| `claude` / `claude` (2.1.303) | Existing Claude auth/config or selected Claude/Anthropic environment | `model` → `--model`; effort → `--effort`: `low`, `medium`, `high`, `xhigh`, `max` | Exact persisted UUID; default persistence retained; no recent/fork/fresh fallback; `bypassPermissions`; managed restrictions/model availability still apply |

Probe installed capabilities offline:

```bash
npm run probe:harnesses
```

This builds and calls the real isolated adapter factories' version/help probes;
it does not execute a model or establish authentication, entitlement or a usable
session. Required missing/failed/truncated launch evidence rejects construction.
Missing optional model/reasoning/resume selectors disable those features without
pretending they work. Recreate adapter snapshots after CLI upgrades (for the
management daemon, gracefully restart it); snapshots do not continuously attest to
binaries changed underneath them.

Troubleshoot by inspecting the failed attempt, attention and invocation events:

- **Unknown harness:** fix the YAML registry ID; installing a binary does not
  register an arbitrary harness. Supported IDs are the five in the table.
- **Unsupported model/reasoning:** installed capability preflight routes
  `system.spawn_error` before that invocation; a model-specific invalid selector
  can also fail inside the adapter/provider. Correct the explicit setting through
  a validated revision/task edit, not a silent model fallback.
- **Unavailable resume/missing session:** `system.resume_unavailable` never starts
  fresh automatically. Check exact session existence/cwd and harness/run/task/
  revision scope. A new revision needs its own session; deliberately author fresh
  execution if that is the intended next operation.
- **Spawn/provider/process/protocol errors:** inspect the safe explanation and
  bounded stderr. Required factory failures can reject start/resume admission;
  effective attempt preflight/failures appear in durable attempt/attention history.
  Do not treat provider failure as a missing report or add paid diagnostic retries.
- **Idle timeout:** silence on both streams triggers supervised termination and
  `system.timeout`. Inspect `timeoutReason`, optional idle limit and OpenCode's
  lower activity visibility; output is not proof of useful progress.
- **Report rejected/correction failed:** inspect the acknowledgment, declared
  outcomes and [report bounds](schema-v1.md#reporting-decisions-phase-4). Only a
  clean original execution can get one same-session correction; unavailable or
  failed correction routes `system.report_error`, not a new implementation turn.

All five adapters pass synthetic offline conformance. Separate historically
**live-verified** report/correction paths exist for Codex/Pi Luna/low, omp/OpenCode
Meta Contributor/low and Claude Haiku/low; they prove only those exercised paths.
They were not rerun for this guide. OpenCode cannot independently attest actual
provider-model usage. Known injected secrets are scrubbed, but an unknown configured
MCP credential was previously observed in OpenCode diagnostics: never assume raw
logs are publishable. Read the [compatibility evidence and limits](harness-compatibility.md#live-verification--phase-6-and-milestone-05-complete),
which distinguish historical implementation-time pending notes from later results.
Normal runner start does not perform the optional live-smoke tool's auth-status
admission checks. No live smoke or paid provider execution is needed for this guide.

## 10. Troubleshooting

**Inspect before retrying.** A lost/timed-out acknowledgment does not cancel an
admitted control and may hide a committed mutation. Inspect lists/status/events
before deciding whether to issue a new request; never blindly repeat a control.

| Symptom | Likely cause | Safe diagnosis | Remedy |
| --- | --- | --- | --- |
| Daemon unavailable | No explicit owner, exited owner, wrong state selection | Compare absolute state selection in both terminals; inspect foreground diagnostics; `daemon status` | Start the owner explicitly with the same private directory; no auto-start occurs |
| Competing owner / live lease | Another writer already holds the canonical database | Inspect the known owner terminal/process; clients may read status through that owner | Use the existing owner or shut it down deliberately; never unlink `.runner-lock` or force PID-file takeover |
| Unsafe/wrong-owner state directory | Foreign UID, group/other access, unsafe canonical target | Inspect metadata without printing file contents, e.g. `stat -c '%U %a %n' /absolute/state` | Choose a dedicated directory you own, mode 0700; repair only your known directory after inspection, not another user's state |
| Unsafe/stale discovery | Symlink/non-file, foreign UID, broad permissions, >4096 bytes, old token/port | Inspect metadata and known owner; do not print `daemon.json` | Explicitly start/restart the legitimate owner after settlement; lease acquisition, not discovery deletion, decides ownership |
| Stale `expectedEventId` / another control settling | Events changed after inspection or asynchronous control is unfinished | Fresh status/events; if response lost, inspect whether the action committed | Reconsider using the new cursor after settlement; do not auto-retry |
| Run paused by policy | Declared outcome/default system pause, limit exhausted, retry exhausted | Inspect report, attention, routed cursor, counters/deadline and effective YAML policy | Resolve cause; revise limit/prompt/route or choose audited override; explicitly resume only after review |
| Run interrupted / all execution blocked | Crash left uncertain attempt/process evidence | `run recovery`, then deliberate `run reconcile` | Resolve processes and choose recovery disposition; no blind resume, no automatic replay |
| Report rejected 422 | Invalid/undeclared outcome, unknown fields, blank summary, invalid JSON bounds or protected credential content | Inspect rejection and declared contract, without printing authorization | Submit corrected permitted content while the invocation is active; do not invent IDs/transitions |
| Report rejected 409 | One report already accepted | Inspect reports/attempt history | Do not submit another or assume it changes the outcome; await settlement |
| Report rejected 410 | Token expired/revoked, late invocation | Inspect invocation/stop/correction lifecycle | Do not reuse/copy a token; only the current runner-issued invocation can report |
| Report rejected 413 | HTTP report body exceeds 128 KiB | Measure content sizes locally without exposing secrets | Reduce summary/issue/handoff/data within exact schema bounds; the handoff CLI also rejects >64 KiB before sending |
| Missing report / correction failed | Clean exit without accepted report, missing session, disabled/unavailable correction, failed follow-up | Inspect `correction_requested`, both invocation settlements/log references and accepted reports | Fix reporting/session prerequisites; choose a deliberate next execution. No third correction or stdout fallback exists |
| Adapter preflight fails | Missing binary/required help feature, unsupported selector, unavailable exact session | Inspect admission error or durable failure; use offline `probe:harnesses` | Install/configure externally or revise requested settings deliberately; no global workaround/fresh fallback is automatic |
| Chromium provisioning failure | Developer browser smoke lacks pinned browser or shared libraries | Read the smoke's provisioning guidance and [prerequisites](../README.md#offline-chromium-smoke-prerequisites) | Provision explicitly when authorized; ordinary core checks/CLI/UI do not require the smoke browser |
| Port/pairing/session fails | Old ephemeral port, replaced/used/expired code, expired/revoked cookie, wrong Host/Origin | Run `wf ui` against the correct owner; use exact printed URL | Pair with a fresh code within five minutes; use `127.0.0.1`, not a proxy alias; restart requires re-pairing |
| Logs incomplete / huge management reply | Capture/log caps, interleaved streams, unpaginated growing history | Inspect invocation log paths and truncation flags; paginate events | Use bounded local logs as diagnostics, not replayable JSONL; narrow inspection and keep raw artifacts private |
| Shutdown acknowledged but process remains | Pause-after-current drain; step has no timeout | Inspect owner/status and current operation | Wait for settlement or deliberately stop the run before shutdown; acknowledgment is not exit |

### Exit codes and diagnostic limits

| Surface | Exit semantics |
| --- | --- |
| Management `bin/wf` | 0 success/admission; 1 validation/control/transport rejection; 2 malformed CLI fields/options or unreadable input files |
| Local workflow validator | 0 valid (warnings allowed); 1 invalid definition/path; 2 missing/unreadable input or usage error |
| `wf report` | 0 acknowledged acceptance; nonzero rejected report, invalid CLI/input or transport failure; read the error, not just the exit |

Management `--json` emits one result on stdout or one `{error,...}` on stderr.
Human validation retains located diagnostics. Start/shutdown exit 0 is admission,
not completed work or completed shutdown.

Attempt logs live at `logs/ATTEMPT_ID.log` under the selected state directory;
correction uses `.log.correction`. Invocation events/recovery expose their exact
paths. Daemon diagnostics stay in its foreground terminal; no separate rotating
daemon log is created.

- Combined stream log: at most **16 MiB plus a cap marker per invocation**.
- In-memory stdout/stderr capture heads: **64 KiB each**.
- Durable scrubbed stderr diagnostic: **4 KiB**, with capture-truncation flags.
- Report bounds and statuses: [reporting reference](schema-v1.md#reporting-decisions-phase-4).
- Management/browser requests: **2 MiB**, five-second request-read bounds;
  workflow text **1 MiB**. The CLI management response cap is **32 MiB** and its
  request timeout is **120 seconds**; a timeout never authorizes blind replay.

Scrubbing covers known injected credentials/tokens and specific representations,
not every secret loaded later by harnesses/tools. Harness-owned transcripts/auth
files and arbitrary tool-created files are outside that boundary. Never ask
someone to supply a real credential for diagnosis; share a reviewed, redacted
explanation, not discovery, raw logs or auth files.

## 11. Shutdown, cleanup and deferred scope

SIGINT, SIGTERM and `bin/wf daemon stop` request **pause-after-current and drain**.
They wait for the current step, report channel and streams to settle before
releasing state ownership. The stop command acknowledges the request before owner
exit. An unbounded stage can delay exit indefinitely. If immediate cancellation
is needed, deliberately use reasoned `run stop` while controls are available,
then shut down the daemon; do not confuse graceful daemon stop with process-tree
termination. After shutdown admission new mutations are rejected while inspection
remains available during drain.
Once admitted, shutdown proceeds even if its client disconnects or resets before
receiving the acknowledgment. This still waits for the current operation to settle.

Wait for owner exit, verify owned operations/listeners and discovery are gone, and
preserve state whenever settlement is uncertain. Private saved state is how you
inspect/recover history; shutdown does not delete it. Remove only an intentionally
disposable state directory whose ownership and inactive state you have established.
Do not delete runner state to resolve uncertain external effects, or edit SQLite
cursors by hand. Project and harness-owned files are not rolled back or cleaned
by ending a run.

The canonical [deferred-feature and non-goal list](../spec.md#deferred-features-and-permanent-non-goals)
is in spec §8. It distinguishes implemented immutable revisions, snapshots,
polling and CLI-only controls from unimplemented library CRUD, re-import,
transports, scheduling and extension surfaces. These are scope boundaries, not
promises of future implementation; unrestricted execution provides no isolation
or rollback.
