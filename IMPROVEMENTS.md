# Workflowz improvement backlog

**Checkpoint — 2026-10-23:** OWNER-1's offline manual walkthrough is prepared. Opt-in
`WF_OWNER_REVIEW=1` pauses the existing regression in a visible browser at Finished after
navigation checks; Inspector Resume runs normal cleanup. See OWNER-1 below for the launch
command and owner tasks. A Form-scoped locator resolves an observed setup race. Three
sequential focused regressions and headed pause/inspection/Resume pass, with cleanup proven;
desktop/phone screenshots were reviewed. Owner discoverability feedback remains pending.
Every listed finding except OWNER-1 is complete. A code review of
`d7d76ee..HEAD` found three issues, now fixed with regressions (see the UX-1 and F2 review
follow-ups); `npm run check` (882) and the full offline Chromium suite (66/66) pass. UX-2 (compact
running controls) is the latest: normal running controls are one row with Stop apart on the
right. After F2, F1, UX-1 and UX-2, `npm run check` (881 tests) and the full offline Chromium
suite (65/65) pass. UX-1 (stale run-control feedback) is complete. Success messages
clear once the run moves on. F1 (command checker guidance) is complete. The checker and
field now use the command parser's message, such as “Close the double quote.”, instead of the
schema's type error; UI wording only. F2 (readable route inspection on large graphs) is complete; see
its section below for the change, checks and limits. It is editor-Graph presentation only. The
selected step's inspector lists Leads to/Reached from as links that walk the graph. The graph
highlights that step's routes and connected steps, and zoom keeps the step in view. No layout,
Fit, run Map, schema or server change. F3 is complete. OWNER-1 remains implemented
and awaiting the owner's Map/results discoverability feedback. F5/F6 are complete.

**Verification setup restored:** commit `86927af` (removing `.cursor/skills`) had also deleted
`playwright.config.mjs`, which pins the browser suite: one worker, no retries, the `chromium`
channel, timeouts, `WF_BROWSER_OUTPUT` and no traces. With the owner's go-ahead the file was
restored byte-for-byte from `86927af^`. The bare `npm run test:browser` then passed all 64
offline scenarios with one worker and left no output or fixture state. The development
reference no longer lists the removed `.cursor/skills/` directory. Biome's exclusion of
bundled skill directories is unchanged and harmless.

**Next action:** launch the OWNER-1 walkthrough below and collect the owner's validation.
Record feedback on Finished → Map/results (OWNER-1)
and, if offered, on F2's route focus (whether it beats Form for checking routes). No other
actionable finding remains; new work needs new owner feedback or a new finding.

This is the single active local backlog, including small plans and continuation notes.
GitHub is primarily repository storage; tickets, labels and PRs are optional when specifically
useful or requested. Keep work selection and status here so a fresh agent needs no issue queue
or prior conversation. Suggested remedies remain proposals until checked against current behavior.

## Selecting and recording a slice

Follow a specific user request first. A general “continue improving” request means resume an
unfinished slice here, otherwise take the first actionable open finding in priority/table order.
Read its linked evidence, reproduce current behavior offline and consult the relevant design
and runtime contracts. If blocked, record why and choose independent work within the request.

Update the row as work moves through investigation/planning, implementation and verification.
Keep any longer plan directly below the table under its finding ID: observed behavior,
bounded proposal, acceptance checks and remaining decisions. Planning alone does not close a
finding. “Implemented; awaiting owner validation” is distinct from complete, especially OWNER-1.
Before ending, update the checkpoint with the selected ID, actual changes, checks/results,
remaining limits and exact next action. Use [AGENTS.md](AGENTS.md) for the working loop.

For the selected finding, record a compact proposal before implementation:

- **Observed:** reproduction/evidence and the behavior that needs improvement.
- **Result and scope:** the intended user outcome, bounded deliverables and exclusions.
- **Acceptance:** observable checks, with commands or an explicit owner validation step.
- **Decisions:** unresolved owner choices; use “none” when ordinary implementation choices suffice.

