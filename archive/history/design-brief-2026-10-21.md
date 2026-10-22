# Workflowz — UI design brief

> Archived on 2026-10-21. This brief and its acceptance statements precede the approved Workbench
> redesign. Follow [DESIGN.md](../../DESIGN.md) and [AGENTS.md](../../AGENTS.md) for current work.

## Goal

Make Workflowz understandable through its interface. The owner should be able to create a
workflow, understand what it will do, start it and inspect its results without being coached
through internal field names and scattered controls.

**Current status:** All four slices of the selected React + TypeScript direction are implemented
at `/ui/`. A subsequent live test drive exposed substantial usability and appearance problems;
the owner no longer considers the interface satisfactory. The existing engine remains the
baseline. The [user guide](react-user-guide-2026-10-21.md) describes the implemented interface.

## What the walkthrough established

The command-only workflow ran successfully. The owner could not reliably tell what common
actions did: validation, run creation and new-draft creation appeared to do nothing because
results appeared elsewhere on a long page. Workflow editing mixed unfinished graph diagnostics,
manual apply controls, technical IDs and unrelated run information. Run history was raw event data.
The owner stopped the walkthrough because these interactions prevented learning.

This calls for a substantial navigation and interaction redesign. Preserve these findings as
context, without maintaining a separate task for every symptom. The [unfinished walkthrough](usability-walkthrough.md)
is available if particular observations or verified startup details are needed.

## Product shape to explore

Use separate navigable views with browser back/forward behavior and a clear current location:

- **Workflows:** saved definitions/revisions, useful starting examples and a clear Create workflow action.
- **Create / edit workflow:** focused project setup and step authoring; readable labels and direct next-step choices. Show which draft is being edited and whether changes are saved.
- **Runs:** executions and their statuses, with an obvious way to inspect one.
- **Run details:** ready/running/completed/paused status, relevant controls, readable per-step results and technical evidence on demand.

A workflow draft and an inspected run must never look like competing sections of the same form.
A successful action should leave the user looking at the relevant result, with visible feedback.
Creating a run still prepares it; Start remains an explicit action.

The editor should support adding an outcome and choosing its action directly. A user should
not have to add a pause rule as an intermediate editing trick. Explain missing connections in
context. Preserve branching, retries, custom outcomes, task loops, policies, YAML and paused-run
intervention; advanced capabilities need deliberate homes rather than all being expanded at once.

## How we will choose a design

First compare three distinct design directions using the **same workflow editor and run-detail
content**. Show actual screens or clickable prototypes. Each direction should have a clear
navigation model, visual hierarchy, typography, density and interaction approach.

Possible starting directions are a calm developer workspace, a guided builder, and a visual
workflow studio. These are exploration candidates, not chosen layouts or approved new features.
A complex graph canvas is optional and should earn its place through usability.

Choose based on whether the owner can understand where they are, what will run, what just happened
and what they can do next. Then expand the chosen direction into a complete main journey and
its empty/loading/error/invalid/running/paused/disconnected states. Settle components and frontend
integration after that, implement in complete slices, and write the tutorial against the result.

## Reusable design prompt

Use this with the repository context and current screenshots when available:

