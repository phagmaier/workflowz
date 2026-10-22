# Agent Workflow Runner — user guide

> Archived for the UI-focused reset on 2026-10-20. This is reference/history, not the current work plan or agent instructions. Use [DESIGN.md](../DESIGN.md) and [AGENTS.md](../../AGENTS.md) for active direction.

> Unfinished walkthrough archived at the owner's request on 2026-10-20. The existing UI made the guided tasks too difficult to follow, so UI redesign now comes first. The command-only run completed; no agent workflow was started in this walkthrough. This is research/reference material, not a complete user guide. See the [current plan](../DESIGN.md) and [UI design brief](../DESIGN.md).

**Work in progress:** This guide is being written during a hands-on walkthrough. It currently
covers the introduction, service startup, browser connection, and completing a command-only run.
Installation and further instructions will be added as we try them. The [previous guide](user-guide.md)
remains historical reference.

## What the application is used for

Agent Workflow Runner automates a sequence of coding-agent work and ordinary commands on your
machine. You define which steps should run and what happens after each possible result.
The application follows those rules and records progress so you can inspect the work later.

For example, you could define a workflow that:

1. Picks the next item from a Markdown task checklist.
2. Asks a coding agent to implement it.
3. Asks another agent to review the changes.
4. Returns to implementation if the reviewer requests changes, or marks the task complete if approved.
5. Repeats for the next task.

You choose that process. Reviews, tests, Git commits and human checkpoints happen only when you
include them. A workflow can also be a small sequence of commands, without agents or a task list.

The runner follows a configured graph of steps and results; there is no supervising AI deciding
what to do next. Agents choose what to do within their assigned work and report a declared result.
Accepting a report checks its format and allowed outcome, not the quality of the resulting code.

## Main concepts

| Term | Meaning |
| --- | --- |
| **Project** | The directory where you want work done, with any instruction files you select. |
| **Workflow** | Your reusable definition of steps and the rules connecting their results to the next action. |
| **Step** | One operation in the workflow, such as running an agent, executing a command or selecting a task. The current UI also calls these stages. |
| **Task** | An item imported from a Markdown checklist. One task can pass through several steps. Task lists are optional. |
| **Outcome** | A result used to choose the next action, such as `complete`, `revise` or `blocked`. You declare the allowed agent outcomes. |
| **Run** | One execution of a workflow, with its own progress, reports and history. |
| **Harness** | The coding-agent program the runner launches, such as Codex, Pi or Claude Code. |

## How the application runs

The runner has a local service called the **daemon**. You start it in a terminal and leave that
terminal open. It owns execution and saved run state. The browser interface and the `wf` command
line communicate with that service.

Closing the browser does not stop a workflow. The daemon must remain running for work to
continue. The application executes one command or agent operation at a time within its state database.

Starting the daemon or opening the UI does not automatically start a workflow. Creating a run
prepares it; **Start** begins execution. Commands and agents operate with user-level access,
and stopping a run does not undo changes they have already made.

## Start the service from a built checkout

