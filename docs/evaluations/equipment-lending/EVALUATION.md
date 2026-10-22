# Trial evaluation record

> Archived after completion and cleanup on 2026-10-22. The generated app, private runtime
> databases and one-off helper scripts were retired. Observations, test counts and state
> descriptions below refer to the evaluation checkpoint, not a running service or active
> assignment. Public evidence, reports and original graph/spec inputs remain here; the
> [archive entry point](README.md) explains what was retained. Current priorities are in
> [IMPROVEMENTS.md](../../../IMPROVEMENTS.md).


Status: **executed and independently verified: repaired baseline and maintenance follow-up complete** (2026-10-22). The original transport failure and owner-authorized repair/Resume remain part of the trial. The evaluator has not edited application source. Application formatting/semantic lint findings remain explicitly recorded below.

## Execution summary

- All five exact model/effort selections passed separate provider-backed tool/report preflight and then performed substantive work in the main run. No model or account substitutions.
- Main revision 1, run `run_9ae79946-41f0-4b67-a8ab-1a83d516d6f2`: explicitly started through Workbench at 10:15:49 UTC, paused after 303.077 seconds on a bridge protocol error. After the owner authorized diagnosis/fix and continuation, explicitly resumed at 11:32:22 UTC; completed at 11:54:11 UTC, all three imported tasks complete. [Full public events](evidence/continuation-events.json).
- The bridge repair passed 866 standard tests and an actual 310-second delayed response check. This is a separate authorized product change, not uninterrupted autonomous success.
- Continuation took about 21m49s. Whole run wall time was about 98m22s including the long diagnostic pause. Thirteen main agent attempts: one failed, twelve acknowledged reports; zero report-only corrections. Ordinary review found actionable changes for all three tasks and exact-session Codex repair handled each.
- Independent evaluation: generated 17-test Python suite passes, and [40 evaluator HTTP/SQLite/process checks](evidence/independent-baseline-api.json) pass. However, [actual Chromium CRUD fails](evidence/independent-baseline-browser.json): after a successful equipment save, a recursive reset listener repeatedly clears new input. Thus a green authored run did not establish usable CRUD.
- Focused [browser repair](workflows/browser-repair.yaml), revision 3/run `run_55be6ae8-61e4-4c3e-b04b-4a9ce92e7c1b`, completed in 158.403 seconds. Repaired baseline accepted after 40 API/process and 19 real browser checks; [snapshot preserved before maintenance](evidence/accepted-baseline.json).
- [Maintenance follow-up](workflows/maintenance.yaml), revision 5/run `run_4816e7c2-c7d6-4be8-bb07-4253880bfe32`, completed in 652.355 seconds. Independent final results: 20 Python tests; 40 baseline API/process checks; 29 maintenance/migration checks; 19 baseline browser checks; 8 maintenance browser checks; two-tab conflicting checkout and keyboard skip-link operation. All pass. Both later imports deliberately omit task sources; original checklist untouched.
- [Timing/call summary](evidence/trial-summary.json): 25 provider invocations including five separate preflights, one original technical failure, and 19 accepted substantive reports. Ten command-node invocations passed. Zero report corrections or model substitutions. All three actual paths end at their successful node; no manual successful outcome was assigned.
- Provider usage/cost is incomplete. [Original failed OpenCode metadata](evidence/foundation-usage.json) reports cost 0, input 66,847, output 17,685, reasoning 19,014, cache-read 1,022,976; these are native fields, not an additive total. Whole-trial charges are unknown.
- Actual browser controls used for import, inspection, Save, Create, Start and explicit Resume. Terminal used for startup, diagnosis and independent verification. Private disposable state preserved at `/tmp/workflowz-equipment-trial-cdyf0bhm/state`. No Git operations, global harness changes or evaluator application-source repairs.

## Accepted baseline against the twelve criteria

| Criterion | Independent result |
| --- | --- |
| 1 Clean seed and local UI | Pass: fresh DB and actual Chromium page |
| 2 CRUD and error/input retention | Pass after workflow browser repair: real equipment/borrower create/edit/delete, validation and duplicate-tag errors |
| 3 Conflicting checkout | Pass: eight simultaneous HTTP attempts leave one active loan; browser removes conflicting choice |
| 4 Dates and status boundaries | Pass: malformed/impossible/before-checkout API dates refused; due-today distinct from overdue and returned in UI/report |
| 5 Return/history/recheckout | Pass: browser flow and API repeated-return date immutability |
| 6 Referenced deletion refusal | Pass: browser/API refusals, including returned-only history |
| 7 Combined filters | Pass: browser and HTTP name/tag/category/availability; loan overdue/returned filters |
| 8 Restart persistence | Pass: terminate/relaunch actual server and inspect retained custom records |
| 9 Disposable automated checks | Pass: generated 17-test suite independently run; evaluator HTTP/process checks and browser regression |
| 10 Dynamic report/repeat seed | Pass: custom data changes totals; independent SQL/detail comparison; entire dump stable on reseed |
| 11 Keyboard/responsive | Pass within Chromium sample: Enter actions, edit focus and visible phone focus; no overflow at 1440/768/390px. No broad accessibility audit |
| 12 README contracts/limits | Launch/seed/test/report commands exercised; current README and actual artifacts present |

Evidence: [API/process checks](evidence/independent-baseline-corrected-api.json),
[browser checks](evidence/independent-baseline-verified-browser.json),
[preserved accepted baseline](evidence/accepted-baseline.json). This accepts the repaired
baseline, while preserving the main run's earlier false-positive acceptance finding.

