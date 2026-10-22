# Workflowz — approved Workbench design

## Status

- The React UI built in the previous round was rejected on usability and appearance. The engine,
  saved state and execution contracts are unchanged and remain the baseline.
- Direction C (Workbench) was selected and its main screens approved on 2026-10-21 (see
  Decisions). Production work proceeds one React slice at a time.
- Slice 1 (2026-10-21): C's dark theme for the whole app, the sidebar (workflows, run groups,
  connection), and the Workflows page with import as a drop zone. Other screens keep their
  earlier layout in the dark theme until their slices. Fonts fall back to system faces; bundling
  Manrope/JetBrains Mono needs a `font-src 'self'` CSP addition, not yet approved.
- Slice 2 (2026-10-21): editable Graph view with automatic layout, Tidy up/Fit/zoom, declared
  Outcomes and their destinations on every nonterminal node, branch and return connections,
  and selected-step settings. Owners can add, rename, delete and configure steps, add Outcomes,
  choose destinations (including creating a destination step), and choose the first step.
  Missing destinations remain visible and repairable. Graph, Form and YAML use the same draft
  and daemon validation; graph layout never changes execution order or the saved document.
- The bottom checker dock is available in Graph, Form, Project, Rules & limits and YAML. Its Fix
  actions open the relevant step/outcome, first-step selector, project field, rules/limits or
  YAML; advanced fields open before focus moves. Pending/failed checks cannot enable stale
  fixes or saving. Valid imports open in Graph, as do parsed imports with routing problems;
  malformed/schema-invalid YAML and failed import checks retain the exact text in YAML.
- Slice 3 (2026-10-21): Form uses C's steps table, with Outcome connections beside each step,
  a selected-step settings panel and the shared bottom checker. Outcome buttons and Fix actions
  focus the relevant field without leaving Form. Keyboard reordering changes display order
  only. Settings stack below the table on smaller screens, with a Back to steps action.
- Shared Graph/Form fields now accept commands on one line, with quotes and backslash escaping
  for explicit arguments. Unfinished quotes/escapes and implicit shell operators remain visible
  and block saving; shell scripts use an explicit `sh -c '…'`. Existing argument arrays, including
  empty arguments and embedded newlines, retain their meaning. No shell is added by the editor.
- Effort preferences are saved per harness in this browser, with recent custom values offered
  again. Empty uses the harness's own default; OpenCode variants depend on the provider/model.
  Saved preferences apply to new agent steps and new workflow examples. Existing/imported steps
  keep their effort unless the owner explicitly changes it or chooses Use my default. The
  workflow still stores its selected `reasoning_effort`; preference defaults/history are separate
  browser settings. If browser storage is unavailable, preferences last for the current tab.
- Slice 4 (2026-10-21): Runs uses four visible status groups: Waiting for you (paused and
  interrupted), Ready to start (draft and ready), Running (running and pausing), and Finished
  (completed and stopped). Each group shows its count, purpose and empty state, with newest
  runs first. Rows retain workflow names, run/revision IDs, status, current step and timestamps;
  both the workflow name and an explicit Open action lead to run details. Opening never starts
  or resumes work.
- Sidebar status links open the matching Runs group and focus its heading. The selected group
  has a shareable hash route, survives reload and follows browser Back/Forward. All groups stay
  visible. Repeated activation returns to the heading. Background polling preserves keyboard
  focus on a run's name or Open link even when its status moves it to another group, without
  scrolling the page. Delayed first reads and retries preserve controls focused while waiting.
- Runs distinguishes loading, no runs, empty groups and failed reads. Failed refreshes keep the
  last known rows/counts with an out-of-date notice and a retry action, including when the last
  successful list was empty. Tables become cards with two columns on tablets and stack into
  labelled rows on phones, keeping long workflow names and run identifiers readable.
- Slice 5 (2026-10-21): Run details uses the Workbench status overview and fact strip, explicit
  execution/paused-run controls, a history workspace and a read-only execution-path map. The
  ready view previews the authored steps, Outcome destinations and imported tasks. Run metadata,
  imported task bodies and historical attention stay in Run information. History selections
  retain their immutable revision definitions; the map links back to the selected step in history.
- Attempts have keyboard-accessible Report / Output tabs. Commands open on Output; agents open
  on Report. Output reads at most 64 KiB of saved standard output and available error diagnostics,
  with distinct loading, empty, unavailable and failed-read states. This is saved capture from
  settled invocations, not live streaming or access to private log files. Command stderr now uses
  the same bounded diagnostic excerpt as agent stderr. No process/routing behavior changes.
- Paused choices use plain labels and Apply for manual results, another step or task completion.
  Apply leaves the run paused, selects Resume and carries the given reason forward for review;
  Resume remains a separate explicit action. Successful delayed replies preserve newer choices
  and reasons. Failed requests keep the form and never resend themselves. On smaller screens,
  history and details stack, with View selected step moving keyboard focus to the details.
