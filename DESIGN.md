# Workflowz UI brief

## Status

- The React UI built in the previous round was rejected on usability and appearance. The engine,
  saved state and execution contracts are unchanged and remain the baseline.
- The next round compares new visual directions with realistic content before any production UI work.
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

- Graph layout: automatic only, or manual placement with automatic tidy-up?
- Folder selection: paste a path, browse the daemon's filesystem, or both?
- Harness effort: presets per harness, remembered custom values, or both?
- Where command output appears on a step.
- Desktop shell behavior: single window only, or also a tray icon and background service?

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