## Exact harness selections and participation

All five passed preflight and performed substantive main-run work: OpenCode foundation, Codex three implementations and resumed repairs, Claude three reviews, OMP integration, Pi independent audit.

| Harness/version | Exact model | Workflow effort | Resolution evidence |
| --- | --- | --- | --- |
| OpenCode v2.0.32 | `opencode/deepseek-v4.1-flash-free` | omitted/default | current `opencode models --standalone` catalog |
| Codex 0.163.0 | `gpt-6-luna` | `low` | installed model catalog advertises low/medium/high/xhigh/max; low is this CLI's minimum |
| Claude Code 2.1.307 | `claude-haiku-5-5` | `low` | [official model configuration](https://code.claude.com/docs/en/model-config): exact ID and low minimum |
| OMP 18.12.6 | `openai-codex/gpt-6-luna` | `off` | current catalog and no-prompt RPC advertise off/low/medium/high/xhigh/max; compat disables reasoning with lowest supported effort (low) |
| Pi 1.4.0 | `openai/gpt-6-luna` | `off` | current authenticated catalog maps off → none; minimal is unsupported |

[OpenAI's API model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna)
describes the API model; the Codex subscription CLI advertises a narrower effort set, so
API `none` was not assumed to be a supported Codex selector. Context7 supplied current
[Codex](https://github.com/openai/codex), [OMP](https://github.com/can1357/oh-my-pi/blob/main/docs/rpc.md),
[Pi](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md),
[OpenCode](https://github.com/anomalyco/opencode) and Claude documentation. Local help/catalog
resolved installed-version syntax (e.g. OpenCode models takes no provider positional argument).

All minimal live checks executed through the actual adapters, performed a tool action,
received an acknowledged report, settled cleanly, and survived a durable database reopen.
Each used one invocation, zero report corrections. Main-run live invocations: thirteen, including the original failed foundation and its explicitly authorized fresh-session rerun. Corrective/follow-up calls are recorded separately below. OpenCode and OMP have no supported
standalone auth status in the smoke helper; their live success established access.
Normal account configuration was preserved. Initial direct OMP/Pi help hit sandbox cache
write restrictions; normal-access probes succeeded. [Daemon environment evidence](evidence/daemon-environment.json)
confirms PATH, HOME and the allowlisted harness/config directory variables match the launcher,
without publishing their values. Node v26.7.0; Python 3.15.1. OpenCode inherited the existing MCP setup (including a `npx @playwright/mcp@latest` launcher); this was not an isolated harness home. No account/model setup was replaced.

## Feature coverage

| Capability | Status | Evidence / limit |
| --- | --- | --- |
| File import; Graph/Form/YAML/Project/Rules; checker | Observed | Actual browser file upload and all five views; reversible quote error, Fix focus and successful repair; screenshots 01–08 |
| Immutable save, Create versus Start | Observed | Revision 1; [saved source equivalence](evidence/saved-revision.json); ready preview with three full tasks; keyboard Start; [events](evidence/main-events.json), screenshots 08–12 |
| All five exact harness models | Observed substantively | OpenCode foundation; Codex implementation/repair; Claude review; OMP integration; Pi audit |
| Task import and loop | Observed | Three full bodies frozen in order, all completed, task.next exhaustion reaches integration; source checkboxes unchanged |
| Commands/env/cwd/Output | Observed | Foundation, three slice checks and acceptance commands pass; cwd/env overrides, tests, seed/report and HTTP check; saved Output inspected |
| Declared branches/report handoff | Observed | Main changes/repair ×3; browser repair naturally approved and finalized; follow-up changes passed to resumed Codex. Explicit report context throughout |
| Exact Codex session continuation | Observed | Implementation and resumed repair session fingerprints match for each task, across intervening Claude review |
| Tagged policies and named-step override | Configured/checker observed | Effective failure destinations shown as Shared; no command failure traversed |
| Report-only correction | Configured; not exercised | One allowed; zero used in main/preflight; technical failure correctly bypassed correction |
| Repair/recheck paths | Configured; not exercised | No fabricated runtime failures; technical process error paused rather than entering normal command repair |
| Retry/backoff/timeouts | Not exercised as successful capability | No retry authored; 4h/180 and 25m agent limits configured. An earlier transport timeout was reproduced separately offline |
| History/Report/Output/Map/group navigation | Observed | Running, paused and finished states; Report/Output retained across Map navigation; completed map shows task loop counts |
| Reload during running | Observed | +2m06s, paired session retained and same execution continued |
| Focus/responsive/appearance | Observed within bounded screens | Quote Fix focused command; Refresh output focus retained across run pause; ready/paused desktop and 390px phone; tablet paused check. Chromium only |
| Continued-use maintenance revision | Observed and verified | Revision 5/run completed; no tasks source; baseline snapshot and original inputs preserved; migration, API and browser checks pass |
| Human decisions/manual results/crash recovery | Outside baseline / not exercised | Explicit same-step Resume observed only after owner-authorized transport repair; no manual successful outcome or crash replay |


## Observation log

| Elapsed time | Screen/action | Intended result | Actual experience | Evidence/finding |
| --- | --- | --- | --- | --- |
| +2m06s | Reopen workflow-name link and reload | Execution survives browser reload | Same foundation still running after reload, no mutation pending; browser remained paired | [16-reloaded-running.png](evidence/16-reloaded-running.png) |
| +2 min | Navigate Running group | Find active work | Running row visible. Automation locator incorrectly assumed Open accessible name; corrected to workflow-name link. This is evaluator tooling friction, not a product defect. | [15-running-group.png](evidence/15-running-group.png) |
| +5m03s | Foundation settles | Autonomous handoff | Bridge protocol error; run pauses, no report or task completion; Refresh output keeps keyboard focus | [18-paused-protocol-error.png](evidence/18-paused-protocol-error.png) |
| Diagnosis | Offline long wait | Attribute failure without a model replay | Unmodified bridge hits 300.7s headers timeout and emits same symptom | [wait-diagnostic.json](evidence/wait-diagnostic.json) |
| Evaluation | Independent partial app checks | Establish actual delivered behavior | 11 tests pass; seed/report/restart/storage checks pass; CRUD absent and invalid-month storage gap found | [independent-partial.json](evidence/independent-partial.json) |
| Preflight | Five adapters and exact models | Tool + acknowledged report | All five pass; no substitutions | [preflight.json](evidence/preflight.json) |
| Authoring | Actual parser/path check | Valid runnable graph | Generated YAML initially used aliases; then attempted command report context. Both rejected precisely; corrected before import | Authoring mistakes, not product defects |
| Authoring | Import Graph / Fit | Inspect 18-node graph | Fit reaches 35%; overall topology visible, text too small for practical reading | [02-graph-fit.png](evidence/02-graph-fit.png) |
| Authoring | Reversible unfinished command quote | Useful checker and focus repair | Inline says “Close the double quote”; checker also says “expected array, received string”. Fix focuses command; restoring value clears error | [03-checker-unfinished-command.png](evidence/03-checker-unfinished-command.png) |
| Ready | Create run / inspect Map / phone | Prepare without launching | All three tasks visible; explicit Start separate; phone 390 px has zero page overflow | [09-ready-desktop.png](evidence/09-ready-desktop.png), [11-ready-phone.png](evidence/11-ready-phone.png) |
| Authoring | Project inputs | Preserve ordered context | AGENTS.md, SPEC.md and trial instructions configured; task source is TASKS.md | [04-project-inputs.png](evidence/04-project-inputs.png) |


## Findings

### F4 · Foundation fails at about five minutes despite a 25-minute step limit (blocking, transport)

Start 10:15:49.479 UTC → settled/pause 10:20:52.556 UTC (303.077 seconds). No configured
agent silence timeout; `timedOut:false`; exit code 0. Bridge stdout ends in `protocol_error`;
Report calls it “the agent provider failed”. No `report_accepted` event exists. OpenCode's
sanitized session metadata ends in an `aborted` error; it was still doing substantive work.
The original process group has no remaining members. [Public event facts](evidence/main-events.json),
[paused Output](evidence/18-paused-protocol-error.png), [Report](evidence/19-paused-report.png).

Source diagnosis: [opencode-bridge.ts](../../../src/adapters/opencode-bridge.ts) uses bare Node `fetch` for its long
`/api/experimental/session/.../wait` call and collapses every non-resume exception to
`protocol_error`. [Node/Undici documentation](https://github.com/nodejs/node/blob/main/deps/undici/src/docs/docs/getting-started.md) gives a default response-header wait of 300 seconds. The observed
timing strongly suggests this transport deadline, rather than a provider failure or the
configured Workflowz step deadline. An offline reproduction against the unmodified bridge
reproduced the exact bridge symptom: after 300,721 ms the wait request raised
`UND_ERR_HEADERS_TIMEOUT` / `HeadersTimeoutError`; the bridge emitted `protocol_error`
and exited 0. Diagnostic source (retired during repository cleanup), [result](evidence/wait-diagnostic.json).
The fixture delays a local response for 310 seconds and invokes the **unmodified** built
bridge, with a wrapper recording only safe fetch error fields. It makes zero provider
calls. The transport defect is confirmed offline; attribution of the original swallowed
exception remains a high-confidence inference, not a recovered original stack trace.
This diagnostic is not counted as a live failure branch or successful timeout coverage.

Proposed narrow remedy (separate product task): make the long wait transport obey the
supervised invocation lifetime, preserve sanitized error category/cause, and regress a wait
longer than the HTTP client's default deadline. Never retry uncertain mutating execution.

### F5 · Technical failure presentation obscures cause (high, Workflowz usability)

The paused heading says “Foundation reported system.process_error”, although no agent
report was accepted. Report says “the agent provider failed”; Output simultaneously shows
“Exit code 0” and an opaque protocol error. Those are different layers, but the screen does
not explain them. Improve wording to identify runner/transport failures separately from
agent-declared outcomes, and show a safe concrete cause near the paused heading. Existing
pause behavior correctly prevented automatic replay, and output/history remained inspectable.

### F1 · Command checker exposes an internal type error (medium, Workflowz usability)

Typing `python3 "` into Foundation check's Form Command field shows the helpful inline
“Close the double quote” **and** “Invalid input: expected array, received string”. The
checker dock repeats only the latter. Fix correctly focuses the command field, and
restoring the valid command clears the error. [Screenshot](evidence/03-checker-unfinished-command.png).
Use the command parser's action-oriented message in the checker; suppress the secondary
schema error for this known invalid command representation. No product fix made.

### F3 · Long agent steps have little visible progress (medium, capability/usability)

During the multi-minute OpenCode foundation, the screen names the harness/model and elapsed
time but task progress remains 0/3 with none active (correctly, foundation precedes tasks).
Report has no result and Output waits for settlement. File creation was visible only through
the evaluator's terminal; ordinary Workbench use gives no intermediate work summary.
[Running screen](evidence/12-running-foundation.png), [Output](evidence/13-running-output.png).
This is a visibility limitation, not evidence the provider stalled. OpenCode's adapter has
no event stream. Consider a stage-count indicator and optional adapter activity/last-activity
hint with clear “saved output after finish” wording; do not imply unsupported live streaming.

### F2 · Graph Fit makes a realistic graph hard to read (medium, Workflowz appearance/usability)

At 1440 px, Fit shrinks this 18-node task/review/repair graph to 35%. The overall topology
is visible, but outcome text is impractical to read; return lanes occupy a large area.
[Fit screenshot](evidence/02-graph-fit.png). Form is clearer for inspecting precise routes
and model settings ([screenshot](evidence/07-form-codex.png)). Add a readable overview with
focus-on-path / selected-node zoom, or collapse repair paths. These are untested design
suggestions; current scroll/zoom controls are functional.



## Original failed attempt: partial artifact (historical)

At the original 10:20 UTC pause, Foundation stopped before the first task. The checks
below record that partial checkpoint, not the subsequently completed app. Current
baseline acceptance is summarized above and the browser repair record below.

Evaluator ran the generated suite independently: **11/11 pass**
([test output](evidence/independent-foundation-tests.txt)). Additional evaluator-authored
verification (retired during repository cleanup) launches real subprocesses and uses independent SQL, not
app report functions ([results](evidence/independent-partial.json)). It establishes:

- Seed/re-seed leaves the entire database dump unchanged; custom evaluator records survive.
- Fixed-date report agrees with independent SQL: 10 equipment, 7 available, 3 on loan,
  4 borrowers, 3 active loans, 1 overdue, 2 returned. PT-001 is 7 days overdue; due-today
  is excluded. Additional equipment changes report totals, proving they are dynamic.
- Invalid report date 2026-02-30 returns exit 2 with a clear stderr message and no stdout.
- Two simultaneous **storage** checkout inserts yield exactly one insert and one unique
  conflict. Historical equipment and borrower deletion is refused by foreign keys.
- Real server termination/restart against the same database preserves the summary/custom data.
- `GET /api/equipment` returns 404 and `POST /api/equipment` 501: CRUD is absent, as the
  foundation README candidly states. These were not claimed as functional request checks.
- A further storage probe found invalid month dates (`2026-13-01` / `2026-14-01`) are
  accepted: SQLite's NULL-valued date CHECK passes. The transaction was rolled back.
  This is a partial-app integrity gap for later implementation; no app fix was made.

| Spec criterion | Actual result |
| --- | --- |
| 1 Clean seed and local UI | Partial: foundation server/overview works; complete CRUD app unavailable |
| 2 Equipment/borrower CRUD and error/input preservation | Not implemented; cannot accept |
| 3 Checkout conflict | Storage concurrency guard passes; API and browser flow absent |
| 4 Dates/overdue | Fixed report boundary and invalid report date pass; invalid-month storage gap; loan forms absent |
| 5 Returns, history, stable repeated return | Not checked through an app; return flow absent |
| 6 Historical deletion constraints | Storage guard passes; browser/API absent |
| 7 Search/filter combinations | Not implemented |
| 8 Restart persistence | Pass for foundation summary and evaluator-added database record |
| 9 Disposable automated/request tests | 11 generated tests pass independently; own live process/API/storage checks recorded; full request CRUD tests unavailable |
| 10 Seed/report/database agreement | Pass for partial foundation and dynamic custom record |
| 11 Desktop/phone/keyboard | Shell inspected at 1440/768/390 px with zero page overflow; visible 3px keyboard focus on skip link; no forms exist to verify |
| 12 README contracts/limitations | Commands and honest foundation limitations present; links to artifacts/foundation.md are broken because invocation aborted before writing it |

## Original failure timing and preservation (historical)

Baseline execution: **5m03s** before the unexpected pause. The independent no-provider
transport diagnostic took **301.189 seconds** including startup/settlement. Preflight
workspace creation at 10:08:06 UTC → ready 10:15:06 → explicit Start 10:15:49; initial
reading/probing preceded that workspace timestamp. Diagnosis, screenshots and independent
verification ran afterward through approximately 10:33 UTC. Active attention and unattended
wall time were not instrumented separately; these timestamps do not claim an exact labor total.

Evaluator-created sample servers and Chromium are stopped. The dedicated Workflowz daemon
is left available with the run paused, no active attempt and 0/3 tasks done. Private state,
preflight artifacts and the partial snapshot remain under `/tmp/workflowz-equipment-trial-cdyf0bhm`.
Public evidence includes screenshots, allowlisted events and usage, not credentials or raw
harness transcripts. For access instructions see [README.md](README.md).

## Follow-up change

The maintenance delta was authored only after independent baseline acceptance and its
snapshot. [Workflow](workflows/maintenance.yaml) deliberately omits tasks, uses saved revision 5,
and runs `run_4816e7c2-c7d6-4be8-bb07-4253880bfe32`, explicitly started through Workbench
at 12:08:21 UTC. Codex implementation → Claude review → resumed Codex finalization →
Pi audit → existing form/browser regression → maintenance browser regression → acceptance.
The original checklist remains unticked; it was not reimported. Limits: 90 minutes/60
transitions, 25 minutes per agent and 3 minutes per command. The run reached its successful
end at 12:19:13 UTC after 10m52s; final independent acceptance is recorded below.

The initial failed foundation snapshot remains privately preserved separately from the
accepted baseline. [Original input hashes](evidence/input-checksums.json) still match all
original instructions, checklist, prompts and evaluator checker.

The following paragraph describes only the historical foundation shell:

The independent browser inspection found zero forms, matching the explicit placeholder
content. The shell has coherent cream/green styling, readable hierarchy, local-only resource
origins, visible navigation/skip-link keyboard focus and no page overflow at 1440, 768 or
390 px. [Desktop](evidence/partial-app-1440.png), [phone](evidence/partial-app-390.png).
This is evidence about the partial shell only; CRUD focus preservation was unavailable.

## Prioritized recommendations and limits

1. **Blocking, addressed separately — transport deadline (F4).** The owner-authorized core-HTTP repair respects supervised invocation limits and retains safe error causes. Offline 310-second verification and the resumed live foundation passed. Preserve the regression and settlement/no-replay behavior.
2. **High — failure attribution (F5).** Present transport/process failures as technical failures rather than agent reports or proof of provider failure. Preserve safe error codes next to the main failure summary; the bridge now supplies better diagnostics but the original UI evidence remains.
3. **High for workflow authors — real acceptance checks (F6).** Include an executable browser CRUD check. API tests and a delivered HTML page missed a form that continuously erased input. Provide a verified browser recipe and make unverified acceptance claims visible; broader product support is a suggestion, not an implemented guarantee.
4. **Medium — progress and output discovery (F3).** Show current phase and useful activity/attempt elapsed time. Task progress legitimately reached 3/3 while integration/audit remained. Long silent steps offered only elapsed time; total elapsed included the long pause. Saved Output and Report work well once located, but are not live progress.
5. **Medium — checker language and graph scale (F1/F2).** Carry the specific “Close the double quote” guidance into the checker instead of “expected array, received string”. Fit at 35% hides readable labels; offer a focused path or collapsible repair sections. Those design ideas remain untested.
6. **Low — stale action feedback.** Change “Resumed. Foundation runs again” to past tense or clear it as execution advances; it remained visible during later tasks.

What worked: separate Save/Create/Start; frozen task preview; editable model/effort fields;
ordered project instructions; shared-rule disclosure; cross-harness actionable review;
exact-session Codex continuation; clear Report/Output tabs; grouped run navigation; completed
Map with actual traversal counts; reload without interruption; retained selection/focus as
execution advances. Dark Workbench styling is coherent and inspected screens had no page
overflow at desktop/tablet/phone widths. Form was substantially easier than a fitted
18-node graph for checking routes and configuration.

Scope limits: one real multi-harness baseline with an explicit repair/Resume interruption,
not a reliability benchmark. No Firefox/WebKit, broad accessibility audit, provider outage
claim, deliberate crash, human decision, automatic retry, timeout-path success or report-only
correction. Authored bounded command repair routes were not traversed. Whole-trial billing
and precise evaluator attention time are unknown. No model substitutions or Git workflow.

Product-fix verification: 866 standard tests, 67 focused adapter/framing/conformance checks,
typecheck/lint and the actual 310-second wait passed at that checkpoint. Final trial-specific
checks and maintenance results are recorded below; generated-app code is evaluated separately.

## Owner-authorized transport repair

After reviewing the trial result, the owner requested diagnosis and a product fix. This
is separate work after the original evaluation; the failure screenshots/events above remain
unchanged, and the original failure checkpoint remains preserved. The later owner-authorized Resume is recorded below.

The cause was the bridge's use of built-in `fetch` for the long OpenCode wait: the HTTP
client ended a silent wait after 300 seconds, independently of the 25-minute invocation
limit. The prior offline reproduction captured `UND_ERR_HEADERS_TIMEOUT` and the exact
bridge symptom. The original live exception was discarded, so its cause is still inferred
from that timing and reproduction rather than a recovered stack trace.

The repair uses Node's core HTTP client with no independent transport deadline. The common
supervisor still enforces configured wall/idle limits and Stop for the entire process group.
Each request gets its own connection; redirects and automatic mutation retries remain absent.
Bounded response size, strict UTF-8/JSON, exact session/admission/terminal checks and waiting
for leased-server/process settlement are preserved. Protocol errors now produce a nonzero
bridge exit and fixed safe categories/network codes in saved Output; private API bodies and
raw exception messages are not exposed. No workflow schema, state migration or global harness
configuration change is involved.

Verification so far: build, typecheck and lint pass (existing diagnostics remain); all 67
focused OpenCode adapter/framing/conformance tests pass. All 866 standard tests also pass with no failures/skips. The actual
310-second delayed-header regression passed in 311.1 seconds, with one session creation,
one prompt and one wait request. [Long-wait result](evidence/transport-fix-long-wait.txt),
[verification summary](evidence/transport-fix-verification.json). Tests also check explicit Stop, configured
timeout, connection reset, redirect rejection, malformed/oversized response handling and no
request replay. All repair verification is offline; no provider-backed retry was launched.

The historical diagnostic (retired during repository cleanup) and its original timeout evidence are retained
from before the fix. Use the extended adapter test documented in
[the compatibility reference](../../reference/harness-compatibility.md#logs-and-verification-limits)
for the current bridge; it supplies both successful final metadata and delayed wait headers.
The original trial was not resumed, its immutable history was not changed, and the partial
application/checklist were not edited during this repair.

## Owner-authorized continuation

At 2026-10-22 11:32 UTC the owner delegated restart/continue choice after reviewing the fix.
The evaluator chose to continue revision 1/run `run_9ae79946-41f0-4b67-a8ab-1a83d516d6f2`
using Workbench **Run this step again → Resume run**, with the reason recorded in history.
This reruns Foundation with its authored fresh OpenCode session against the existing partial
project. It does not assign a successful result to the failed attempt. All three frozen
tasks and previous evidence remain in place, with over two hours of the original wall
budget remaining. No model/effort changes, new checklist import or app-source edits by the
evaluator were made. The browser's reason entry is clear; the primary action is Resume,
not Apply, for this direct same-step rerun. This is explicit intervention after diagnosis,
so the overall trial is no longer an uninterrupted autonomous baseline.

[Ready to continue](evidence/25-continuation-ready.png),
[resumed Foundation](evidence/26-foundation-resumed.png).

Continuation observation at 11:36 UTC: Foundation reported complete at 11:36:05 and
settled at 11:36:15 (3m53s after Resume). Workflowz waited for settlement before starting
the foundation command; it passed in about 1.3s, then task 1 was selected and Codex began.
Refresh output retained focus and the selected Foundation output stayed pinned while the
current heading advanced to Implement. The accepted report explicitly identified rendered
screenshots versus unavailable interactive browser checks. Foundation's previously missing
evidence file now exists. [Pinned output](evidence/27-foundation-finished-pinned-output.png),
[accepted report](evidence/28-foundation-report.png),
[command output](evidence/29-foundation-command-output.png).

At 11:38:34 UTC Codex completed task 1's implementation (2m18s). Claude reviewed it in
28s and reported `changes`: null/non-string JSON fields were coerced to literal text such
as `"None"`. It executed API probes and 12 tests, gave a precise reproduction, and explicitly
limited its browser claim. Workflowz routed to the authored Codex Repair step at 11:39:02.
This is a generated-app validation defect caught by the intended cross-harness review,
not a Workflowz defect. No evaluator fix was made. The previously selected command Output
tab survived Map → History navigation. [Review handoff](evidence/31-task-one-review-changes.png),
[agent's concrete review](reports/review-1.md).

Task 1 repaired and completed at 11:39:48 UTC. The Codex implementation and repair
invocations have the same hashed session identity in [continuation events](evidence/continuation-events.json),
with Claude's separate review between them. The stable command passed, `task.complete`
marked the frozen task done, and `task.next` selected task 2. This establishes exact-session
continuation, the natural review changes branch, command settlement and task iteration.
The source checklist remains unticked. [Repair report](evidence/32-task-one-repaired.png).

Task 2 review at 11:42:53 UTC reported `changes` after independent API probes (including
12 simultaneous checkout requests) and the generated 13-test suite. Server rules passed;
source review found equipment cards were not refreshed after checkout/return. Claude
clearly stated that it had not reproduced this in an interactive browser. Codex's resumed
repair is running. [Review 2](reports/review-2.md).

A small wording observation: the inline “Resumed. Foundation runs again from the beginning”
feedback remains visible after the heading has advanced to task 2. It is accurate as a
past action but reads like current work. Prefer past tense (“Resumed at Foundation”) or
clear the transient message on the next step. This is low-priority Workflowz wording, not
a routing problem; visible in [task-1 repair inspected during task 2](evidence/32-task-one-repaired.png).

At 11:46:21 UTC all three tasks were marked complete and the task source was exhausted,
so OMP integration began automatically. Task 3's review caught stale category choices
after equipment mutations and a missing request-level overdue boundary test; the resumed
Codex repair completed in 26s and the slice command passed. All three reviews naturally
reported changes, so the approval/finalization branch remains unvisited in this baseline.
[Review 3](reports/review-3.md), [handoff screenshot](evidence/33-task-three-review.png).

Progress observation: the Workbench shows 3/3 tasks (100%) while OMP and Pi still have
substantive work. The label correctly describes task progress, but offers no overall phase
progress. This reinforces F3's recommendation to show current phase/remaining authored work
without pretending loops have a fixed total. [Integration desktop](evidence/34-integration-three-tasks-done.png),
[phone](evidence/35-integration-phone.png).

OMP integrated from 11:46:21 to 11:52:36 UTC (6m15s), then reported complete. It
reconciled cross-feature availability/choice refreshes and ran 16 tests plus disposable API,
seed/report and route probes. Its managed browser attachment timed out; it explicitly
reported interactive visual/keyboard checks as outstanding. A first ad hoc re-checkout
probe used an invalid date and skipped cleanup on its assertion; OMP documented that probe
error and reran a corrected isolated flow. This is harness/probe friction, not evidence of
a Workflowz transport failure or a verified UI. Pi audit began automatically at 11:52:36.
[OMP report](reports/integration.md), [Workbench handoff](evidence/36-omp-integration-report.png).


## Independent completed-baseline evaluation and browser repair

Pi finished at 11:54:10 UTC after adding an impossible-date storage regression; the acceptance command passed 17 tests, seed/report and server checks, reaching the successful end. [Completed run](evidence/37-baseline-workflow-completed.png), [execution map](evidence/38-completed-execution-map.png). Pi and OMP explicitly limited interactive browser claims; the evaluator did not infer UI correctness from their reports.

Independent API/process evaluation passed 40 checks: CRUD, invalid JSON fields, eight simultaneous checkouts (one success/seven conflicts), impossible and boundary dates, repeat return behavior, history-only deletion constraints, combined filters, SQL/report agreement, repeat seeding and persistence across actual process restart. [Machine-readable results](evidence/independent-baseline-api.json), [independent suite run](evidence/independent-baseline-tests.txt).

Actual browser testing then failed after only two checks. A successful equipment save led to continual input clearing. Two fresh-load minimized probes observed 42 reset events within 150ms, with the same connected form element: clearForm invokes reset, whose listener schedules clearForm again. [Diagnosis](evidence/form-reset-diagnosis.json), [failed browser state](evidence/baseline-app-failure.png). This is a generated-app defect missed by the workflow's API-centric verification, not a Workflowz engine failure. No evaluator app fix was made. The original failed evidence and source snapshot are preserved.

The focused corrective workflow requires a real Chromium red/green regression for both forms, independent Claude review, exact-session Codex finalization, and browser plus acceptance command nodes. [Imported Form](evidence/39-browser-repair-form.png), [ready state](evidence/40-browser-repair-ready.png). Its no-task preview explicitly confirms one pass through the steps, avoiding reimport of the unchanged source checklist.

### F6 · Green command checks missed unusable browser CRUD (high, generated app / verification gap)

The central requirement was browser CRUD, but the main workflow's browser attempts were static rendering, unavailable tooling or an attachment timeout. Agents disclosed these limits; the deterministic graph nevertheless reached a successful end because its acceptance command tested APIs and page delivery. Improve the workflow template with an actual browser interaction check that fails when core CRUD cannot complete. Workflowz could help by showing unverified acceptance claims or offering a documented, provider-independent browser command example. This is a suggested capability, not an existing feature defect.

Harness finding: evaluator Chromium works through installed @playwright/test with channel chromium; agents attempted other browser paths and lacked clear readiness guidance. A consistent preflight/browser recipe would reduce wasted attempts. Do not treat this as proof that each harness has identical native browser capability.


Browser repair settled successfully at 12:04:40 UTC after about 2m38s: Codex reproduced the original defect before changing code, Claude independently ran the browser regression and approved, and Codex performed meaningful same-session finalization. Browser and acceptance command nodes both passed. [Events](evidence/ui-repair-events.json), [repair evidence](reports/ui-repair.md), [independent review](reports/ui-review.md), [approval screenshot](evidence/42-browser-review-approved.png). This naturally exercised approval/finalization, previously unvisited in the main loop.

The evaluator reran all 40 API/process checks after repair; they pass. The full browser script advanced through eight checks, then its exact Equipment label selector timed out. DOM inspection showed the real select and expected options present: nested label text includes option contents. This is an evaluator locator mistake, not a failed checkout or reset repair. The original failed attempt remains in [browser attempt](evidence/independent-baseline-corrected-browser.json); selectors were corrected to stable form/name attributes for a clean rerun.


The accepted baseline passes [19 independent Chromium interaction checks](evidence/independent-baseline-verified-browser.json) and [40 API/process checks after repair](evidence/independent-baseline-corrected-api.json). Browser coverage includes equipment/borrower create/edit/delete and error-input preservation, named delete confirmations, combined filters, checkout date errors, checkout/return/recheckout/history, deletion refusal, due-today/overdue/returned distinction, visible keyboard focus and zero page overflow at 1440/768/390px. No uncaught page errors. The API checks establish simultaneous checkout refusal; the UI removes unavailable items from choices. Chromium only; no screen-reader audit claimed.

Accepted source/data snapshot and [hash manifest](evidence/accepted-baseline.json) were preserved **before** authoring the maintenance delta. Sample servers were stopped/reaped before agents resumed work. The separate [maintenance workflow](workflows/maintenance.yaml) validates with nine steps and zero warnings, 90-minute/60-transition ceilings, exact existing Codex/Claude/Pi selections and explicit absence of a task source. [Delta](inputs/MAINTENANCE.md) requires state-aware availability/reporting, safe existing-database migration, checkout enforcement and returnability while under maintenance. Ordinary API/UI details are delegated to agents.


Appearance observation: the running Workbench gives a large panel to Pause/Stop before the history, placing results below roughly 500px at a 1000px desktop height. [Follow-up running](evidence/45-maintenance-running-after-navigation.png). A compact normal-running control row would bring useful evidence higher while keeping Stop distinct; this is a low-priority visual hierarchy suggestion. The typography, spacing, dark panels and mint selection treatment are otherwise consistent.

Sample-app appearance is coherent: warm neutral surfaces, dark-green actions, clear textual status and visible focus. The large overview hero pushes operating forms down the page; anchor navigation helps, but a shorter header would better suit repeated desk work. [Overview](evidence/baseline-verified-app-overview-desktop.png), [phone form](evidence/baseline-verified-app-equipment-phone.png), [tablet loans](evidence/baseline-verified-app-loans-768.png). This is generated-app feedback, not Workflowz UI feedback.


Maintenance implementation handed off naturally to Claude review at about 12:14 UTC.
The agent documented integer storage/boolean input, v1→v2 migration, an insert trigger and
immediate transactions, omitted-flag preservation and overlapping on-loan/maintenance
counts. These are agent claims pending evaluator verification. [Implementation report](reports/maintenance.md), [Workbench report](evidence/46-maintenance-implementation-report.png).


Claude's maintenance review reported **changes**: the new maintenance count existed, but available counts still ignored the flag, so a maintained unloaned item was counted as available despite exclusion from filters. It reproduced the mismatch through SQL/HTTP and actual Chromium. It also caught the missing named maintenance regression script and identified a stale-card toggle overwrite risk. The existing 19 tests and browser script had passed despite the count bug. Workflowz naturally handed these concrete findings to the same Codex session; no evaluator app intervention. [Detailed review](reports/maintenance-review.md).


At about 12:17 UTC, resumed Codex finalization completed and Pi audit began. The agent added the maintained-but-unloaned report regression, corrected available counts, supplied the required separate browser script and tested a stale card toggle against a changed name. It reports 20 passing Python tests and both Chromium scripts passing. [Handoff](evidence/48-maintenance-finalized-pi-running.png). This is an autonomous review/repair handoff; acceptance still awaits command settlement and independent evaluator checks.


## Final maintenance acceptance and service state

The follow-up settled at **12:19:13.541 UTC**, successful end, four accepted agent reports,
three successful command nodes and zero report corrections. Its exact Codex session hash
matches implementation and finalization, across the intervening review. Pi performed actual
HTTP/SQLite and Chromium work and made no unneeded source change. [Events](evidence/maintenance-events.json),
[Pi audit](reports/maintenance-audit.md), [completed run](evidence/49-maintenance-completed.png),
[completed map](evidence/50-maintenance-completed-map.png), [all three finished runs](evidence/51-finished-runs.png).
The Finished group and Map → History links remained usable after completion; no RPC workaround
was used for authoring, saving, creating, starting or resuming these runs.

Evaluator checks after settlement:

| Independent verification | Result / evidence |
| --- | --- |
| Generated final suite | [20 tests pass](evidence/independent-final-tests.txt) |
| Full baseline API/storage/process regression | [40 checks pass](evidence/independent-final-api.json) |
| Maintenance and real old-schema migration | [29 checks pass](evidence/independent-maintenance-api.json): all original equipment/borrower/loan columns and IDs preserved; flag defaults false; six simultaneous maintained checkout requests refused; direct SQL insert refused; malformed flags and omission preservation; return while maintained; report/overview/SQL agreement; repeat seed and actual restart persistence |
| Baseline browser regression | [19 checks pass](evidence/independent-final-browser.json), after maintenance |
| Maintenance browser/widths | [8 checks pass](evidence/independent-maintenance-browser.json): create marked item, filter and checkout-choice changes, clear state, checkout, mark while on loan, browser return preserves flag, reload persistence, 1440/768/390px inspection |
| Stale two-tab checkout and keyboard | [Pass](evidence/independent-browser-conflict.json): first checkout succeeds, stale second submission shows “This equipment is already on loan.”, dates/borrower remain, exactly one active loan; actual Tab/Enter operates the skip link |

The final accepted source/data snapshot and [hash manifest](evidence/final-project.json)
are preserved separately from the pre-repair and pre-maintenance snapshots. Original
SPEC/AGENTS/TASKS, original workflow prompts/instructions and evaluator checker hashes
remain unchanged. The three source tasks remain unchecked, as expected. No evaluator
application-source edits, Git operations, global installation/configuration changes or
account/model substitutions occurred.

Remaining sample quality findings: the new maintenance checkbox is centered above its
label at phone width, making its relationship less clear than an inline checkbox/label
row ([phone screenshot](evidence/maintenance-app-390.png)). After a stale checkout conflict,
the unavailable equipment choice disappears while the generic error remains; retain a
named disabled choice or include the asset name in the message to preserve context
([conflict screenshot](evidence/browser-conflicting-checkout.png)). Both are generated-app
UX findings; checkout integrity passes. Neither was silently polished after evaluation.

Final Workflowz typecheck passes. Production-source lint (`src ui scripts test`) passes
with one existing warning and 140 infos. Evaluator JavaScript checks pass. Whole-repository
lint includes the generated sample and **fails with seven sample errors**: formatting in
app.js/styles.css/two browser scripts, import ordering in those scripts, and the semantic
`<search>` preference for a div with role=search. It also reports 40 warnings/167 infos.
These are not a runtime acceptance failure, but the sample does not meet the parent's
Biome rules. No broad formatter was applied to hide this agent-output quality finding.
The Python suite also emits a pre-existing unclosed-HTTPError ResourceWarning on a negative
request test, while all 20 tests pass. Only installed Python 3.15.1 and Chromium were tested;
other claimed runtime/browser versions were not independently checked.

All evaluator sample servers and Chromium were stopped after verification. The dedicated
Workflowz daemon remains available with disposable state at
`/tmp/workflowz-equipment-trial-cdyf0bhm/state`; all three runs are completed with no active
attempt. Public evidence contains no credentials or raw private transcripts. Launch the
sample using its README (retired during repository cleanup). No further owner action was required while
the resumed baseline, corrective run or maintenance workflow executed.

Final documentation checks: 137 relative links resolve, code fences balance, all three workflows validate with zero warnings, original input hashes match, Python helpers parse, evaluator JavaScript checks pass, and `git diff --check` passes. Final run/status inspection confirms three successful end nodes and no sample server remains.