- Final whole-interface review (2026-10-21): the completed Workbench screens were reviewed
  together for correctness, usability, accessibility and visual consistency. Workflows now has
  a persistent Refresh/retry action, keeps saved rows visible after failed refreshes, distinguishes
  unavailable run status from no runs, and updates the sidebar's saved revisions on refresh.
  Recovering an initial run read keeps retry focus unless the owner has moved elsewhere. Status
  changes in run details refresh the sidebar counts without waiting for its next regular poll.
- Interacting with an attempt's details pins that history selection through background progress.
  Report/Output choices are remembered per attempt for this page load, including returning from
  Map. Report's static result panel is reachable by Tab. Output identifies stdout/diagnostic
  capture limits outside the output scrollers and shows the latest settled invocation's
  diagnostics; a clean correction no longer inherits earlier stderr. Earlier invocation evidence
  stays in Technical details.
- The main Workbench screens, final interface review and [end-user guide](USER_GUIDE.md) are
  complete. The guide covers the current browser workflow and terminal recovery, with advanced
  usage kept in reference sections. Saved/new-workflow links open Form; Graph remains the first
  view choice and import view. Desktop work and a real-provider walkthrough remain separate.
  Documentation links and workflow/CLI examples are checked; nine focused offline Chromium
  scenarios pass, with current screenshots inspected against the guide.
- Graph limitations: manual placement is deferred. Large graphs use local scrolling and zoom;
  Fit can make labels small. On narrow screens, settings stack below the graph. Technical
  failure rules and policies remain accessible in step settings and Rules & limits; the graph
  draws normal Outcome destinations. Inherited routes are shown only from a current daemon
  check, with an explicit “check needed” label when unresolved. System fonts and CSP are unchanged.
- Slice 2 verification: typecheck and full lint pass (the existing CSS warning remains), core
  tests pass, and offline browser checks cover branches, loops, missing destinations, checker
  navigation, delayed/failed checks, shared draft state, exact imported text, keyboard use,
  long labels and narrow screens. Desktop and phone screenshots were inspected visually.
- Graph return lanes have left canvas padding for every outcome, including fourth-outcome
  self-loops and returns to the first column; regression checks cover their full SVG bounds.
- Slice 3 verification: typecheck and lint pass (the existing CSS warning remains), all 853
  standard tests and 42 offline browser checks pass. Coverage includes quoted/unfinished commands,
  failed checks, per-harness preferences and storage failures, checker focus, reordering, selection
  scrolling and long labels. Final desktop, tablet and phone screenshots were inspected visually.
- Slice 4 verification: typecheck and lint pass (the existing CSS warning remains), with 854
  standard tests and 48 offline browser checks passing, run sequentially with four-CPU affinity.
  Coverage includes all statuses, group links/focus/history/reload, explicit Open without
  execution, focused runs moving between groups, delayed loading without focus theft, initial
  and stale read failures, retry focus, empty groups, unknown revisions and long labels.
  Desktop tables, tablet cards and phone layouts were inspected visually; keyboard checks and
  no-page-overflow checks pass from 320 to 1440 px, including both sides of the responsive
  breakpoints. Refresh and retry share one button to retain keyboard focus.
- Slice 5 verification: typecheck and lint pass (the existing CSS warning remains), with 856
  standard tests and 54 offline browser checks passing. Full suites ran sequentially with
  four-CPU affinity. Coverage includes output read authority/scope/UTF-8 bounds, command stderr,
  inert output text, late replies, retained tab contents, retry focus, Apply versus Resume,
  newer drafts and inspection focus during pending actions, immutable historical definitions,
  stale reads and interrupted recovery guidance. Ready, paused, output and map screenshots were
  inspected on desktop, tablet and phone; keyboard and overflow checks cover 320–1440 px.
- Final review verification: typecheck and lint pass (the existing CSS specificity warning
  remains), with 857 standard tests and 58 offline browser checks passing. Seven focused
  workflow/import/run-navigation checks also pass on the final shared workflow list. Full suites
  ran sequentially with four-CPU affinity. Fresh desktop, tablet and phone screenshots were
  inspected across Workflows/import, Graph/Form/checker, grouped Runs, ready/paused/completed
  details, Output and Map. Keyboard/focus and overflow checks cover 320–1440 px. Documentation
  links and the narrow output request example were checked. Browser verification is Chromium
  only; agent execution uses offline fixtures, without live provider calls.
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
- Project folder can be pasted as a path in the browser UI. The desktop app must provide the
  operating system's folder picker; daemon filesystem browsing is outside the browser UI scope.
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

## Implementation sequence

Continue the browser-served React UI one complete slice at a time, following the checks in
[AGENTS.md](AGENTS.md). Graph and Form authoring with their shared checker, the grouped Runs page
and run details are built and have completed the final interface review. The completed
[user guide](USER_GUIDE.md) documents their implemented behavior.

Bundled Manrope/JetBrains Mono fonts and the required CSP change remain undecided and do not
block layout work. Use system fonts until that decision is resolved. Desktop packaging,
automatic service management, folder picking, notifications and quit/reopen behavior are
later work; do not implement them as part of the browser UI slices.

The approved visual reference is the design canvas linked in Decisions. Earlier feedback,
guides and rejected prototypes are indexed in the [archive](archive/README.md); they are
historical context. Engine contracts remain available there as technical references.

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
