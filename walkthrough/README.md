# Owner-led OpenCode walkthrough

**Prepared and completed once with the owner; see [live results](VERIFICATION.md#live-walkthrough-results).** Use the finished Workbench described in
[USER_GUIDE.md](../USER_GUIDE.md), with setup from [README.md](../README.md#development).
This exercise changes one line in a disposable project, pauses for inspection, then creates
a receipt only after an explicit Resume. Allow about 15 minutes.
See [verification](VERIFICATION.md) for preparation checks and the completed live run. Generate
a fresh disposable lab for another walkthrough; the original lab was cleaned after use.

## Selection and prerequisites

Use **OpenCode with `opencode/deepseek-v4.1-flash-free`**, exactly. The
[workflow](workflow.yaml) selects it explicitly, with a fresh conversation and no effort
variant. [OpenCode configuration](opencode.json) also pins the default, build, title,
summary and compaction agents to that model, avoiding a different maintenance model.
Updates are disabled in this disposable configuration. No global harness file is edited.

Verified locally on 2026-10-21 (America/Los_Angeles):

- Node `v26.7.0`, npm `11.19.0`, OpenCode at
  `/home/phagmaier/.opencode/bin/opencode`, version `opencode v2.0.32`.
- Workflowz's isolated version/help probe accepts the private v2 API and explicit model
  selection. The credential-free, refresh-disabled catalog lists the exact model.
- OpenCode's [official catalog](https://opencode.ai/v2/docs/console/models/) lists
  `deepseek-v4.1-flash-free` as a limited-time free model. This is catalog evidence;
  reachability, current access requirements, rate limits and successful tool/report execution
  cannot be established without the owner's real run.

The owner supplies a local browser, two terminals, network access at execution time and the
explicit Start/Resume decisions. No credential is needed for the local checks; none is copied
from existing OpenCode state. If the free provider requests authentication or is unavailable,
stop and record that result. Do not substitute a paid model, add billing, or use a smoke
command that selects another provider.

Context7 was consulted for OpenCode docs. Its older `models [provider]` example does not match
installed v2 help; preflight uses the installed **`opencode models --standalone`** syntax.
Configuration was checked against the official
[v2.0.32 config reference](https://github.com/anomalyco/opencode/blob/v2.0.32/services/www/src/docs/content/config.mdx)
and [agent reference](https://github.com/anomalyco/opencode/blob/v2.0.32/services/www/src/docs/content/agents.mdx).
There is no standalone `opencode run` step in this walkthrough: Workflowz owns the agent invocation.

## 1. Prepare isolated resources — no provider

In terminal A:

```sh
cd /home/phagmaier/Code/workflowz
npm run build
WF_LAB="$(sh walkthrough/prepare.sh)"
printf '%s\n' "$WF_LAB"
bin/wf workflow validate "$WF_LAB/workflow.yaml"
(
  . "$WF_LAB/environment.sh"
  node walkthrough/preflight.mjs
)
(cd "$WF_LAB/project" && node check.mjs before)
```

Keep the printed full path. Every preparation creates a fresh private
`/tmp/workflowz-owner-XXXXXX` directory:

| Path under `$WF_LAB` | Purpose |
| --- | --- |
| `workflow.yaml` | File to import; `project.root: project` resolves from its folder. |
| `project/greeting.txt` | The one-line file the agent changes. |
| `project/check.mjs` | Baseline, changed-file and final checks; review before starting. |
| `state/` | Separate Workflowz database, discovery, revisions, runs and logs. |
| `opencode/` | Separate OpenCode config, database, data, cache and state. |
| `environment.sh` | Environment for the daemon and preflight subshells only. |

Validation must report **5 steps, 2 warnings**: `finish` and `done` are unreachable through
normal Outcome routes. This is deliberate: only the owner's manual step selection reaches
`finish`. Other warnings/errors or a failed preflight need investigation before Start.
Preflight checks the reviewed templates, installed capabilities and local catalog only;
it sends no prompt and invokes no provider. The project needs no dependencies or Git identity.

Limits are eight step executions, five minutes for the agent, ten seconds per command and
30 minutes total wall time, including the owner's pause. Report correction is disabled and
there are no automatic retries. Time/process limits bound this exercise; they do not sandbox
tools or undo changes. Agents run unrestricted, and commands run as your user.

## 2. Start the service and pair

Still in terminal A, start only this disposable daemon:

```sh
(
  . "$WF_LAB/environment.sh"
  exec bin/wf --state-dir "$WF_LAB/state" daemon start
)
```

Leave it open. In terminal B, replace the example suffix with the **printed full path**:

```sh
cd /home/phagmaier/Code/workflowz
WF_LAB=/tmp/workflowz-owner-XXXXXX
bin/wf --state-dir "$WF_LAB/state" daemon status
bin/wf --state-dir "$WF_LAB/state" ui
```

Open the printed `/ui/` address, enter **Pairing code**, then **Connect**. The code is
one-use, expires in five minutes and must stay private. Request another with the same
`ui` command if necessary. Always use this state directory; the owner's existing daemon
and saved workflows are separate. Closing/reloading the browser does not stop a run.

## 3. Import, inspect, save and prepare

1. Choose **Import file…**, then **Choose file…** and select `$WF_LAB/workflow.yaml` using
   its full path. Set **Workflow folder** to `$WF_LAB`'s full path, then **Open draft**.
2. In **Graph**, inspect `baseline → edit_greeting → checkpoint`. The checkpoint's
   `complete` and `failed` Outcomes both pause. `finish → done` is the separate manual
   continuation. Use **Fit** or scroll to inspect all five nodes. Review the two expected
   Checker warnings; there should be no errors.
3. Switch to **Form**. Select `edit_greeting`; confirm **Agent** is OpenCode, **Model** is
   exactly `opencode/deepseek-v4.1-flash-free`, Effort is empty and Conversation is fresh.
   Read the prompt and Outcomes. Select each command and inspect `node check.mjs before`,
   `node check.mjs after` and `node check.mjs finish`. **Project** must resolve to
   `$WF_LAB/project`; **Rules & limits** must match the limits above.
4. Choose **Save**; record the saved revision number. Save creates no run. Select
   **Create run…**, review the panel, then **Create run**. There is no task checklist in
   this exercise. Record the displayed run ID.
5. In **Ready to start**, inspect **What will run**, its commands, model and Outcome
   destinations. Expand **Run information** to confirm the disposable project path and
   revision. Open **Map**, then return to **History**. Confirm the original greeting
   remains and no `receipt.txt` exists. Nothing has executed yet.

## 4. Owner starts and inspects the pause

**Real-provider execution begins here, separately with the owner.** Read the permissions
note and explicitly choose **Start run**. Expected progression:

| Step | Expected evidence |
| --- | --- |
| `baseline` | Output: `BASELINE OK — original greeting`. |
| `edit_greeting` | Accepted `complete` report describing the edit and local check. |
| `checkpoint` | Output: `CHANGE OK — owner checkpoint`; run becomes Paused. |

Find the run under **Runs → Waiting for you**; open it and confirm its run ID/revision.
In **History**, select each attempt. Inspect the agent's **Report**, including **Accepted
report** and **Technical details**, and switch to **Output**. OpenCode's API transport may
provide little stdout; command Output and the accepted report are the useful evidence.
Output is saved bounded capture after settlement, not a live terminal stream.

Open **Map** to inspect the visited path. Select `edit_greeting`, then **Show latest result
in history**. Expand **Run information → Attention records** to see why it paused.

In terminal B, check the actual files:

```sh
(cd "$WF_LAB/project" && node check.mjs after)
cmp walkthrough/project/check.mjs "$WF_LAB/project/check.mjs"
diff -u walkthrough/project/greeting.txt "$WF_LAB/project/greeting.txt"
ls -la "$WF_LAB/project"
```

Expect only `Hello from Workflowz.` to become `Hello from Workflowz and OpenCode.` with
one trailing newline; `diff` intentionally returns 1 for that change. The checker must
be unchanged, and `receipt.txt` must be absent. Review any extra files. If the agent is
blocked, times out, lacks an accepted report, or the checkpoint fails, inspect Report,
Output and files, then stop. Do not apply the success continuation to a failed attempt.

## 5. Apply a decision, then explicitly Resume

At the **successful checkpoint pause**, under **What should happen next?**:

1. Select **Continue from another step**. Set **Continue at** to **Finish** (`finish`). Enter reason
   `Inspected greeting and accepted the change`, then choose **Apply**.
2. Confirm status is still **Paused**, the next step is `finish`, and the reason is
   retained. **History** should record the manual move. In terminal B, run
   `test ! -e "$WF_LAB/project/receipt.txt"` to prove Apply did not execute the command.
3. Review the selected continuation and reason, then explicitly choose **Resume run**.
   Do this within the 30-minute wall budget. Resume alone at the original checkpoint
   would rerun `checkpoint` and pause again; it does not accept the change.
4. Expect `finish` Output to say `FINISH OK — receipt.txt created after explicit Resume`,
   followed by **Completed**. Inspect Report/Output, the move/resume events in History,
   and the new path in Map. Find the run under **Runs → Finished**.

Verify the resulting files without rerunning `finish`:

```sh
cat "$WF_LAB/project/greeting.txt" "$WF_LAB/project/receipt.txt"
printf 'Hello from Workflowz and OpenCode.\n' | cmp - "$WF_LAB/project/greeting.txt"
printf 'Owner resumed; greeting verified.\n' | cmp - "$WF_LAB/project/receipt.txt"
cmp walkthrough/project/check.mjs "$WF_LAB/project/check.mjs"
```

Capture concrete friction in a separate owner note: run ID/revision, screen/control,
expected behavior, observed behavior and useful nonsecret evidence. Exclude pairing codes,
cookies, report tokens, raw private logs and database files. Mark the live walkthrough
complete only after these real results exist; the offline rehearsal is separate evidence.

## Stop and clean up

To abort, use **Stop run now…** while running, **Stop this run…** while paused, or
**Cancel this run…** before Start. Give a reason and confirm **Stop run**. Wait for
**Stopped** and process cleanup before proceeding. Stopped runs cannot resume; file
changes remain. If interrupted or cleanup is uncertain, retain the lab and follow
[terminal recovery](../USER_GUIDE.md#recover-an-interrupted-run); never blindly retry.

Once Completed or Stopped, shut down this daemon from terminal B:

```sh
bin/wf --state-dir "$WF_LAB/state" daemon stop
```

Wait for terminal A's foreground command to exit. Save any redacted owner notes outside
the lab, close its browser tab, then remove only this generated directory:

```sh
case "$WF_LAB" in /tmp/workflowz-owner-??????) ;; *) exit 1 ;; esac
test "$(cat "$WF_LAB/.workflowz-owner-walkthrough")" = 'Workflowz owner walkthrough v1' || exit 1
test ! -e "$WF_LAB/state/daemon.json" || exit 1
rm -r -- "$WF_LAB"
unset WF_LAB
```

This removes the disposable Workflowz and OpenCode state together with the project.
`environment.sh` was sourced only in subshells, so terminal B needs no XDG restoration.
Prepare a new lab for another run; the receipt check deliberately refuses duplicate effects.

## Offline verification

The [browser rehearsal](../test/browser/owner-walkthrough.spec.mjs) imports this exact
workflow and runs its real commands with an injected scripted adapter in place of OpenCode.
It checks separate Save/Create/Start, Report/Output/History/Map, the successful pause,
Apply without execution and Resume creating the receipt, plus keyboard/mobile layout.
It never selects an installed provider adapter. Reproduce after building:

```sh
npm run typecheck
npm run lint
npm run test:browser -- owner-walkthrough.spec.mjs
```

The local preflight above checks installed OpenCode separately. Neither check establishes
successful real-provider execution. Desktop packaging remains deferred in
[DESIGN.md](../DESIGN.md#status).