> Redesign Workflowz, a local desktop-oriented web app for coding-agent workflows. The engine
> works, but its current giant single-page UI is too confusing to use even with guided instructions.
> Help me choose a professional design before production implementation.
>
> Propose three meaningfully different visual and interaction directions. For each, show the
> same two screens: a workflow editor and a run-detail page. Use realistic sample content and
> make navigation and the primary action obvious. Include a concise explanation of the tradeoffs.
> Give me actual mockups or clickable prototypes, not just a written list of recommendations.
>
> The full app needs Workflows, Create/Edit workflow, Runs, and Run details as distinct navigable
> views. Keep a clear current location, consistent navigation, readable typography, deliberate
> spacing, and restrained use of color. Avoid putting every feature on one long page.
>
> Make basic authoring understandable: choose a project, add agent/command steps, choose the
> agent/model and prompt, and say what happens after each outcome. Support direct next-step
> choices without requiring knowledge of engine IDs or temporary editing workarounds. Preserve
> advanced branching, policies, retries, task loops, YAML and intervention in appropriate views.
>
> Put loading/success/error feedback at the action. Make created runs and active drafts apparent.
> Show a readable step-by-step run history, with technical event data available on demand.
> Account for empty, incomplete, running, blocked and disconnected states, keyboard focus and
> responsive layout. Use helpful interface copy instead of requiring a manual to explain controls.
>
> Use the existing code as the functionality source. Preserve the engine, saved state and
> execution/recovery contracts. Prototypes use sample data and must not call the daemon or
> providers. We will choose and refine a direction before implementing the frontend in React
> and TypeScript. Do not add unrelated product features or rebuild the backend.

## Decisions

The owner chose **UI overhaul before further tutorial work**.

**Desktop direction (2026-10-21):** The owner selected a desktop application as
the intended product form. Electron with the existing React + TypeScript frontend
and daemon is the proposed integration, not a completed or final technical choice.
Opening the application should manage connection/startup without routine terminal
commands or manual pairing-code entry, and make background service versus active
workflow status clear. Native folder selection should accompany pasted paths.
Preserve explicit Start/Resume, safe process settlement, recovery and authority
boundaries when designing the integration.

The owner explicitly deferred desktop implementation: **do not build it now**.
Next work remains comparing visual and interaction proposals for the desktop
experience. No desktop shell, packaging or daemon lifecycle changes have been made.

**Live test drive feedback (2026-10-21):** The command and two-agent demos worked,
but the owner rejected the interface's appearance and usability after using it.
The earlier acceptance below is historical, not current design acceptance.
See [demo feedback](demo-feedback-2026-10-21.md) for observed interaction problems.

The next proposals should feel like a polished application: restrained, modern
styling, clear visual separation, less information competing on each screen,
and focused editing. Command entry requiring one argument per line was a major
problem. Labels such as “Ask an agent” were rejected; use clear step-type names
and make creation versus configuration apparent.

Project selection should support pasting a path and browsing the daemon machine's
filesystem. The exact picker interaction and any required API are not decided;
do not imply that an ordinary browser file picker supplies absolute server paths.

Compare a visual graph workspace with selectable, connected Agent and Command
nodes and a focused step editor, against sequential authoring with focused
navigation into branches. The owner wants the graph available during authoring
or easy to inspect while checking work, with substantially better presentation.
Expandable children, failure routes and optional review steps are exploratory
ideas, not approved schema changes or mandatory stages. “New window” expresses
the desire to leave the cluttered form for focused branch editing; the specific
navigation mechanism remains to be tested. No new direction has been selected.

Additional test-drive requirements and future ideas:

- Harness configuration should offer supported effort presets and/or remember
  user-entered effort values per harness. Persistence, scope and capability
  validation still need design; this is not permission to change global harness
  configuration.
- Missing agent output makes execution opaque. Make useful execution evidence
  discoverable; showing agents actively working is a later exploration, dependent
  on each adapter's actual output capabilities.
- Pairing codes and manual daemon startup/shutdown felt unacceptable for ordinary
  use. The user could not tell whether work remained active. Explore an integrated
  application lifecycle with clear service and run status; preserve local browser
  authority protections and explicit execution. Clarify whether “thread” means
  the daemon, workflow run or harness conversation before changing behavior.
- Concurrent agents are a future wishlist item only, explicitly not for current
  implementation. No change to sequential execution or coordinator ownership is
  authorized by recording it.

For the next design comparison, settle visual direction with realistic populated
screens before implementing another full interface. Evaluate clickable authoring
and run-inspection journeys, including launching/opening the app, selecting a
folder, configuring harness/model/effort, adding a branch, and finding execution
output. Review the same content across alternatives, then implement one complete
slice and test it with the owner before expanding.

