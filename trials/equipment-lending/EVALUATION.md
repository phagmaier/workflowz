# Trial evaluation record

Status: **owner-authorized continuation in progress after transport repair** (2026-10-22). No manual outcome, rerun, resume or product fix was applied during the evaluation. Partial verification and offline transport diagnosis are complete. The owner subsequently authorized the separate transport repair recorded below; that does not turn this run into a successful trial.

## Execution summary

- Preparation/model preflight: complete. All five exact selectors/efforts resolved; offline adapters available; Chromium 156.0.8078.4 launches.
- Provider-backed checks: all five passed, one invocation each, no report correction. See [public preflight evidence](evidence/preflight.json).
- Main workflow revision and run: revision 1; run `run_9ae79946-41f0-4b67-a8ab-1a83d516d6f2`, created ready through the browser and explicitly started with keyboard Enter. [Workflow](workflow.yaml) validates: 18 nodes, zero warnings. Expected ordinary path: 25 node visits, 12 agent calls; bounded repairs add at most 4 calls and 8 node visits.
- Baseline result: paused at Foundation with `system.process_error`; no accepted report, no completed tasks. Main run duration before pause: 303.077 seconds. Partial verification below; full app acceptance unavailable.
- Follow-up revision and run: not performed; depends on an accepted baseline. The source checklist remains unchanged.
- Timing: ready run created 10:15:06 UTC; Start 10:15:49 UTC. Preflight private workspace created 10:08:06 UTC after initial document/tool inspection. Main execution/evaluation overlap; no precise active-attention timer.
- Usage/cost: [OpenCode-reported foundation metadata](evidence/foundation-usage.json) shows cost 0, input 66,847, output 17,685, reasoning 19,014 and cache-read 1,022,976 tokens. These are separate native fields, not an additive token total. Five preflight calls have no consolidated billing/usage total; whole-trial cost remains unknown.
- Owner intervention: none. Terminal used for daemon/preflight and Chromium control; authoring and run actions use actual browser controls. Private disposable state: `/tmp/workflowz-equipment-trial-cdyf0bhm/state` (preserved). No Workflowz source or global configuration edits.

## Exact harness selections and participation

All five participated in **preflight**; substantive main-run work was reached only for OpenCode; the other four were not reached because Foundation failed.

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
Each used one invocation, zero report corrections. Total live invocations: five preflight plus one failed substantive foundation; no live reruns. OpenCode and OMP have no supported
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
| All five exact harness models | Observed in preflight; main incomplete | Five acknowledged, settled checks; only OpenCode did substantive main-run work |
| Task import and loop | Import observed; loop not exercised | Three full bodies frozen in source order; 0 complete; source checkboxes unchanged |
| Commands/env/cwd/Output | Configured; main command steps not reached | Foundation agent executed the helper itself; that is not a Workflowz command-node execution. Preflight tool actions passed. Agent saved Output was inspected |
| Declared branches/report handoff | Configured; not exercised | No main accepted report; review and handoff nodes not reached |
| Exact Codex session continuation | Configured; not exercised | Three resumed finalization/repair nodes authored; no main Codex attempt |
| Tagged policies and named-step override | Configured/checker observed | Effective failure destinations shown as Shared; no command failure traversed |
| Report-only correction | Configured; not exercised | One allowed; zero used in main/preflight; technical failure correctly bypassed correction |
| Repair/recheck paths | Configured; not exercised | No fabricated runtime failures; technical process error paused rather than entering normal command repair |
| Retry/backoff/timeouts | Not exercised as successful capability | No retry authored; 4h/180 and 25m agent limits configured. An earlier transport timeout was reproduced separately offline |
| History/Report/Output/Map/group navigation | Observed on running/paused state | Return via workflow-name link, Report/Output keyboard tabs, saved diagnostics, paused execution map. No finished run exists |
| Reload during running | Observed | +2m06s, paired session retained and same execution continued |
| Focus/responsive/appearance | Observed within bounded screens | Quote Fix focused command; Refresh output focus retained across run pause; ready/paused desktop and 390px phone; tablet paused check. Chromium only |
| Continued-use maintenance revision | Not exercised | Blocked by baseline failure; no revision 2 or follow-up run |
| Human decisions, manual override, crash recovery, stop/resume | Outside baseline / not exercised | No manual intervention used to bypass the failure |


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

