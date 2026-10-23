# Workflowz improvement backlog

**Checkpoint — 2026-10-23:** F3 (progress and timing during long steps) is complete; see
its section below for the change, checks and limits. It is presentation only: the run overview
separates the task phase, the active attempt's recorded stage/time, elapsed time with its paused
portion, and tasks done. No server, event, schema or polling change. OWNER-1 remains implemented
and awaiting the owner's Map/results discoverability feedback. F5/F6 are complete.

**Verification setup restored:** commit `86927af` (removing `.cursor/skills`) had also deleted
`playwright.config.mjs`, which pins the browser suite: one worker, no retries, the `chromium`
channel, timeouts, `WF_BROWSER_OUTPUT` and no traces. With the owner's go-ahead the file was
restored byte-for-byte from `86927af^`. The bare `npm run test:browser` then passed all 64
offline scenarios with one worker and left no output or fixture state. The development
reference no longer lists the removed `.cursor/skills/` directory. Biome's exclusion of
bundled skill directories is unchanged and harmless.

**Next independent slice: F2.** Reproduce Fit on a realistic 18-node task/review/repair graph
offline, then record a bounded proposal for readable selected-path/node focus or collapsed
repair routes before implementing. Record owner feedback on Finished → Map/results when available.

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
| F2 | Medium · open | Fit shrank an 18-node graph to unreadable 35%; Form was easier to inspect. | Explore readable selected-path/node focus or collapsed repair sections, keeping every route inspectable. Test the proposed interaction. |
| F1 | Medium · open | Checker showed an array/string schema error instead of “Close the double quote”. | Carry the useful command-parser message into the checker, suppress duplicate noise and preserve Fix focus. |
| UX-1 | Low · open | “Foundation runs again” feedback stayed visible during later tasks. | Use past tense or clear transient feedback when execution advances. |
| UX-2 | Low · open | The large Pause/Stop panel pushes history and results down. | Explore compact normal-running controls with Stop still distinct and accessible. |

Sources: [owner walkthrough feedback](docs/evaluations/owner-walkthrough.md#owner-feedback),
[full trial findings](docs/evaluations/equipment-lending/EVALUATION.md#findings),
[prioritized critique](docs/evaluations/equipment-lending/EVALUATION.md#prioritized-recommendations-and-limits).

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
