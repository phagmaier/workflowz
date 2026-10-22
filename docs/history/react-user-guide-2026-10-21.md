# Using Workflowz

> Archived on 2026-10-21. This guide describes the previous React interface, before the Workbench
> redesign. Labels, screens and command-entry instructions are historical. Follow
> [README.md](../../README.md) for setup and [DESIGN.md](../DESIGN.md) for current UI direction.
> A replacement guide will be written after the redesigned interface works.

Workflowz runs the steps and result rules you author. Workflows are definitions; runs are
executions of a particular immutable revision. The daemon owns execution and history.

## Open and pair

Build and start Workflowz as described in [README](../../README.md#development). In a second terminal,
run `bin/wf --state-dir "$HOME/.local/state/workflowz" ui` with the same state directory as the
daemon. Open the printed `/ui/` address and enter its one-use pairing code. Keep the code private;
it expires after five minutes. Run the command again for a new code if needed.

The navigation has **Workflows** and **Runs**. The Runs badge counts paused and interrupted runs.
Browser Back/Forward and bookmarked run/revision addresses work. Old `/ui/app/` addresses redirect
to `/ui/` with their location preserved. Disconnecting the browser, closing it or reloading it
does not stop execution. Keep the foreground daemon running.

## Create or open a workflow

On **Workflows**, choose **Create workflow**, name it, enter an absolute project folder on the
daemon's machine, and choose an example. **Create draft** opens the editor without saving or
running anything. Open a saved workflow to edit a copy; expand earlier revisions to open an
older one. Unsaved drafts in this tab are listed above saved workflows.

For a first tour without an agent, choose **Commands only**. It starts with `npm test`; replace
the command with a program you intend to run. For example, enter `node` and `--version` on
separate lines to print the installed Node version. Agent examples start with Codex: choose
your intended **Agent** and **Model** before starting a run. Checking a workflow doesn't call
a provider or verify provider availability.

**Import YAML…** opens a local file (up to 1 MiB) as a new text draft. Supply its original
workflow folder as an absolute path on the daemon machine: browsers cannot provide that path.
Relative project folders resolve from the workflow folder; instruction, prompt and checklist
paths resolve from the project folder. Import preserves exact text and comments, including
invalid text you need to repair, and never overwrites the original file.

## Edit steps and project inputs

The editor has five views:

| View | Use it for |
| --- | --- |
| **Steps** | Select, add, rename or delete steps; choose the first step and result destinations. Checks explain problems beside the form. |
| **Project** | Workflow name, project folder, ordered instruction files for every agent, optional Markdown task checklist. |
| **Rules & limits** | Shared rules, workflow defaults, report correction and safety limits. |
| **YAML** | Inspect or edit the exact definition. |
| **Map** | Read the resolved routes; select a step and choose Edit to open its form. |

Agent steps choose a harness, optional model/reasoning effort, conversation policy, inline or
file prompt, and declared results. Prompts can use `{{task.text}}`, `{{project.root}}` and
`{{reports.<step>.summary}}`. Advanced fields include working folder, time limit, additional
instruction files and earlier reports to include. Conversation reuse depends on harness support
and an eligible earlier session for the same task and revision.

Command steps take one argument per line; shell syntax is not interpreted. To use a shell,
enter `sh`, `-c`, and your script as separate arguments. Advanced fields include environment
variables, working folder and time limit. Use YAML for arguments containing newlines or trailing
empty arguments, or multiline environment values. Keep secrets out of workflow definitions.
Incomplete time limits and environment lines block saving; correct them or clear the field.

Task loops use **Pick the next task** (`task.next`), agent/command work, and **Mark task done**
(`task.complete`), returning to the picker until its `exhausted` result reaches Finish. Tasks
are copied from Markdown when a run is created. Later checklist edits do not change existing
runs, and Workflowz does not tick the source file's boxes.

Choose a destination directly for each result: **Go to …**, **Finish**, **Pause and wait for me**,
**Retry this step**, or **＋ New step…**. In the step form, a new destination step opens
immediately for editing; shared-rule editing keeps you on Rules & limits.
Retry specifies total runs (including the first, 2–100) and a wait in seconds; exhaustion pauses.
Engine task steps cannot execute retries. There are no mandatory review or approval stages.

The first step and routes determine execution order. Reordering the list only changes reading
order: focus a step and press **Alt + Up/Down**. Renaming updates structural references; it does
not rewrite report placeholders inside prompt text. Deleting leaves broken references for
Checks to explain. Fix errors before saving or preparing a run.

## Shared rules, failures and limits

Shared rules select named steps, any matching tag, or all steps. For an exact result, precedence
is: step rule → named-step rule → tag rule → all-step rule → workflow defaults. Conflicts at the
same level are errors. The step form shows inherited destinations and their source; remove a
direct override to inherit again.

Each nonterminal step's technical-failure disclosure exposes all ten failure routes.
**Any technical failure** is a fallback: exact failure rules at every level are considered
before that fallback. Unrouted technical failures pause. These failures are distinct from an
agent's declared business results; a strict report must use a declared result.

**Ask the agent once for its report** defaults on. Only clean execution without a valid report
can receive one correction in the exact same session, if supported. Technical execution
failures bypass correction. This is separate from a configured step retry.

Safety limits are optional:

- **Maximum step executions:** counts committed transitions, including retries.
- **Maximum run time:** wall time since Start, including pauses. The remaining budget caps
  active commands, agent invocations and report correction. Expiry requests supervised
  termination and pauses the run after settlement; cleanup can extend beyond the deadline.
- **Agent silence timeout:** ends an agent invocation after this long without stdout/stderr;
  routes as a technical timeout. Commands are unaffected.

The first two limits pause admission of further steps. Limits and Stop never undo file changes.

## YAML and draft lifetime

Choose **Edit as text** on YAML to pause visual editing. Exact text, comments and unfinished
edits survive navigation and failed checks within this tab. Diagnostic links select the
reported line/column. **Check again** retries validation deliberately after a failure.
Only a valid check of the newest edit enables Save, Create run or Apply, and **Return to visual
editor**. Returning keeps the text; a later visual edit regenerates YAML and removes comments.

The header says whether the draft is new, changed or saved. **Discard draft/changes** asks before
throwing edits away. Drafts live only in this tab's memory: reload, tab close or opening the draft
address in another tab loses unsaved work. A browser warning is a chance to cancel, not storage.
Save a revision to keep your work.

## Save, Create run and Start

| Action | Result |
| --- | --- |
| **Save** | Stores an immutable revision. No run is created and nothing executes. Identical saved text can reuse an existing revision. |
| **Create run…** | Previews task inputs, then **Create run** prepares a ready run and opens it. Unsaved changes are stored as a revision with that run. Nothing executes. |
| **Start run** | Begins execution from the first step on the ready run's page. |

In the creation panel, inspect **All checklist items** for bodies, source lines and queued or
excluded status. Prechecked items are excluded unless you explicitly include them. Creation
rereads the actual source and freezes the imported tasks; the preview itself changes nothing.

Before Start, review the plan and permission modes. Agents and arbitrary commands can change any
file your user can access, including outside the project. Workflowz provides no isolation or
rollback. Start/Resume execute the authored routes sequentially; browser closure doesn't stop them.

## Follow results and pause

**Runs** filters All, Needs attention, Ready & running, and Finished. Open one for current status,
task progress and controls. **History** groups steps by task; select a row to read its result,
report summary, issue, handoff or failure. Arrow keys move between history rows. **Accepted report**
shows the full report, including structured data and attempt identity. **Step definition** uses
the selected history item's saved revision, so applying a newer workflow does not relabel old work.
A report can be accepted
before its process settles; acceptance alone does not finish the step.

**Technical details** shows event evidence with private log paths hidden. **Run information**
contains the project folder, imported task bodies and historical attention records. Old attention
records remain after decisions; current status tells you whether action is needed now. **Map**
shows routes taken and step execution counts; arrow keys move between its nodes.

**Pause after this step** lets the owned operation settle before pausing at its boundary.
**Stop run now… / Stop this run…** requires a reason and stops the owned operation, waiting for
process/group/stream settlement. Changes already made remain. A stopped run cannot resume.

On a paused run, **What should happen next?** offers:

- **Resume:** executes the displayed next step; it may repeat a step that paused. Enter a reason.
- **Decide the step's result yourself:** follows a declared result's route without running it or
  creating a report. Skipping even a task primitive does not activate or complete a task.
- **Go to a different step:** moves the cursor to a compatible step without executing it.
- **Mark a task done:** accepts only the chosen unfinished task without implementing it. Marking
  the active task clears it; a jump to the picker may be needed before Resume.
- **Change the workflow for this run:** opens its pinned revision in the editor.

Every state-changing decision needs a reason saved in history. All choices except Resume leave
the run paused. Repeating work can repeat external effects such as commits.

## Change a paused run's workflow

Edit its prompts, rules or steps; compare **Changes against revision …**, including both exact
YAML texts. Project folder and task-source identity stay fixed, and imported tasks/history are
preserved. Choose **Continue at** explicitly if the old cursor is no longer compatible. Disabled
destinations explain why; remaining task-specific settings are fully validated at Apply.

Enter an apply reason and choose **Apply to this run**. This stores a revision for future attempts
and returns to the paused run with Resume selected. Nothing executes yet. Review the consequence,
enter a fresh reason and choose **Resume run** separately. Agent sessions from the previous
revision cannot be resumed.

If another operator changes the run, Apply is refused and your edits remain. **Check the run again**
refreshes authorization for the same revision. If that revision changed elsewhere, discard and
reopen deliberately. Normal workflow editing remains available for preparing a separate run.

## Disconnection and interrupted recovery

Disconnected pages keep their last view and disable actions while reconnecting. Expired/replaced
sessions need a new pairing code. Rejected stale actions change nothing; requests are never
automatically resent. If an action gets no answer, its outcome is unknown: inspect Runs or
Workflows before deliberately repeating it. A timeout does not cancel daemon work.

After a daemon crash, interrupted work is never replayed automatically. Inspect the project and
use the CLI with the same state directory:

```bash
bin/wf --state-dir "$HOME/.local/state/workflowz" run recovery RUN_ID
bin/wf --help
```

Follow the inspection's process evidence and blocking notes. Recovery may require reconciliation,
owned-process termination or explicit external-cleanup confirmation before a reasoned decision.
Decisions use exact event/attempt identity and leave execution paused; Resume is separate.
Do not guess that a vanished process succeeded or blindly repeat signals. Recovery and per-task
settings stay in the CLI; see the [recovery contract](../reference/architecture.md#76-phase-72-explicit-headless-recovery)
and [CLI reference](../reference/development.md#local-application-commands).