Expand only the next slice. Completed notes retain the actual result and verification;
historical evidence stays linked. Follow the verification matrix and local commit policy in
[development](docs/reference/development.md#verification-by-change) and [AGENTS.md](AGENTS.md#git-checkpoints).

## Next improvements

| ID | Priority / status | Observed problem | Direction and completion evidence |
| --- | --- | --- | --- |
| OWNER-1 | High · implemented; awaiting owner validation | The owner struggled to find the completed run's graph/map again. | Explicit Finished-row Map/results links and a prominent map/results summary action pass offline browser, keyboard and responsive checks. Owner discoverability feedback is still required to close. |
| F5 | High · complete | A transport/process failure was presented as an agent report/provider failure. | Technical summaries/details, safe bridge causes and neutral settlement wording pass core and browser regressions, including the real bridge through the fake local API, accepted-report/exit-zero failure and no replay. |
| F6 | High · complete | Passing API/page checks missed browser CRUD that continually erased input. | Optional executable Chromium recipe covers keyboard input and CRUD at desktop/phone widths, reports precise limits, and passes broken/fixed regressions through ordinary command routing. Seven YAML examples validate. |
| F3 | Medium · complete | Long steps show little activity; 3/3 tasks appeared while integration/audit still remained. | Overview names the task phase (“Run not finished yet” after all tasks), the attempt's recorded stage and time, elapsed with paused time, and Tasks done. Passes unit, focused and full offline Chromium regressions; no live output or progress estimates are implied. |
| F2 | Medium · complete | Fit shrank an 18-node graph to unreadable 35%; Form was easier to inspect. | Selected-step route focus: readable Leads to/Reached from links walk routes from the inspector; the graph highlights that step's routes and connected steps; zoom keeps it in view. Passes unit, new 18-step Chromium regression and the full offline suite. |
| F1 | Medium · complete | Checker showed an array/string schema error instead of “Close the double quote”. | Checker uses the command parser's message for text it can't split; the field shows it once as its error description; Fix focus unchanged. Passes daemon-checked unit and Chromium regressions. |
| UX-1 | Low · complete | “Foundation runs again” feedback stayed visible during later tasks. | A control's success message clears once the run moves to another step or state; errors stay. Passes unit and extended Chromium regressions. |
| UX-2 | Low · complete | The large Pause/Stop panel pushes history and results down. | Running/pausing controls form one compact row (Pause and feedback left, Stop apart on the right); Stop's confirmation still expands below. Passes extended Chromium regression and full suite. |

Sources: [owner walkthrough feedback](docs/evaluations/owner-walkthrough.md#owner-feedback),
[full trial findings](docs/evaluations/equipment-lending/EVALUATION.md#findings),
[prioritized critique](docs/evaluations/equipment-lending/EVALUATION.md#prioritized-recommendations-and-limits).

### UX-2 — compact running controls

**Observed:** reproduced on 2026-10-23 with the F3 Chromium scenario at 1440 px. While running,
the controls are a full panel between the overview and History: Pause after this step on one
line, then Stop run now… on its own line, about 120 px tall including padding. History starts
around 530 px. The evaluation saw results start below about 500 px at a 1000 px height
([screenshot](docs/evaluations/equipment-lending/evidence/45-maintenance-running-after-navigation.png)).

**Result and scope:** while running or pausing, the controls form one compact row. Pause (or the
pausing note) and its feedback sit on the left; Stop run now… stays a separate red action at
the right. Opening Stop still expands its full confirmation with a reason, beneath the row. On
narrow screens the row wraps. Ready, paused and interrupted panels, the controls themselves,
their order and keyboard behaviour, wording and requests are unchanged.

**Acceptance:**

1. The F3 scenario is extended and fails before the change. At 1440 px while running, the
   controls region is at most 72 px tall and Pause and Stop share a row. Opening Stop shows its
   reason form, and Cancel returns focus to Stop. Pausing keeps the compact row with its note.
   There is no page overflow at 1440/390/320 px.
2. Screenshots of running, pausing and Stop open at desktop and phone widths are visually reviewed.
3. `npm run check` and the run-control browser specs pass, including existing Stop scenarios.

**Decisions:** none; placement within the approved Workbench is an ordinary visual choice.

**Implemented:** running and pausing panels in `RunControls.tsx` use `controls-compact`. The CSS
lays them out as a wrapping row: Pause or the pausing note first, an earlier confirmation
inline beside it, then Stop pushed to the right. An opened Stop confirmation takes the full
width below. DOM and keyboard order, controls, wording and requests are unchanged.

**Acceptance passed:**

- The extended F3 scenario failed on the unchanged UI, with controls 179 px tall while
  “Started.” showed. After the change it passes. Running controls are at most 72 px tall
  even with that confirmation, Pause and Stop share a row with Stop clearly apart, and Enter
  opens Stop's reason form. Cancel returns focus to Stop. Pausing stays within 72 px, and
  there is no overflow at 1440/390/320 px. Running, pausing, Stop open and phone screenshots
  were visually reviewed; at 1440 px History starts about 85 px higher.
- `npm run check`: typecheck, lint (existing CSS warning only) and all 881 core tests pass.
  Run-control Chromium specs: 38/38. Full offline Chromium suite after F2, F1, UX-1 and UX-2:
  65/65 pass sequentially (3.9 min).

**Limits:** ready, paused and interrupted panels keep their full layouts; paused decisions
need that room. On phones Stop wraps to its own line at the right.

### UX-1 — stale run-control feedback

**Observed:** in `RunControls.tsx`, a control's success message stays in the controls panel
until another control is sent. Running shows any result other than Pause/Stop; paused shows
any result other than its own decisions. So “Started…” and “Resumed. Foundation runs again
from the beginning.” stay visible while later steps run (the evaluation's
[task-2 screenshot](docs/evaluations/equipment-lending/evidence/32-task-one-repaired.png)).
“Pause requested. The current step finishes first…” also stays visible after the run has
paused. The F3 Chromium scenario (start → pause → resume → Integrate) exercises this path.

**Result and scope:** a successful control message stays visible only while it still
describes the run. That is the same step while it starts or runs after Start/Resume, the same
step while pausing after Pause, and the same paused state after Apply. It also covers a
finished run's Stop result. Once the run moves to another step or state, the message goes;
the heading, overview and History show what happened. Pending, failed and unknown results
are unchanged, as are wording, controls, requests and polling.

**Acceptance:**

1. A unit test covers the visibility rule for Start, Pause → pausing/paused, Resume with the
   same or a later step, Apply while still paused (including a moved cursor) and a stopped run.
2. The F3 scenario is extended and fails before the change. It checks that “Pause
   requested” shows while pausing and is gone once paused. “Resumed” is gone once the run is
   at Integrate, and only Start/Pause/Resume are sent.
3. `npm run check` and the run-control browser specs (run-details, run-review, intervene,
   runs) pass, including the existing paused Apply/Resume feedback scenarios.

**Decisions:** none.

**Implemented:** `useControl` (in `RunControls.tsx`) records the run's status and current
step when a control is sent. The pure `feedbackCurrent` in `ui/src/lib/run-copy.ts` decides
whether a success result still applies. It applies at the same step while it starts, runs or
pauses; in the same paused state after Apply, even when the next step moved; and for a
stopped or completed run. Stale success results are no longer returned. Pending, error and
unknown results, wording, requests and polling are unchanged.

**Acceptance passed:**

- New unit test `keeps a success message only while the run is where the message describes`
  covers Start, Pause → pausing/paused, Resume to the same or a later step, Apply with a moved
  cursor, interruption and stopped/completed runs.
- The extended F3 scenario failed on the unchanged UI: “Pause requested.” was still shown
  after “Paused at your request”. After the change it passes. “Started.” shows while Foundation
  runs, “Pause requested.” while pausing and neither once paused. At Integrate there is no
  “Resumed.”/“Started.”, and only Start/Pause/Resume are sent.
- `npm run check`: typecheck, lint (existing CSS warning only) and all 881 core tests pass.
  Run-control Chromium specs (run-details, run-review, intervene, runs, runs-groups, review,
  revise, session-review, failures, lifetime, owner-walkthrough): 34/34 pass. app-migration:
  4/4 pass, including the existing “Still paused” Apply confirmations.

**Limits:** if the run has already moved past the resumed step before the next poll, the
Resume confirmation may never appear; the heading and History then show the change. A step
that loops back to itself keeps its message. The full browser suite was not rerun for this slice.

**Review follow-up (2026-10-23):** code review of `d7d76ee..HEAD` found that “paused, then
paused again” counted as still current for every control. So a Resume whose step quickly
paused again (for example, a rerun check failing at once) kept “Resumed. Check runs again…”
beside the new decision. The recorded place now includes the run's latest event ID.
`feedbackCurrent(control, sent, now)` keeps a message for the unchanged read from before the
control took effect. After that, only Apply (skip/jump/complete-task) keeps it while still
paused; Start, Pause and Resume keep it only while the same step starts, runs or pauses. The
unit test now distinguishes the pre-action read from a later pause; the new
“resume → paused again at the same step” case failed under the previous rule. `npm run check`
(882 tests) and the full offline Chromium suite (66/66) pass.

### F1 — command checker guidance

**Observed:** reproduced on 2026-10-23 with a new unit test through the real daemon `draft`
operation. The Command field keeps text it can't split as a string in the model, so input
is never lost. The daemon's schema check then reports `invalid_field` “Invalid input:
expected array, received string” at `steps.<id>.argv`. The checker shows “Run tests ·
command: Invalid input: expected array, received string” instead of the parser's “Close the
double quote.” Per the [evidence](docs/evaluations/equipment-lending/EVALUATION.md), the field
also shows both lines: the parser's message plus the same schema text. Fix focuses the field
correctly (covered by the existing `app-form.spec.mjs` command-line scenario).

**Result and scope:** UI wording only. When the daemon rejects a step's `argv` because it is
a string, the checker uses the command parser's message: an unclosed quote, a trailing
backslash or shell operators. A string that would split cleanly (only possible from
hand-written YAML) says to write it as a list or retype it in the Command field. Beside
the field, the parser's message appears once and is the field's described error. Other
`argv` diagnostics, the daemon's validation, the model's preservation of unfinished text and
Fix focus are unchanged.

**Acceptance:**

1. The new unit test (daemon-checked) fails before and passes after for an unclosed quote,
   shell operators and a cleanly splittable string.
2. The existing command-line Chromium scenario is extended: for an unfinished quote, the
   checker shows the parser's message and no “expected array”. The field shows it exactly
   once, linked as its error description. Fix still focuses the field, and the shell-operator
   case reads the same way in the checker.
3. `npm run check` and `app-form.spec.mjs` pass. USER_GUIDE is updated if its checker
   wording changes.

**Decisions:** none.

**Implemented:** `problems()` in `ui/src/lib/workflow-edit.ts` replaces the daemon's
`invalid_field` message for a string `argv` with `parseCommand`'s error, or with list/retype
guidance when the string would split cleanly. Other `argv` diagnostics keep the daemon's
message. In `StepForm.tsx`, an unsplittable command shows the parser's message once. That
message is the field's `aria-describedby` error, and the daemon's duplicate is not repeated.
The field also keeps its monospace class while invalid. Previously the error attributes
replaced it, a pre-existing defect for this field. No daemon, schema or model change.

**Acceptance passed:**

- New unit test `explains an unfinished command line with the command parser's guidance`
  failed before (“Run tests · command: Invalid input: expected array, received string”). It
  passes after for an unclosed quote, shell operators and a cleanly splittable string.
- The extended `command lines preserve quoted arguments…` Chromium scenario failed on the
  unchanged UI at the new checker assertion, then passed after the change. The checker reads
  “Command · command: Close the single quote.” with no “expected array”. The field shows the
  message exactly once as its accessible description and stays monospace. Fix focus, input
  preservation across views and failed checks, saving and the shell-operator checker
  message all pass. The unfinished-command screenshot was visually reviewed.
- `npm run check`: typecheck, lint (existing CSS warning only) and all 880 core tests pass.
  Editor Chromium specs (app-form, app-editor, app-editor-states, app-editor-review,
  app-graph, app-advanced, app-migration, app-workflows): 29/29 pass. The full browser suite
  was not rerun for this wording-only slice; the owner plans a final full check.

**Limits:** other fields still lose their own classes (such as `mono`) when the shared error
attributes apply. That is cosmetic and was left unchanged. Diagnostics for non-string `argv`
values, such as a number or a non-string item, still show the schema's wording, which can
only come from hand-written YAML.

### F2 — readable route inspection on large graphs

**Observed:** reproduced on 2026-10-23 offline in Chromium by importing the archived
18-step [baseline workflow](docs/evaluations/equipment-lending/workflows/baseline.yaml) at
1440×1009. The laid-out canvas is 3344×1274 px. Fit reaches its 35% floor and still overflows
the 1142 px viewport. Outcome text renders at about 4 px (11 px × 0.35). Thirteen of 31 routes
are back or skip routes drawn through shared dashed lanes below the nodes, where they can't
be told apart. Selecting a step outlines its own wires, but there is no readable way to
see which routes reach a step. Unsuccessful is reached from 11 routes across the whole canvas,
some through shared rules. At 100% the outcome text is readable, but only about three columns
are visible. Following a route then means scrolling along a lane. The run Map uses its own
vertical layout with full-size labels and was not part of the evidence.

**Result and scope:** at any zoom, the selected step's routes are readable and can be followed
from the Graph alone. Every route remains drawn; nothing is hidden or collapsed.

- The step inspector starts with a **Routes** section. **Leads to** lists each outcome and
  its destination. **Reached from** lists each incoming route (source step and outcome,
  marked when it comes from a shared rule) and notes when the run starts here. A destination
  or source step is a button that selects that step, keeps it in view and moves focus to that
  step's Routes, so keyboard users can walk the graph route by route.
- In the graph, the selected step's routes stay highlighted, other routes fade and connected
  steps are outlined. This makes the selected step's neighbourhood visible even at Fit.
- Zooming with a step selected keeps that step in view.
- Excluded: run Map changes, collapsing repair sections (which would hide routes and need
  grouping rules), layout algorithm or Fit floor changes, manual placement, and Form view
  changes. Selecting a step from a route doesn't change the document or execution.

**Acceptance:**

1. A new `app-graph.spec.mjs` scenario imports the archived baseline at 1440 px and fails
   before the change. After Fit, selecting Unsuccessful lists all 11 incoming routes,
   including shared-rule routes, at normal text size. Activating a Reached from entry selects
   that step, keeps its node in view and moves focus to its Routes. Leads to returns to the
   destination. The graph marks exactly the selected step's routes and connected steps. Zoom
   keeps the selected step in view. Keyboard-only use works, the start step says the run starts
   there, there is no page overflow at 1440/390/320 px, and screenshots are visually reviewed.
2. A unit test derives Reached from from route rows of an independent example, covering self
   loops, missing destinations, pause outcomes, shared rules before and after the daemon check.
3. Existing graph scenarios and `npm run check` pass. The full offline Chromium suite passes
   sequentially, because the inspector is shared editor UI. DESIGN and USER_GUIDE describe
   the behavior.

**Decisions:** none blocking. Route focus is an additive inspection aid within the approved
Graph and automatic layout. If the owner still finds large graphs hard to read after
trying it, collapsible repair sections or a different Fit remain open options.

**Implemented:** `incomingRoutes` in `ui/src/lib/editor-graph.ts` derives Reached from from the
same rows that draw the wires, so lists and wires agree (shared-rule routes appear once the
daemon check returns). `GraphTab.tsx` adds the inspector's Routes section, marks connected
steps (`linked`) and fades other wires while a step is selected. It also re-runs the
keep-in-view scroll when the zoom changes. Step links reuse the existing selection and focus
the Routes heading. No layout, Fit floor, Form, run Map, schema or server change.

**Acceptance passed:**

- New scenario `route focus keeps a large graph's routes readable and walkable at Fit` failed
  on the unchanged UI (no Reached from list) and passes after. At Fit (35%), Unsuccessful lists
  all 11 incoming routes in authored order. That includes three shared-rule `failed` routes,
  rendered at full size. Exactly 11 wires and the 11 source steps are marked, and the step
  stays in view. Keyboard Enter/Tab walk Unsuccessful → Foundation repair → Foundation
  recheck, with focus on Routes each time. Three zoom-ins keep the selected node inside the
  viewport. Foundation reports “The run starts here.” There is no overflow at 1440/390/320 px,
  no owned children and no CSP violation. Fit, zoomed and phone screenshots were visually
  reviewed, along with the existing graph screenshots.
- Unit test `incoming routes list every drawn route into a step…` passes. It covers shared rules
  before/after the check, self loop, pause outcome and missing destination.
- `npm run check`: typecheck, lint (the existing CSS warning only) and all 879 offline core
  tests pass. `npm run test:browser`, run sequentially afterwards: all 65 offline Chromium
  scenarios pass (4.1 min). No provider was called; fixture state and listeners were removed.

**Limits:** at Fit the graph itself is still too small to read, and the 35% floor still
overflows the viewport for this graph. Readability comes from the inspector, not the canvas.
Shared lanes below the nodes remain hard to follow without a selection. Route lists show
direct neighbours only, not whole multi-step paths. Owner use has not yet confirmed this is
easier than Form for checking routes.

**Review follow-up (2026-10-23):** code review of `d7d76ee..HEAD` found two F2 issues and one
test-coupling concern, all fixed:

- Reached from omitted technical-failure routes (for example `system.error: goto: repair`),
  because the graph draws only outcomes. A step reached only that way said “No step leads
  here yet.”, though the daemon accepts it as reachable. `technicalRoutes` in
  `editor-graph.ts` now lists one “technical failure” entry per source step, marked shared
  when inherited and “not drawn in the graph”. Wires and outlines still show outcome routes only.
- Before the daemon check, a shared route read “Shared rule · check needed · shared rule”. The
  marker now appears only once a destination is known.
- The F2 scenario read the archived evaluation file. It now uses
  `test/fixtures/graphs/equipment-lending-baseline.yaml`, a copy with a provenance header.

New scenario `Routes list technical-failure routes and name a shared rule once before the check`
failed before each fix: the technical route was missing, and separately the duplicate marker
was present. It passes after. A new unit test covers own and inherited technical routes,
before and after the check. `npm run check` (882 tests) and the full offline Chromium suite
(66/66) pass. Remaining limit: technical-failure routes are listed, not drawn.

### F3 — progress and timing during long steps

**Observed:** reproduced on 2026-10-23 with a new offline Chromium scenario: two imported
tasks, a Foundation command and a post-task Integrate command that each wait for their own
release file, plus a user pause after Foundation. While Foundation ran, the overview showed
“A command is running”, “0 of 2 done · none active”, total elapsed “2s incl. pauses” and a
Progress bar at 0/2; the step's own duration appeared only on its History row. While Integrate
ran after both tasks, the overview showed “All 2 done” and a full “2/2 tasks” Progress bar; only
the heading showed that work remained. Elapsed always said “incl. pauses”, even with none,
and never said how much was paused; the completed summary said “Finished in 14s” although
about 4s of that was paused. Saved Output correctly says it does not stream.
Available data: the status read's active attempt start time; each attempt's recorded
preparation, invocation dispatch/start/settlement, accepted report and correction events; and
pause/resume/stop timestamps. Workflowz has no provider activity stream, so it cannot observe
what an agent is doing between those events.

**Result and scope:** presentation only, from existing status and event reads; no
server, engine, schema or polling change.

- The Task fact names the task phase: “None started yet” before any task, the active task,
  “k of N done · none active” between tasks, and “All N done” with “Run not finished yet” until
  the run completes or stops. Progress becomes “Tasks done”, so the bar counts tasks only.
- While running or pausing, Current step adds the attempt's last recorded stage (preparing,
  starting, agent/command running, report received while the agent exits, asking for a
  missing report, recording the result) and the time since this attempt started.
- Elapsed reads “since start”, “start to finish” or “until stopped”, plus “incl. X paused”
  from recorded pause intervals. The completed summary states paused time.
- With all tasks done, the running summary says the workflow continues with the current
  step. A running step's details say its result and saved output arrive after it finishes and
  that Workflowz doesn't show live output.
- Excluded: overall percentages, remaining-step or time predictions, live output, provider
  heartbeats, History row changes and the stale-feedback wording (UX-1).

**Acceptance:**

1. A new `app-run-details.spec.mjs` scenario fails before the change and passes after. It
   covers the before-task phase with a growing attempt time, the pausing state, paused time
   after pause/resume, the all-tasks-done phase while Integrate runs, and the completed
   summary/facts. It also checks that the inspected attempt, its Output tab and keyboard focus
   survive polling, that only Start/Pause/Resume are sent, and that there is no page overflow
   at 1440/390/320 px. Screenshots are visually reviewed.
2. Unit tests derive phase, activity and paused time from realistic event sequences, including
   report-before-exit, correction, stop while paused, empty and graph-only task lists.
3. The lifetime scenario shows the agent's recorded “report received” stage while its process
   continues. Existing status-transition and graph-only scenarios still pass.
4. `npm run check` and the affected Chromium specs pass when run sequentially. DESIGN and
   USER_GUIDE describe the facts.

**Decisions:** none; the wording and placement are ordinary implementation choices.

**Implemented:** pure `taskPhase`, `attemptActivity`, `pausedMs` and `statusTime` helpers in
`ui/src/lib/run-copy.ts` drive the overview facts, running summary, completed summary and the
running-step callout. The overview facts are now Task, Current step, Elapsed and Tasks done.
Attempt time uses the active attempt's recorded start; paused time uses only recorded
pause→resume/stop intervals. Ongoing pauses are measured to the daemon read's own clock.

**Acceptance passed:**

- The new scenario `long steps show their activity and attempt time; finished tasks don't
  read as a finished run` failed against the unchanged UI. Its first assertion received
  “0 of 2 done · none active”; a separate observation run also captured “All 2 done”, a full
  “2/2 tasks” bar during Integrate, and “Finished in 14s” without its pause. After the
  change it passes. The scenario confirms the growing attempt time while Foundation runs,
  pausing, paused time, the all-done phase during Integrate and the completed summary/facts.
  It also confirms that Report choice and focus survive polling, that only Start, Pause and
  Resume are sent, and that there is no overflow at 1440/390/320 px.
- The lifetime scenario shows “Report received; waiting for the agent to exit” while the
  real supervised fake agent process continues after its accepted report.
- `npm run check`: typecheck, lint (existing CSS warning only) and all 878 offline core tests
  pass. Four new unit tests cover task phases (including empty and graph-only task lists),
  the summaries, paused intervals (including stop while paused and missing clocks) and
  every recorded attempt stage, including report correction.
- Full offline Chromium suite: all 64 scenarios pass sequentially after the core gate.
  This was run with the restored config described in the checkpoint. Desktop, foundation,
  integration, completed and 320 px screenshots were visually inspected. Local links/anchors
  in the four updated documents resolve. Owned fixtures, processes, listeners and temporary
  state were removed. No provider was called.

**Limits:** stages come only from Workflowz events, so a long “Agent running” stage cannot
distinguish productive work from a stall. Times update with the existing 2-second
running/5-second idle polling. Elapsed includes daemon downtime before an interruption is
recorded, and paused time counts only explicit pauses. Interrupted and pausing states were
checked through existing rewritten status reads; there is no live-provider evidence.

### OWNER-1 — completed-run navigation

**Walkthrough preparation (2026-10-23):** requested by the owner; validation stays pending.

- **Observed:** the existing `test/browser/owner-walkthrough.spec.mjs` creates and completes
  the preserved greeting fixture, verifies navigation, then immediately tears it down. It
  does not leave a completed run available for the owner's inspection.
- **Result and scope:** add an explicit optional manual pause after the existing regression
  checks. A visible browser starts the owner's inspection at Finished with the completed
  fixture; resuming the test runs its existing cleanup. Reuse the scripted adapter and
  private state. No product behavior or live provider execution changes.
- **Acceptance:** the normal focused Chromium regression passes and cleans up; the optional
  headed mode reaches Finished with a completed run, allows Map/results inspection, and
  cleans up after Resume. Review desktop and phone screenshots; record the exact launch
  command and a short owner walkthrough here.
- **Decisions:** none. Only the owner's feedback can close discoverability acceptance.

**Prepared:** `WF_OWNER_REVIEW=1` adds an optional pause at the end of the existing regression.
After all its assertions, it restores 1280×900 and opens Finished. No test pause occurs
without that explicit flag. The fixture uses real local commands and a scripted agent;
the historical model name remains on screen, but no installed harness/provider is called.

From the repository root, with the pinned Chromium provisioned and a desktop display:

```bash
WF_OWNER_REVIEW=1 pnpm --config.verifyDepsBeforeRun=false run test:browser \
  owner-walkthrough.spec.mjs --headed --timeout=0
```

This builds the current app, completes the private greeting fixture and verifies the existing
navigation checks before pausing. `verifyDepsBeforeRun=false` prevents pnpm's implicit
dependency-install check; this uses the already installed, lockfile-pinned dependencies.
Leave the terminal running. Use the app window once the terminal says `OWNER-1 ready at
Finished`; the other window is Playwright Inspector. The manual session has no timeout.
When finished, choose **Resume** in Inspector so the normal fixture teardown closes its
browser/daemon and removes its private state. The next launch creates a fresh fixture.

Owner tasks, before consulting the expected paths:

1. Find the completed greeting run's execution map from Finished.
2. Find Finish's saved output, then return to the execution map from the completed summary.
3. Return to Finished and find the saved results directly. Optionally repeat with keyboard
   navigation or a narrower window.
4. Report whether the map/results are easy to find, where you hesitated, and any confusing
   label. This is the remaining acceptance evidence, not another automated pass.

Expected paths if help is needed: Finished's **Map** link opens the five-step execution map;
**View results** in its summary returns to history, where Finish's Output says `FINISH OK`.
The completed summary's **View map** opens the map again. Finished's **View results** opens
saved history/output directly. These actions leave the run Completed. Tab/Enter activate
links; after entering Map, Tab reaches a step and Up/Down select steps.

**Preparation verification:**

- The initial offline attempt could not launch Chromium inside the sandbox; browser checks
  ran outside it with only the fake adapters. Two launches then exposed the existing setup
  race at Configure Edit greeting (one intervening run passed). Graph and Form share that
  button label; the test now targets it within **Form editor**, waiting for the requested
  view before the keyboard action. No fixed delay or assertion was removed.
- `node scripts/smoke-browser.mjs owner-walkthrough.spec.mjs --repeat-each=3`: 3/3 pass
  sequentially, including keyboard/focus, Back/Forward/reload, saved output, no additional
  execution requests and no page overflow at 1280/900/390/320 px.
- `pnpm --config.verifyDepsBeforeRun=false run test:browser owner-walkthrough.spec.mjs`:
  build and focused regression pass through the documented launcher.
- Headed mode with `WF_OWNER_REVIEW=1`, `--headed --timeout=0` and a private temporary CDP
  launch configuration reached Finished. A second connection checked Map, View results,
  Finish's `FINISH OK`, summary View map and content focus, then resumed the Inspector pause.
  The test passed; its durable reopen, child/owner exit, listener/discovery removal and
  temporary-state cleanup checks passed. The temporary verification connection/configuration
  is not needed by the owner command above.
- Visually inspected the manual starting screen, desktop completed output and phone Map and
  Finished screenshots. Biome on the changed spec and `git diff --check` pass. No product
  code changed; the full core/browser suites and live providers were not rerun.
- Reviewed the two-file change against the requested preparation scope: no remaining findings.
  Referenced paths and command options were checked; no workflow example or product contract
  changed. Temporary verification scripts, screenshots and diagnostic output were removed.

**Remaining:** owner feedback is still required. Automated navigation evidence cannot establish
the owner's discoverability judgment. Preparation browsers and daemons are closed.

Reproduced with the preserved owner-walkthrough Chromium fixture: after completion the
summary offers Refresh run and Open workflow, while Map is a quieter tab below the summary.
Finished rows offer only a workflow-name link and generic Open action. The existing Map
works; the problem is finding the path to it.

Implemented: completed/stopped summaries offer a prominent View map action (View results
when viewing Map); Finished rows offer explicit View results and Map links. Both use the
existing routes. The summary action focuses the requested content, while the History/Map
switch and inspected result/output choice remain available within the run. Navigation
does not change execution. The new missing-summary-action regression failed before the fix.

Acceptance checks passed:

- `npm run check`: build, strict typecheck, lint and all 866 core tests pass.
- `npm run test:browser -- app-runs-groups.spec.mjs app-run-details.spec.mjs owner-walkthrough.spec.mjs`:
  all 16 offline Chromium scenarios pass together. The completed owner fixture exercises
  summary → Map → results, direct Finished links, retained Finish output, Back/Forward/reload,
  Tab/Enter/arrow-key navigation, focus retention and no extra execution requests.
- Existing read-response fixtures verify completed/stopped summary actions, both Finished
  statuses and status transitions without stealing keyboard focus. Desktop/tablet/mobile
  layouts, including long labels and 320px width, have no page overflow. Screenshots of the
  completed summary, Finished rows and map were visually inspected.
- Local links/anchors resolve in the three updated documents. Disposable fixture owners,
  children, listeners and state are cleaned up.

Remaining acceptance: the owner must confirm that Map/results are now easy to find. The
completed path uses real local commands and a scripted agent; stopped states use the
existing rewritten read fixtures. The full browser suite and live providers were not rerun.
On 2026-10-22 the owner said they have not tried the updated navigation yet. Keep OWNER-1
pending until discoverability feedback is recorded. F5/F6 are complete; independent work can
proceed with F3.

### F5 — technical failure attribution

Reproduced before the fix with both a small event/history/status-copy regression and the
real OpenCode adapter/bridge against `fake-opencode.mjs` in Chromium. A reset at the wait
endpoint produced no accepted report, but the paused summary said “Foundation reported
system.process_error” and omitted the saved `ECONNRESET` diagnostic. Separately, the shared
adapter-failure settlement described unconfirmed execution as “the agent provider failed”.

Implemented:

- Paused summaries identify technical failures and show the available safe cause. Step details
  retain a Technical failure notice above Report/Output, with accepted reports identified
  separately. Normal results without an accepted report use “finished with”.
- The UI promotes exact known bridge diagnostic lines only for OpenCode steps. Unknown codes,
  surrounding text and arbitrary stderr stay in Output. Timeout remains visible when a bridge
  error precedes stalled shutdown; earlier invocation stderr does not leak into correction results.
- Shared unconfirmed-execution settlements keep `system.process_error` and use neutral detail.
  Older provider-blaming detail is normalized for display; original event data stays immutable.
  No workflow/schema, routing, correction-budget, supervision or recovery change was needed.

Acceptance checks passed:

- `npm run check`: build, strict typecheck, lint and all 873 offline core tests pass. New
  regressions cover attribution, diagnostic allowlisting/harness scope, ordinary outcomes,
  historical evidence, correction timing, timeout precedence and neutral settlement detail.
- `npm run test:browser -- app-failures.spec.mjs app-run-details.spec.mjs app-run-review.spec.mjs app-runs.spec.mjs app-runs-groups.spec.mjs owner-walkthrough.spec.mjs`:
  all 21 scenarios pass together. The real bridge reset reaches persisted diagnostics,
  paused heading, step details and Output, survives reload, and creates exactly one session,
  prompt, wait and invocation. An accepted report followed by failed terminal execution at
  exit zero stays distinct from the technical result and bypasses correction.
- Keyboard Output-tab navigation, Map/history return focus, retained inspected output,
  desktop/tablet/mobile widths through 320px and no page overflow pass. Failure screenshots
  were visually inspected. Local links/anchors resolve in the five updated documents.
- All owned fixture processes/listeners/state are cleaned up; no live provider was called.

Limits: the full browser suite and the optional 310-second transport test were not rerun.
Unknown/unavailable diagnostics use the normalized result or process exit status. This does
not recover the historical exception discarded during the original trial or establish provider
reliability.

### F6 — executable browser acceptance guidance

**Observed:** the archived trial's API/page checks passed while actual browser CRUD erased
input. Before this slice, the examples provided no executable input-preservation/browser CRUD
acceptance recipe. A private synthetic fixture reproduced the gap: HTTP/page and API CRUD
checks passed, while keyboard editing erased the entered name. This is a new offline
reproduction of the failure class, not a rerun of the retired generated app.

**Result and scope:** provide a small project-local Chromium recipe that an author can adapt
to their application's labels and journeys, plus an illustrative ordinary command step.
Use a private synthetic form fixture to prove the recipe; retain no generated sample app or
live-provider scaffolding. Cover typed-input preservation and create/read/update/delete,
keyboard use and desktop/phone widths. Document setup, disposable test-data ownership,
success/failure output, and claims the recipe does not verify. Authors choose where the
command belongs and how its Outcomes route; engine gates and new report/schema fields are
outside this slice.

**Acceptance:**

1. API/write/page checks pass against the intentionally broken fixture while the browser
   recipe fails on erased input, with a clear failure and nonzero exit.
2. The same browser recipe passes against the repaired fixture, verifies visible CRUD and
   input retention using keyboard interactions, and cleans up its owned data/browser.
3. An offline Workflowz command scenario exercises the recipe's pass/fail exit through normal
   authored routes, with no provider or automatic retry. The example YAML validates via CLI.
4. Instructions name the tested browser, viewport sizes and journeys and retain unverified
   app-specific/manual claims. Link/path/example checks and the relevant offline regressions pass.

**Decisions:** none for this bounded example. Application-specific selectors, journeys,
credentials, extra browsers and routing policy remain the workflow author's choices.

**Implemented:** [browser recipe](examples/browser-acceptance/README.md), standalone checker
and [ordinary command workflow](examples/browser-acceptance.yaml). The checker uses the
project's pinned Playwright/Chromium with a fresh context at 1280×900 and 390×900. It verifies
typed-input preservation, keyboard focus, visible create/edit/read/delete and reload behavior,
plus page overflow. JSON names completed checks, failure location and cleanup status; exit
codes distinguish acceptance, failure and invalid invocation. Unique owned records are cleaned
up after success or failure; failed cleanup stays a failure. Setup and author guidance explain
the application contract, explicit browser provisioning and disposable data. Authors retain
control of command placement and outcome routing.

**Acceptance passed:**

- `npm run test:browser -- app-acceptance.spec.mjs`: both offline scenarios pass. Each runs
  the actual example command through Workflowz. Broken editing fails specifically at input
  retention with exit 1 and follows the authored pause route; the repaired target passes both
  viewports with exit 0 and reaches the end node. API/page checks pass on both targets.
  There is one command attempt, no agent report/provider call and no automatic retry. Owned
  records, browser/daemon processes, listeners and private fixture state are cleaned up.
- `npm run typecheck` and `npm run lint` pass; lint retains its existing CSS warning.
- `node --test dist/app/validate-cli.test.js`: all 11 tests pass, including all seven YAML
  examples without warnings. Documentation links/anchors resolve.

**Limits:** this optional recipe covers only its configured Chromium journeys and viewport
sizes. It does not establish Firefox/WebKit behavior, authenticated sessions, concurrent edits,
server-restart persistence, a full accessibility audit or visual correctness. Application
authors must adapt selectors, readiness and criteria, then report unexecuted/manual checks
through existing summary/handoff fields. No mandatory review stage, report field or runtime
policy was added. The full core/browser suites were not repeated for this examples/guidance
slice.

## Completed and worth preserving

**F4 — repaired:** OpenCode's long wait had an implicit five-minute HTTP timeout despite a
25-minute invocation limit. The owner authorized the narrow transport repair and explicit
same-run Resume. The repair passed 866 standard tests, focused lifecycle/adapter checks and
an actual 310-second offline wait. Preserve timeout, Stop, settlement and no-replay guarantees.
[Repair evidence](docs/evaluations/equipment-lending/EVALUATION.md#owner-authorized-transport-repair).

Keep the successful product behaviors: separate Save/Create/Start, frozen task preview,
explicit report context, actionable cross-harness review, exact-session continuation,
retained input/focus/selection, durable history and reload without interrupting execution.
Workbench styling was coherent and inspected screens had no page overflow.

Repository cleanup is complete: active docs are indexed from README, the sample app and
private trial state are removed, useful evidence is archived, and the owner fixture is under
test/fixtures. Verification: typecheck/lint pass, all 866 offline core tests pass, the moved
owner-walkthrough Chromium regression passes, six examples validate and documentation links
resolve. No product behavior or provider execution was added during cleanup.

## Evaluation context

The owner completed a small live OpenCode workflow, including a manual continuation and
explicit Resume. It worked and otherwise felt reasonably intuitive; completed-map navigation
was the concrete remaining complaint. Earlier complaints about the rejected UI drove the
redesign; verify current behavior before treating them as present defects.

The later trial built equipment/borrower CRUD, checkout/returns/history, filters, reporting,
SQLite persistence and a maintenance follow-up through Workflowz. All five selected harnesses
performed substantive work. An initial transport failure required a separately authorized
product fix/Resume; independent browser testing then caught an app reset bug missed by the
main green run. Agents repaired it through a separate workflow. Review also caught and
repaired maintenance count and stale-toggle defects.

Final historical checks passed: 20 Python tests, 40 baseline API/process checks, 29 maintenance/
migration checks, 19 baseline browser checks, 8 maintenance browser checks and a two-tab
conflicting checkout. These are recorded results, not tests still runnable after sample removal.
Native records were independently rechecked; all three runs ended at their successful nodes.
[Execution evidence](docs/evaluations/equipment-lending/evidence/execution-recheck.json).

Separate attribution: harness browser attachment/readiness friction suggests better tooling
instructions. Generated-app formatting and minor UI polish findings belong to the retired
sample, not this active Workflowz backlog. The evaluator's corrected browser selector was
also a tooling mistake, not an app defect. See the full report for limitations.

## Future proposals

Named agent profiles, assisted drafting, model/effort catalogs, native skills and desktop
lifecycle remain [future proposals](docs/DESIGN.md#future-product-proposals-not-implemented-or-scoped),
not implemented features or automatically selected next work.

## Keeping this clean

Use this file for finding status, [DESIGN.md](docs/DESIGN.md) for product decisions and the
[user guide](docs/USER_GUIDE.md) for operating instructions. Historical evidence stays archived.
Temporary experiments use private disposable locations; bring back useful findings and
regressions, then remove their scaffolding. The small owner-walkthrough fixture is retained
under test/fixtures solely because an offline regression uses it. Keep runtime data, caches,
build output and dependencies out of versioned project material.