**Owner acceptance (2026-10-21):** The owner accepted the completed developer workspace interface.
All four frontend slices and follow-up regression fixes are complete.

**Selected direction (2026-10-20):** Direction A, the developer workspace, is the base. It
borrows two elements from B and one from C. The three prototypes remain in
[prototypes/design-directions/](../prototypes/design-directions/index.html) as reference until
the implementation replaces them.

- **Structure (A):** persistent sidebar (Workflows, Runs) with an attention count, breadcrumbs
  and page actions in a top bar. The editor has Steps / Project / Rules & limits / YAML tabs. The
  Steps tab has three panes: ordered step list, selected-step form, and checks with the first step.
- **Plain language (B):** each step shows a sentence summary and "result → what happens next"
  lines. Outcome destinations are chosen directly ("Go to …", "Finish", "Pause and wait for me",
  "Retry this step", "＋ New step…"). Inherited rules show their source. Technical failures and
  advanced fields sit behind disclosures.
- **Paused runs (B):** run details ask "What should happen next?" and show the consequence of
  each choice: Resume, set the step's result, jump, mark the task done, edit the workflow for
  this run, or stop. Each needs a reason, and every choice except Resume leaves the run paused.
- **Map (C):** a read-only, automatically arranged map is a tab in the editor and on run details.
  On a run, it shows the path taken and how many times each step ran. Editing stays in the forms.
- **Run details (A):** a status headline, a fact strip and the decision area, then history grouped
  by task beside the selected step's result. Raw events open on demand.
- **Feedback:** results appear beside the action that caused them. Created runs open their run page
  with a confirmation. Stale-state and disconnected failures say that nothing changed.
- **Unchanged contracts:** Save creates an immutable revision. Create run only prepares a run, and
  Start is separate. Interrupted-run recovery stays in the CLI unless a browser API is separately
  approved.

**Implementation plan (2026-10-20):** React + TypeScript built by project-local Vite. During
migration the daemon serves the new app at `/ui/app/` beside the legacy UI at `/ui/`. Then `/ui/`
switches to the new app and the legacy UI is removed. Routes use URL hashes. The CSP and the
browser API are unchanged. Slices: (1) frame, pairing, Runs, Run details and Map;
(2) Workflows and editor; (3) advanced (shared rules, limits, YAML text, paused-run revision);
(4) legacy removal and the user guide. Empty, loading, error and disconnected states are designed
inside each slice rather than in a separate prototype round.

**Slice 1 (2026-10-20): frame, pairing, Runs, Run details, Map.** Code lives in `ui/`; the serving
contract is in [architecture §8.7](../architecture.md).

- Pairing is its own screen, with distinct copy for a new browser, an ended session, a logged-out
  browser and an unreachable daemon. The code field clears after every attempt.
- The sidebar count is paused plus interrupted runs. Runs filter by All / Needs attention /
  Ready & running / Finished. Arriving on Runs, and any action, refreshes the list at once.
- Run details have History and Map tabs (`#/runs/<id>`, `#/runs/<id>/map`). A ready run shows
  "What will run" and the tasks instead of an empty history. History follows the newest step
  until the user selects one. Done task groups collapse.
- Before Start, the controls list each agent harness, its permission mode and steps, and state
  that agents and commands can change any user-accessible file and that stopping undoes nothing.
  Resume repeats this briefly.
- Paused choices are radio cards (arrow keys move, Tab enters the form). Choices that depend on
  `run-edit` (result, step, task) only offer engine-valid targets and state where the run goes
  next. "Change the workflow for this run" hands off to the classic interface until slice 2.
- Stop is a quiet link that opens a confirmation with a required reason. Reasons are checked in
  the browser before anything is sent.
- Feedback sits under the control. When the control disappears because the run moved on, the
  result moves to the top of the controls. Earlier successes are hidden once the run has finished.
  Stale results say nothing changed. Unanswered requests say the outcome is unknown.