Source diagnosis: [opencode-bridge.ts](../../src/adapters/opencode-bridge.ts) uses bare Node `fetch` for its long
`/api/experimental/session/.../wait` call and collapses every non-resume exception to
`protocol_error`. [Node/Undici documentation](https://github.com/nodejs/node/blob/main/deps/undici/src/docs/docs/getting-started.md) gives a default response-header wait of 300 seconds. The observed
timing strongly suggests this transport deadline, rather than a provider failure or the
configured Workflowz step deadline. An offline reproduction against the unmodified bridge
reproduced the exact bridge symptom: after 300,721 ms the wait request raised
`UND_ERR_HEADERS_TIMEOUT` / `HeadersTimeoutError`; the bridge emitted `protocol_error`
and exited 0. [Diagnostic source](diagnose-wait.mjs), [result](evidence/wait-diagnostic.json).
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



## Independent application acceptance

The full application was not produced. Foundation stopped before the first task. The
checks below are explicitly **partial**, not acceptance of CRUD or of the workflow.

Evaluator ran the generated suite independently: **11/11 pass**
([test output](evidence/independent-foundation-tests.txt)). Additional evaluator-authored
[verification](verify-partial.py) launches real subprocesses and uses independent SQL, not
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

## Timing, preservation and service state

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

**Not executed.** A maintenance change on this incomplete foundation would not establish
continued use of a working CRUD baseline. No delta was slipped into the original spec.
A snapshot of the original post-failure project is preserved privately at
`/tmp/workflowz-equipment-trial-cdyf0bhm/partial-baseline.tar.gz`. Input/checker checksums
are [recorded](evidence/input-checksums.json); all remained unchanged after the harness.

For any later authorized continuation, preserve revision 1/run history and diagnose/fix
the transport as a separate product task first. Do not silently rerun this baseline or
mark Foundation complete. Once an accepted baseline exists, author the maintenance delta
as revision 2 or later and **remove the original `tasks` source from that follow-up YAML**;
all three source checkboxes still being unchecked is expected Workflowz behavior.


The independent browser inspection found zero forms, matching the explicit placeholder
content. The shell has coherent cream/green styling, readable hierarchy, local-only resource
origins, visible navigation/skip-link keyboard focus and no page overflow at 1440, 768 or
390 px. [Desktop](evidence/partial-app-1440.png), [phone](evidence/partial-app-390.png).
This is evidence about the partial shell only; CRUD focus preservation was unavailable.

## Recommendations and remaining limitations

1. **Blocking: fix the long-wait bridge transport (F4).** Respect the supervised invocation
   limit and retain a safe concrete error cause. Add an offline regression exceeding the
   HTTP client's header wait. Keep process settlement and no-replay guarantees intact.
2. **High: explain failures by layer (F5).** A transport exception is not an agent report
   or proof of provider failure. Explain why exit 0 can still be a failed invocation.
3. **Medium: carry command syntax feedback into the checker (F1).** Owners should see
   “Close the double quote”, rather than the representation's string/array mismatch.
4. **Medium: improve within-step progress and large-graph reading (F3/F2).** Keep honest
   elapsed/activity information and a readable focused path; avoid pretending saved output
   is a live stream. Collapsed repair paths and focus zoom are untested design suggestions.
5. **Generated app, later stage:** reject NULL date parses as well as unequal normalized
   dates, and add invalid-month cases. The 11 passing tests missed this boundary. Also
   finish the missing foundation evidence file before treating the README as fully verified.

What worked: clear separation of Save/Create/Start; task import preview; model/effort fields;
shared-route disclosure; direct Report/Output tabs; useful Runs grouping; browser reload
without execution interruption; retained keyboard focus across the asynchronous pause;
consistent dark Workbench styling and no overflow on inspected widths. Form made this
workflow easier to audit than Fit. The partial app has coherent local styling and honest
“next build step” placeholders, but visual polish is not functional acceptance.

Limitations: no successful baseline, full CRUD app, main multi-harness collaboration,
review/finalization, command node, task completion, repair branch or follow-up evidence.
No model substitutions or extra full trials. No Firefox/WebKit or broad accessibility audit.
No provider outage conclusion: the confirmed transport bug explains the failure pattern;
the live exception cause was discarded. No consolidated charge total. No Workflowz product
change, Git repository setup, commit, push, manual outcome, Resume or owner intervention.

Verification: Workflowz build/typecheck/lint pass. Final lint reports 6 warnings (5 style/unused-variable warnings in the generated app and 1 existing Workflowz CSS warning) and 142 infos; no app-source lint fixes were applied. 80 focused compiler/context/smoke tests pass. New evaluator JS helpers pass
Biome; Python helpers parse and partial verification executes successfully. The canonical
workflow has 18 nodes and zero warnings. Screenshots were visually inspected. All 62 relative Markdown links resolve, code fences balance, source task/input/checker checksums are unchanged, and `git diff --check` passes; runtime/sample caches stay ignored.


## Owner-authorized transport repair

After reviewing the trial result, the owner requested diagnosis and a product fix. This
is separate work after the original evaluation; the failure screenshots/events above remain
unchanged, and the original run remains paused with 0/3 tasks complete.

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

The historical [diagnostic](diagnose-wait.mjs) and its original timeout evidence are retained
from before the fix. Use the extended adapter test documented in
[the compatibility reference](../../archive/harness-compatibility.md#logs-and-verification-limits)
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
