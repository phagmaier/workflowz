# Workbench implementation history — 2026-10-22

Historical implementation/verification checkpoints. Current behavior is described in [the design](../DESIGN.md); active findings are in [IMPROVEMENTS.md](../../IMPROVEMENTS.md).

## Status

- Feedback/improvement checkpoint (2026-10-22): both live evaluations are complete.
  [IMPROVEMENTS.md](../../IMPROVEMENTS.md) brings together the owner's walkthrough feedback,
  the agent's evidence-backed critique, repaired issues and outstanding priorities.
  Use it when resuming product work; proposed remedies still need a selected implementation
  slice. The current request records this checkpoint before the owner's next questions.
- OpenCode long-wait transport repair (2026-10-22, separately authorized after the trial):
  the bridge now uses core HTTP without an implicit five-minute deadline; configured
  invocation timeout/Stop and process/group/stream settlement remain authoritative.
  Requests use separate connections without redirects or automatic replay. Protocol
  errors exit nonzero and expose fixed diagnostic categories/allowlisted network codes.
  All 866 standard tests and 67 focused adapter/framing/conformance checks pass. An
  actual 310-second offline header wait also passed, crossing the former cutoff without
  replay; timeout, Stop and protocol-error regression checks pass. The owner subsequently authorized an explicit same-run Resume; the failed attempt remains preserved. See its [repair record](../evaluations/equipment-lending/EVALUATION.md#owner-authorized-transport-repair).
- Autonomous multi-harness trial continued after repair (2026-10-22):
  [equipment lending plan and sample project inputs](../evaluations/equipment-lending/README.md)
  cover OpenCode, Codex, Claude, OMP and Pi, autonomous task iteration and a later small
  revision. The continuation handoff authorized execution; all five live tool/report
  preflights passed, the 18-node workflow validates, and baseline revision 1 was explicitly
  started through the Workbench. Foundation paused at 5m03s with a bridge protocol error;
  an offline reproduction confirmed the unmodified bridge's 300-second HTTP header
  timeout. The partial foundation passes 11 independent tests and bounded seed/report/
  persistence/storage checks; CRUD, substantive work by the other four harnesses and the
  maintenance follow-up were not reached in the initial attempt. After the separately
  authorized transport fix, the owner delegated continuation; the evaluator explicitly
  resumed the same run at Foundation through the Workbench, preserving its failed attempt
  and frozen tasks. The continuation completed all three tasks and substantive work by all five harnesses. Independent verification caught a generated-app browser reset loop, repaired through a separate workflow. The accepted baseline was preserved; maintenance revision 5/run then completed. Final independent checks pass: 20 Python tests, 40 baseline API/process, 29 maintenance/migration, 19 baseline browser, 8 maintenance browser and a two-tab checkout conflict. Seven parent-Biome sample errors and small sample UX findings remain documented; Workflowz typecheck and production-source lint pass.
  Actual outcomes, partial acceptance and prioritized recommendations are in the
  [evaluation record](../evaluations/equipment-lending/EVALUATION.md). This is an evaluation
  exercise, not authorization for product changes or desktop work.
- Owner-led real-provider walkthrough (2026-10-22): the prepared exercise in
  [walkthrough/](../evaluations/owner-walkthrough.md) completed once with OpenCode and
  `opencode/deepseek-v4.1-flash-free`, using a one-line disposable project and isolated
  Workflowz/OpenCode state. The owner explicitly started, applied a continuation to `finish`,
  and resumed; the run completed and the final greeting and receipt matched expectations.
  The two unreachable-step warnings correctly described the manual continuation. The lab was
  shut down and cleaned. The owner reported that navigating back to the run map after completion
  was unclear; see the [verification record](../evaluations/owner-walkthrough.md) and separate owner
  note. One successful live execution confirms access and report/tool behavior for this run;
  rate limits and repeatability remain unverified. Desktop packaging remains deferred.
  Preparation verification remains separate: typecheck/lint, 857 standard tests and 59 offline
  Chromium checks passed, including the exact workflow with a scripted adapter. Native CLI,
  command and link checks passed; desktop/phone screenshots were inspected.
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
- The main Workbench screens, final interface review and [end-user guide](../USER_GUIDE.md) are
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
  [design-brief-2026-10-21.md](design-brief-2026-10-21.md).