- Typed reasons and choices survive refreshes, failures and tab switches. Focus moves to the page
  heading only on navigation.
- Interrupted runs show the step, attempt, process observation and blocking notes, then the
  `wf run recovery` / `recovery-decide` commands.
- The map is SVG, so it needs no inline styles. Nodes are focusable (arrow keys), and the side
  panel lists each result's destination and how often the step ran. Unrouted technical failures
  are summarized in the legend rather than drawn.
- Raw events hide `logPath` and absolute paths under a `logs/` directory.
- Light theme only for now. Times use a 24-hour clock. Below 760px the sidebar becomes a top bar,
  tables become cards, and panes stack.

**Slice 2 (2026-10-20): Workflows and the editor.** Routes: `#/workflows`, `#/workflows/new[/<example>]`,
`#/workflows/<revision>[/project|yaml|map]`, `#/workflows/draft/<n>[/…]` and `#/runs/<id>/edit[/…]`.

- Workflows groups immutable revisions by name (newest first, earlier revisions in a disclosure,
  run counts) and lists unsaved drafts in this tab. Examples (single agent, task loop, commands)
  open the New workflow form, which asks only for a name, an absolute project folder and the
  example (plus the checklist for the task loop). The project folder is also the workflow folder.
- The form edits a working model in the browser; every edit is sent as `draft` `model`, and the
  daemon's YAML and diagnostics are the authority. Typing is checked after a 400 ms pause, other
  edits at once. A check only counts if it answers the newest edit; Save, Create run and Apply
  need that check to be valid. If the daemon can't read the document (e.g. an empty prompt), the
  form keeps its model and shows the shape error; other checks follow once it is fixed.