These instructions assume dependencies are installed and the checkout has been built. Full
installation instructions will follow; existing build commands are in the [development reference](../reference/development.md#setup-and-commands).

In a terminal, change to the repository directory. Start the service with an explicit location
for saved runs and private connection details:

```bash
bin/wf --state-dir "$HOME/.local/state/workflowz" daemon start
```

This example selects `~/.local/state/workflowz`. Use the same state-directory path for subsequent
CLI commands so they connect to this service. If the directory is new, the runner creates it with
private permissions. An existing directory may need the permissions fix below.

Successful startup prints a message like:

```text
daemon listening; state: /home/your-user/.local/state/workflowz
```

The command stays running instead of returning a shell prompt. Leave this terminal open; use a
second terminal for further commands. At this point the service is available, but no workflow has
been started by this command.

## Open and connect the browser UI

Leave the daemon running. In a second terminal, change to the same repository directory and run:

```bash
bin/wf --state-dir "$HOME/.local/state/workflowz" ui
```

Use the same state-directory path as the daemon. The command prints a local browser address and
a pairing code. Open the printed address and enter that code on the page. Keep the code private;
it is single-use and expires after five minutes. To obtain a replacement, run the command again.

Successful pairing opens **Workflow runs**, with **Connected / localhost** near the top.
The first two panels are **1. Choose a workflow** and **2. Select project inputs**.
The inputs panel is disabled until you load or create a workflow. The editor is farther down
the page. Being connected does not start execution.

## Load the command-only example

Begin with [examples/command-only.yaml](../../examples/command-only.yaml). This workflow runs
`node --version`, then `git status --short`, then finishes. It uses no agents or task checklist
and its commands do not modify repository files.

In **1. Choose a workflow**:

1. Click **Choose File** and select `command-only.yaml` from the repository's `examples` directory.
2. In **Original workflow directory (absolute)**, enter the full path to that `examples` directory.
   For a checkout at `/home/you/workflowz`, enter `/home/you/workflowz/examples`.
3. Click **Load workflow file**.

The browser supplies file contents but not the original absolute path. The separate directory
field tells the runner where relative paths in the workflow begin. This sample sets its project
root to `..`, so its project is the parent of `examples`: the repository root.

After loading, **2. Select project inputs** becomes available and **3. Edit workflow** is populated.
Loading makes the definition available to inspect or edit; it does not execute it.

### Validate the loaded example

In **2. Select project inputs**, the project root should be the repository directory.
For this command-only example, leave instruction files and the Markdown checklist path empty,
and leave **Include prechecked tasks explicitly** unchecked. Faint examples inside empty fields
are placeholder text, not configured paths.

Click **Preview tasks & validate**. This checks the workflow and configured paths without running
commands. The current interface puts the result in **Task preview**, below the entire
**3. Edit workflow** section; the result may be outside the visible part of the page.

For this example, a successful preview says:

```text
No task source. This is a graph-only workflow. No run created.
```

Here, “graph-only” means a workflow without a task checklist. It is expected for this sample.
The message means the preview succeeded and no run was created. A flicker or lack of visible
feedback near the button does not establish whether the request succeeded; inspect the result.

### Create a ready run

A workflow is a reusable definition; a run is one execution instance with its own saved status
and history. To prepare this example, click **Import tasks & create ready run** in
**2. Select project inputs** once. The button also works for workflows without tasks. Saving a
configured workflow separately is not required for this example.

On success, the current UI adds a message beginning **Created ready run** near the top of the
same page and shows a run dashboard above the workflow-selection panels. It does not navigate to
a new page. If the button merely appears to flicker, scroll to the top and inspect the result
before clicking again; creating another run would produce a separate execution instance.

The confirmation also says **Tasks frozen from the current source. Execution has not started.**
That is generic wording: this example has no task checklist to import. The newly created run is
prepared for execution, and its saved ID identifies it for subsequent inspection and control.

The dashboard heading includes the run ID, and its status should be **ready**. Look for
**Current stage** and **Execution controls**. A ready run has not begun executing its commands;
**Start** is a separate action. If an error appears instead, inspect it before retrying creation.

### Start the run and recognize completion

In the run panel's **Execution controls**, click **Start** once. The example executes
`node --version`, executes `git status --short`, and reaches its final `done` step.
These commands make no model calls and do not modify repository files.

The example is quick enough that you may not see the temporary **running** state. On completion,
the run panel shows **completed**, with **Current stage** set to **done · end**.
**No active task** is expected because this example has no task checklist.

The status fields mean:

| Display | Meaning |
| --- | --- |
| `Run run_…` | The saved ID of this execution instance. |
| `completed` | Execution reached the workflow's end step. In this example, both commands must succeed to reach it; a failed command would pause. |
| `revision 1` (or another number) | The saved workflow-definition version used by this run. |
| `inspected event 15` (or another number) | The latest event ID included in the inspected run state. It is not a count of workflow steps. |
| `Inspected … · auto-refresh every 2s` | When the browser last inspected the saved run state, and its refresh interval. |
| `done · end` / `Engine stage` | The current step is the runner's built-in end action. No command or agent is executing there. |
| `0s since run start` | Elapsed time is displayed in whole seconds, rounded down. A run taking less than one second can show zero. |
| `No active task` | There is no currently selected checklist item. This is expected for this taskless example. |

### Inspect the run history

Scroll farther down the same run panel to **Events**. These entries record lifecycle changes,
command execution and routing decisions. Each has an event ID, timestamp, event type and technical
data. In this example, find entries referring to `node_version` and `git_status` to follow the
two command steps through the run. Several events can describe a single step.

The current UI displays raw event details rather than a concise step summary. Read the overall
status and current stage first, then use the events when you need to investigate what happened.
Agent-report sections can be empty in this example: commands report success through their exit
status, while agent steps submit an explicit report.

## Agent walkthrough: OpenCode with a free model

The next walkthrough uses **OpenCode** with **DeepSeek V4.1 Flash Free**:

| Workflow setting | Value |
| --- | --- |
| Harness | `opencode` |
| Model | `opencode/deepseek-v4.1-flash-free` |

This exact identifier was confirmed in the installed OpenCode v2.0.32 model catalog.
OpenCode's [model pricing](https://opencode.ai/v2/docs/console/models/) lists this variant as
free at the time of this walkthrough (2026-10-20). Free offerings can change; recheck pricing
when repeating this later. Select the explicit free variant rather than leaving model selection
to a default. This walkthrough does not authorize a paid substitute.

Agent workflow configuration and live reporting with this model have not yet been completed;
the following steps will be documented as they are tried. Catalog availability alone does not
prove a provider request or report submission will succeed.

### Create a new workflow draft

In **1. Choose a workflow**, set **Original workflow directory (absolute)** to the repository
root, then click **New workflow in this directory**. This opens a draft in the existing editor;
it does not open a separate page or create a run.

After the draft loads, the first line under **2. Select project inputs** says:

```text
New workflow · draft · /absolute/path/to/workflowz
```

Under **3. Edit workflow**, the YAML should have `name: New workflow` and one step, `done`, of
kind `end`. A previously inspected completed run can remain above these panels; that run panel
is separate from the reusable workflow draft. The new-draft button currently has no prominent
success message, so check the draft name before continuing.

### Add an agent step

Under **3. Edit workflow**, scroll past the YAML box to the visual controls. In
**Stages · display order only**, enter `inspect` in **New stable step ID**, choose `agent` as
**New step kind**, and click **Add stage**. A details panel headed **inspect · agent** appears.

The new step initially defaults to the `codex` harness with a placeholder prompt. Those settings
must be configured for this OpenCode walkthrough before creating or starting an agent run.

At this point, the validator reports two unfinished connections:

- **incomplete_transition:** `inspect` declares the outcome `complete`, but no rule says what to do after that result.
- **unreachable_step:** the workflow still starts at `done`, so it would finish without reaching `inspect`.

These messages are expected while building this draft. The intended route is to start at
`inspect`, then go to `done` when the agent reports `complete`. Display order does not determine
execution order; the selected start step and outcome transitions do.

## Troubleshooting startup

### State directory permissions

If starting the daemon prints:

```text
state directory must be owned by the current user with mode 0700
```

the directory used to save runs and private connection details has unsuitable ownership or
permissions. `0700` means only its owner can list, access and modify it. An existing directory
with `0755` permissions allows other users to list/access it, so startup rejects it.

The default directory is `~/.local/state/workflowz`. If `XDG_STATE_HOME` is set, the default is
`$XDG_STATE_HOME/workflowz`. `WF_STATE_DIR` overrides that default, and an explicit `--state-dir`
overrides both. Check the selected directory rather than changing permissions on the repository.

For the default directory, when it already belongs to your account:

```bash
chmod 700 "${XDG_STATE_HOME:-$HOME/.local/state}/workflowz"
bin/wf daemon start
```

If you selected another state directory, use that exact path with `chmod` and the daemon command.
This changes directory access permissions; it does not delete saved runs. If the directory belongs
to another account, check why that path was selected before changing ownership.
