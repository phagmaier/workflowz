# Workflowz — approved Workbench design

## Status

The working beta's approved Workbench (direction C) is implemented, including Graph/Form authoring, the
checker, grouped Runs, results/history/map, paused decisions and the user guide. The owner
walkthrough and realistic multi-harness evaluation are complete. Current work is refining
the product from [IMPROVEMENTS.md](../IMPROVEMENTS.md), one selected slice at a time.

The OpenCode long-wait transport fix is complete; lifecycle/recovery guarantees remain.
The disposable evaluation app and old setup scaffolding were retired after preserving
[the reports/evidence](README.md#evaluations). Completed slice details and past verification
counts are in [implementation history](history/workbench-implementation-2026-10-22.md).
Desktop packaging and automatic service lifecycle remain deferred. Future proposals below
are separate from implemented behavior and the active improvement backlog.

## Goal

The owner should understand what a workflow will do, check it visually, run it or change it, and
see what happened, without learning internal field names or hunting for controls.

## The owner's workflow

1. Write a rough idea in a text or Markdown file, or have an agent generate the workflow file.
2. Import that file (import already exists).
3. Check it visually: steps as nodes, outcomes as arrows, and a checker that lists problems.
4. Run it, or edit it until it is right. Both editors must show the same workflow.

## Requirements

- Polished, clean, sleek desktop application. Dark theme.
- Uncluttered. No bloated pages. It should be very clear what the owner is doing on each screen.
- A visual graph editor and a standard form editor, both available for the same workflow.
- A visual checker that explains missing connections and problems in plain words.
- Plain step names ("Agent", "Command"). Creating a step and configuring it are separate actions.
- Feedback appears at the action that caused it, and the created or selected object stays visible.
- Command entry is natural (for example `node --version` on one line).
- Command output is visible after a run, not only success or failure.
- Project folder can be pasted as a path in the browser UI. The desktop app must provide the
  operating system's folder picker; daemon filesystem browsing is outside the browser UI scope.
- Advanced branching, retries, task loops, policies, YAML and paused-run intervention remain
  available in deliberate places.

## Screens

- **Workflows:** saved workflows, import file, new workflow.
- **Workflow editor:** graph view and form view of the same workflow, with the checker.
- **Runs:** runs grouped by status, with an obvious way to open one.
- **Run details:** status, what happens next, step history, and the graph showing the path taken.

Finished rows expose **View results** and **Map** directly. A completed or stopped run's
status summary gives **View map** a prominent action; while on Map, that action becomes
**View results**. It opens the chosen view and moves keyboard focus into its content.
The existing History/Map links, inspected result and per-attempt output choice persist
when switching views within the run. These are read-only navigation actions. OWNER-1's
owner discoverability check remains tracked in [the backlog](../IMPROVEMENTS.md#owner-1--completed-run-navigation).

The run overview keeps task progress, step activity and run time separate. Task names the
task-loop phase and says **Run not finished yet** once every task is done but the run
continues. Current step adds the attempt's last recorded stage and time since that attempt
started. Elapsed states paused time from recorded pause intervals, and **Tasks done** counts
tasks only. Workflowz shows no overall percentage, remaining-work prediction or live output,
because it cannot observe them. The design follows F3 in [the backlog](../IMPROVEMENTS.md#f3--progress-and-timing-during-long-steps).

Technical failures are identified beside the paused-run heading and above the selected
attempt's Report/Output tabs. The summary includes the available safe cause, including
recognized OpenCode bridge codes. An earlier accepted report remains inspectable and is
identified separately from the execution failure. Process exit status remains evidence;
an exit of zero can accompany unconfirmed execution. Historical records remain immutable.

## Must not change

- Save creates an immutable revision. Create run only prepares a run; Start is a separate action.
- Before Start, the interface states that agents and commands can change user-accessible files, and
  that stopping does not undo those changes.
- Paused-run choices each need a reason. Nothing retries automatically after a crash.
- Closing or reloading the browser does not stop execution. Pairing, loopback Host/Origin checks,
  and the CSP stay as they are.
- The workflow is a deterministic graph of steps and results. No supervisor AI decides what runs next.

## Implementation sequence

Continue the browser-served React UI one complete slice at a time, following the checks in
[AGENTS.md](../AGENTS.md). Graph and Form authoring with their shared checker, the grouped Runs page
and run details are built and have completed the final interface review. The completed
[user guide](USER_GUIDE.md) documents their implemented behavior.

Bundled Manrope/JetBrains Mono fonts and the required CSP change remain undecided and do not
block layout work. Use system fonts until that decision is resolved. Desktop packaging,
automatic service management, folder picking, notifications and quit/reopen behavior are
later work; do not implement them as part of the browser UI slices.

The approved visual reference is the design canvas linked in Decisions. Earlier feedback
and implementation records are retained in [history](history/README.md); rejected prototype
assets were removed after replacement. [Runtime references](README.md#technical-references)
preserve the engine contracts.

## Decisions

- **2026-10-21:** The owner chose a desktop application as the product form. Electron is proposed,
  not final.
- **2026-10-21:** The owner rejected the appearance and usability of the previous React UI. Earlier
  acceptance is superseded.
- **2026-10-21:** The owner asked for dark theme, a visual graph editor, and a standard form editor
  for the same workflow.
- **2026-10-21:** The owner selected direction C (Workbench) from the three prototypes on the
  [design canvas](https://claude.ai/artifact/NekAZyd42Td5jnDc3Yci6P):
  - Layout: left sidebar with workflows, runs grouped by status and local-service connection
    health; Graph view with outcomes listed on each node and a bottom checker dock with a fix
    action per problem; Form view as a steps table with a side panel for the selected step.
  - Visual theme: C's near-black neutral with a teal accent and orange for problems
    (Manrope + JetBrains Mono in the prototype).
  - Terminology: the view switch is "Graph / Form". Branches are "Outcomes" (not "Results" or
    "reports"), matching the workflow file's `outcomes`.
  - Fallback: if testing shows C's side panel is cramped or too IDE-like, use B's vertical step
    list with its plain-language next-step sentences for configuring steps, keeping C's layout,
    theme and terminology.
- **2026-10-21:** The owner approved the C screens for Workflows, Runs, a run ready to start, and a
  paused run (same canvas). Command and agent output appears in the run's step history, on each
  attempt's Output tab beside its Report.
- **2026-10-21:** Paused-run decisions keep Resume explicit. "Run this step again" needs only a
  reason and Resume; "Continue from another step" and "Mark this task done" first show **Apply**
  (the run stays paused), then Resume; "Stop the run" is a single action.
- **2026-10-21:** Graph layout is automatic with a Tidy up action. Manual placement is deferred;
  it would need saved node positions, which the workflow format does not have.
- **2026-10-23:** Implemented for F2 (not a separate owner decision): large graphs are inspected
  through route focus rather than a larger Fit or collapsed sections. The selected step's inspector lists Leads to and Reached from in
  readable text, with step links that move the selection along a route. The graph highlights
  that step's routes, fades the others and outlines connected steps; zoom keeps it in view.
  Every route stays drawn. Collapsing repair sections remains an option only if owner use
  shows route focus is insufficient. The run Map's separate vertical layout is unchanged.
- **2026-10-21:** Project folders are pasted as paths in the browser-served UI during development.
  The desktop app must use the operating system's folder picker; this is required, not optional.
  The browser UI does not gain daemon filesystem browsing.
- **2026-10-21:** Effort uses sensible per-harness defaults. The owner can change each harness's
  default, and custom values entered before are offered again. These are app settings, not
  workflow fields.

## Future product proposals (not implemented or scoped)

- **2026-10-22: Named agent profiles.** Let owners create reusable, named profiles such as
  `reviewer`, each storing a harness, model and effort combination. Selecting a profile while
  configuring an agent step fills those settings, while keeping the chosen values visible and
  editable. Profiles are user-created shortcuts, not built-in roles or runtime agents.
- **2026-10-22: Assisted workflow drafting.** Given a project specification, its supporting
  documentation and a high-level request, an authoring assistant could propose a sensible
  deterministic graph, choose where implementation, review and command steps belong, assign
  available agent profiles or explicit model settings, and produce importable YAML. It should
  surface assumptions and validate exact harness/model/effort selections rather than silently
  substitute. The owner reviews the YAML in Graph/Form and the Checker; generating a workflow
  does not save, create a run or start execution. The saved workflow remains the sole authority
  for runtime routing; this proposal does not add a supervisor LLM. These ideas are recorded for
  future scoping and do not authorize implementation.
- **2026-10-22: Harness-aware model and effort selection.** After an owner selects a harness,
  offer its locally configured models; after model selection, show only effort levels that
  harness/model combination advertises. Keep catalog discovery separate from live provider
  reachability, which cannot be inferred from a listed choice alone.
- **2026-10-22: Harness-native skill selection and support.** Make skills discoverable to each
  selected harness visible while configuring an agent step, with a way to choose or explicitly
  request applicable skills. Preserve each harness's native skill discovery and supporting files
  rather than treating every skill as plain prompt text. Make the effective harness tools,
  configuration and permission mode clear for a Workflowz run. These are future proposals, not
  current behavior or implementation authorization.

## Deferred desktop behavior

These decisions apply when the desktop shell is designed and built. Revisit quit and reopen
behavior after using the first desktop build. Electron remains proposed, not final.

- **2026-10-21:** The desktop app is a single window that starts and stops the local service
  itself, replacing the separate terminal and manual pairing. This changes daemon lifecycle and
  browser authority, so the details are designed with the desktop shell, not in the early slices.
- **2026-10-21:** Quitting during an active run (owner delegated the details; revisit after use):
  - The app warns and offers: **Keep running in the background** (highlighted), **Quit after the
    current step**, **Stop the run and quit**, and Cancel.
  - *Background:* the window closes; the service keeps running, with a tray icon only while that
    lasts. A system notification appears when a run is waiting for the owner, finishes or stops;
    clicking it opens that run. Once no run is executing and no window is open, the service shuts
    itself down after settlement. Paused runs are durable and resume after reopening.
  - *After the current step:* uses the daemon's existing pause-after-current shutdown. The dialog
    shows which step it is waiting for and offers "Stop now instead". The run stays paused and can
    be resumed later.
  - *Stop and quit:* uses the existing stop, which ends the run; the reason is prefilled and
    editable. Killing a step mid-way cannot be resumed cleanly, which is why the after-step option
    exists. No new engine behavior is added for quitting.
- **2026-10-21:** Opening the app: one rule, not separate modes. It reopens where the owner left
  off, unless something happened while it was closed. One run waiting for the owner, or finished
  or stopped since last viewed, opens that run; several open Runs with them marked "Since you were
  away". The app keeps a per-run "last viewed" marker as an app setting and compares it with the
  run's latest event; engine state is unchanged.