- The header always shows the draft's state: New draft · not saved yet / Unsaved changes · based
  on revision N / Saved · revision N, with Discard. Drafts live in memory per tab, survive
  navigation, and are lost on reload (the browser asks first; a lost draft's address says so).
  Saving unchanged YAML reports the existing revision rather than a new one.
- Results are rows: result → destination select (Go to…, Finish, Pause and wait for me, Retry
  this step with runs/wait fields, ＋ New step…, or "Use the shared rule" when one applies).
  "Finish" adds a Finish step when none exists; "New step" creates, connects and opens the step,
  which shows where it came from. Unconnected results are marked in the row and in Checks;
  inherited rules show their source. Technical failures and advanced fields are disclosures.
- Deleting a step leaves references for the checks to explain; renaming updates structural
  references (first step, destinations, shared-rule step lists, report context) but not
  `{{reports.<id>…}}` text. The workflow name is edited on the Project tab; the page heading
  shows it.
- Create run opens a panel with the task preview (and an option to include checked tasks), then
  opens the new run's page with a confirmation. Start stays on that page. Creating from unsaved
  changes stores them as a revision with the run, and the panel says so.
- Paused runs: "Change the workflow for this run" opens the editor in run mode, pinned to the
  `run-edit` snapshot. Every check and Apply send its event; the page notices when the run moves
  on, keeps edits, and offers "Check the run again" (refused if the revision changed elsewhere).
  Apply needs a reason and a valid draft, offers "Continue at" (required when the paused step was
  removed or changed kind), then returns to the run page with a confirmation. Project folder and
  task list are read-only there.
- YAML is read-only in this slice. The Map tab reuses the run map without a run overlay and
  offers "Edit <step>".

**Slice 3 (2026-10-20): rules, limits, YAML and revision review.** The editor adds a
`/rules` route for saved workflows, drafts and paused runs.

- Rules & limits edits shared rules for named steps, any matching tag, or all steps; workflow
  default destinations; report correction (default on); and all three limits. Policies and step
  results use the same destination control, including retry fields and creating a destination
  step. Exact-result precedence and equal-level conflicts remain daemon decisions. The loop
  warning in Checks opens this tab and focuses Safety limits.
- “Edit as text” explicitly pauses visual editing. Exact YAML, including comments and invalid
  partial text, stays in the tab’s draft through navigation, late replies and failed checks.
  Checks link to line/column positions. Only the newest valid check enables Save/Create/Apply or
  “Return to visual editor”. Returning preserves the text; subsequent form edits regenerate it
  and remove comments. Discard returns to the saved text (or reloads a run’s current revision).
- Every nonterminal step exposes all ten technical failure routes in its disclosure. “Any
  technical failure” is labeled as a fallback; exact rules take precedence, and inherited rows
  show both the source and fallback provenance. Own technical rules can be removed to inherit.
- Paused-run draft checks add read-only continuation eligibility from `revisionCursor`, plus
  project/task-source constraints. Unavailable steps remain visible but disabled, with an
  explanation. Apply needs an explicit compatible replacement if the paused step was removed,
  changed kind or no longer fits the active task. The comparison shows changed workflow fields
  and steps, with both exact YAML texts available. Remaining task-specific settings still receive
  the engine’s transactional validation at Apply.
- Apply returns to the paused run with Resume selected, its consequence and permissions visible,
  and a fresh reason to enter. Resume remains a separate explicit action. Agent sessions from
  the previous revision cannot be resumed.
- Alt + ↑/↓ on a step reorders the reading list, keeps focus and announces its position. The
  selected-step form, result rows, destination control and common fields are separate components.
  Rules, YAML and comparison panes stack on small screens. Drafts remain tab memory; light theme.

**Slice 4 (2026-10-20): one interface and the guide.** `/ui/` now serves the developer workspace.
Exact `/ui/app` and `/ui/app/` GETs redirect permanently to `/ui/`, retaining URL fragments;
old app asset paths and classic assets return 404. The classic source, build-copy script and
classic-only browser selectors/fixture helper are removed. Builds also remove stale `dist/web/`
output from existing checkouts. The browser API, pairing, CSP and execution contracts stay intact.

Parity was checked against the classic shell/editor/dashboard/intervention source and its tests,
including source loading, every step field, rules/defaults/limits, task preview, immutable saves,
preparation, controls, reports/events/attention, overrides and pinned revisions. This found and
closed the remaining gaps:

- **Import YAML…** on Workflows takes a local file and absolute original workflow folder. It opens
  an exact-text draft on YAML, including invalid text or failed initial checks. Check again remains
  available after a failed initial check; unreadable drafts can be discarded. No source file changes.
- **All checklist items** in Create run exposes every queued/excluded item, body and source line;
  the ordinary preview stays short. Including prechecked items remains explicit.
- **Run information** holds project location, full imported task bodies and historical attention
  records. **Accepted report** shows all report fields and identity, even before process settlement.
  Technical details keep their private-path filtering. Editor tab labels/counts stay together on phones.

The [migration browser checks](../../test/browser/app-migration.spec.mjs) cover redirect/hash/session
continuity, exact imports (including arbitrary command arguments/environment), invalid text,
failed checks, task preview and distinct manual task decisions. Classic end-to-end revision/resume,
frozen-input/report history, and reload/last-tab no-replay assertions now run against React, using
the same fake adapters and durable reopen checks. [USER_GUIDE.md](react-user-guide-2026-10-21.md) is the current guide;
the stopped historical walkthrough stays archived. Draft memory, YAML comment regeneration,
prompt-placeholder renames, Apply-time task-override validation and CLI recovery remain as above.

Migration review keeps saved revision addresses distinct after Save and preserves any other
unsaved draft when identical YAML reuses its revision. Incomplete step time limits and command
environment lines remain invalid draft input rather than silently retaining or omitting values.
Accepted-report reads retry after a transient read failure, independently of the event cursor;
mutations still require deliberate submission and never retry automatically.
Historical step details read their own saved definition revision, including after Apply.
Creation and Apply confirmations expire when the run advances, so they cannot contradict its status.

React can be integrated into an existing application without replacing its backend; see the
[official integration guidance](https://react.dev/learn/add-react-to-an-existing-project).
