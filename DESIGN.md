# Workflowz UI brief

## Status

- The React UI built in the previous round was rejected on usability and appearance. The engine,
  saved state and execution contracts are unchanged and remain the baseline.
- Direction C (Workbench) was selected and its main screens approved on 2026-10-21 (see
  Decisions). Production work starts with the open questions below, then one React slice at a time.
- The target form is a desktop app (Electron proposed). Do not build the desktop shell or change
  daemon lifecycle yet.
- The full earlier brief, slice logs and decision history are archived in
  [design-brief-2026-10-21.md](archive/history/design-brief-2026-10-21.md).

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
- Project folder can be pasted or browsed on the daemon's machine.
- Advanced branching, retries, task loops, policies, YAML and paused-run intervention remain
  available in deliberate places.

## Screens

- **Workflows:** saved workflows, import file, new workflow.
- **Workflow editor:** graph view and form view of the same workflow, with the checker.
- **Runs:** runs grouped by status, with an obvious way to open one.
- **Run details:** status, what happens next, step history, and the graph showing the path taken.

## Must not change

- Save creates an immutable revision. Create run only prepares a run; Start is a separate action.
- Before Start, the interface states that agents and commands can change user-accessible files, and
  that stopping does not undo those changes.
- Paused-run choices each need a reason. Nothing retries automatically after a crash.
- Closing or reloading the browser does not stop execution. Pairing, loopback Host/Origin checks,
  and the CSP stay as they are.
- The workflow is a deterministic graph of steps and results. No supervisor AI decides what runs next.

## Open questions

- None blocking. Revisit the quit and reopen behavior after using the first desktop build.

## Design process

1. Make three dark-theme directions. Each shows the same sample workflow twice: a graph view with
   the checker, and a form editor. Sample: Pick task → Implement (Codex agent) → Review (Pi agent)
   → Done, where "blocked" pauses for the owner. Use Claude Design. Prototypes are not production code.
2. The owner picks a direction by looking at it. Record the choice in Decisions with the date.
3. Implement one complete slice at a time in React + TypeScript, following AGENTS.md checks.
4. Rewrite the user guide after the redesigned interface works.

Owner feedback in detail: [DEMO_FEEDBACK.md](DEMO_FEEDBACK.md). Engine contracts: [archive/](archive/README.md).
The old prototypes in [prototypes/design-directions/](prototypes/design-directions/index.html) are
superseded and will be removed when the new design is implemented.

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
- **2026-10-21:** Project folders are pasted as paths in the browser-served UI during development.
  The desktop app must use the operating system's folder picker; this is required, not optional.
  The browser UI does not gain daemon filesystem browsing.
- **2026-10-21:** Effort uses sensible per-harness defaults. The owner can change each harness's
  default, and custom values entered before are offered again. These are app settings, not
  workflow fields.
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
