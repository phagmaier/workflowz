# Autonomous equipment lending trial

## Status and authorization

Execution authorized by the owner's continuation handoff on 2026-10-22. All five live
preflight checks passed with exact requested selectors and acknowledged reports. The
18-node workflow validates. The baseline paused at Foundation after 5m03s on a bridge
protocol error; offline diagnosis reproduced a 300-second HTTP header timeout. No manual
replay or product fix was applied; the full app and follow-up remain unexecuted. Preparation-only wording
below describes the original sequence; it is not a new approval requirement.
See [EVALUATION.md](EVALUATION.md) for actual execution status and explicit limitations.

The owner approved the equipment lending domain, ordinary autonomous execution, all five
harnesses below, and a follow-up revision. No Git/GitHub exercise, human decision nodes,
deliberate crash, stop/resume scenario or Workflowz product changes are included.
Starting and inspecting the workflow are evaluator actions; the owner should not have
to answer questions or fix project files during execution.

## Goals

1. Produce a useful local CRUD application through Workflowz, rather than implementing
   it directly in the evaluator's terminal.
2. Give every selected harness meaningful work with explicit handoffs and acceptance evidence.
3. Exercise the available autonomous workflow mechanics without pretending to cover
   every feature or inventing features the runner does not have.
4. Assess the whole authoring-to-results experience and deliver actionable critiques.
5. Make a small subsequent change through a new run to evaluate continued use.

This is a collaboration and product experience trial, not a model quality benchmark:
different harnesses have different assignments, and all see an evolving shared project.

## Project and implementation envelope

Use [project/SPEC.md](project/SPEC.md), [project/AGENTS.md](project/AGENTS.md) and
[project/TASKS.md](project/TASKS.md) as the agent inputs. The sample is a workshop equipment
lending app, using Python's standard library, SQLite and ordinary HTML/CSS/JavaScript.
It needs no package downloads, cloud services, authentication, paid application services
or frontend build tool. The UI still needs to be usable, visually coherent and responsive.
This stack keeps the trial focused on Workflowz and agent collaboration.

Generated source, tests, seed fixtures and public project reports belong under `project/`.
Use a fresh private Workflowz state directory under `/tmp` for this trial; do not attach
to or stop an existing owner daemon. This is organizational separation, not filesystem
isolation: the harnesses execute with the user's access. Preserve artifacts until evaluated.
Never put credentials, pairing codes, report tokens, raw private harness transcripts or
daemon discovery data in this repository or findings.

## Harness assignments

| Harness | Owner's model selection | Thinking selection | Meaningful assignment |
| --- | --- | --- | --- |
| OpenCode | `opencode/deepseek-v4.1-flash-free` | Omit effort; harness default | Foundation, runnable skeleton, database setup, seed and command contracts |
| Codex | GPT-6-luna | Lowest supported by this model/harness | Implement each task; continue the same session after review to finalize or repair |
| Claude | Haiku 5.5 | Lowest supported by this model/harness | Review each completed slice against criteria and record specific issues |
| OMP | GPT-6-luna | Lowest supported by this model/harness | Integrate the complete app, run cross-feature checks, fix integration defects |
| Pi | GPT-6-luna | Lowest supported by this model/harness | Independently exercise persistence, business rules and command/report behavior; add useful missing regression coverage |

Pi was explicitly included by the owner. All five executables were found on the evaluator's
PATH during preparation; this establishes neither usable adapter capability nor authentication.
Except for the explicitly supplied OpenCode selector, the table gives requested model
names, not verified CLI/API identifiers. Do not assume `low` is the lowest supported value,
and do not substitute a different model. Check model and effort together for each harness.
An unavailable model or harness is a preflight blocker, not permission to omit it.

## Preparation preflight, before live execution

1. Confirm the project inputs and application scope. Check executable versions and
   effective adapter capabilities using the existing offline probe tooling. Check the
   actual daemon environment, not merely the evaluator's shell. Keep global harness
   installations and configuration unchanged.
2. Resolve exact model IDs and lowest supported effort selections from current official
   documentation and supported local catalog/settings inspection. Use Context7 first for
   library/CLI documentation; use official documentation if it has no coverage. Check
   credential availability without displaying credentials or private configuration.
   Existing accounts/settings should remain usable; do not blindly replace their homes
   with empty directories that remove authentication.
3. Confirm browser automation can operate the actual Workbench, including file import,
   pairing, screenshots and keyboard interaction. Use existing installed browser tooling.
   If unavailable, record that limitation before proceeding; terminal-only execution
   cannot establish that the UI experience was evaluated.
4. Author `workflow.yaml`, prompt files and any small evaluator-owned bounded-check
   helpers in this trial directory. Keep all file references within the sample project
   where the schema requires project-relative paths. Resolve paths and use the current
   parser/compiler and path checker. Do not save a revision or create a run yet.
5. Review the actual graph, outcomes, terminal failure path and numerical limits against
   the design below. Check the expected number of transitions, task bodies and report
   references. All three unchecked checklist entries should be imported in order.

After execution is authorized, first do one minimal provider-backed reporting/tool check
per selected harness through the existing adapters, with the exact intended model/effort.
Use disposable project/state and explicit reporting acknowledgement. This checks launch,
model entitlement, a harmless command and reporting; an offline probe cannot prove these.
Record these calls separately from the application trial. Stop before the main run if
any selection cannot work without account setup or substitution. Do not quietly spend
several full runs discovering a broken provider setup.

## Planned deterministic workflow

Workflowz currently executes **one step at a time**; do not plan parallel agents. These
are proposed node names and behavior, not a saved or validated workflow yet.

| Stage | Behavior and routing |
| --- | --- |
| `foundation` | OpenCode, fresh session. Read the brief; create the runnable skeleton, command interface, schema and seed. Report `complete` to foundation checks or `blocked` to unsuccessful finish. |
| `foundation_check` | Command verifies the skeleton's documented startup, seed and test commands. Success goes to task selection; failure goes to one OpenCode same-session foundation repair and one recheck, then unsuccessful finish on another failure. |
| `pick_task` | `task.next`: `task_ready` goes to implementation; `exhausted` goes to integration. |
| `implement` | Codex, fresh for each active task. Implement `{{task.text}}` and its full imported body. Report `complete` to review or `blocked` to unsuccessful finish. |
| `review` | Claude, fresh. Inspect implementation, run relevant checks, report `approved` or `changes`, with explicit evidence and handoff. Approved goes to finalization; changes goes to repair. |
| `finalize` / `repair` | Codex, `session: resume`, same run/task/revision. Include the review report. Finalize documentation/evidence after approval, or address review findings after changes. Both lead to slice checks; `blocked` leads to unsuccessful finish. |
| `slice_check` | Command runs the stable offline test entry point. Success marks the task done. Failure goes to one Codex resumed correction, then a distinct recheck; another failure ends unsuccessfully. |
| `mark_done` | `task.complete`, then return to `pick_task`. The original checklist stays unchanged. |
| `integrate` | OMP, fresh after task exhaustion. Exercise the complete system; fix integration defects, run checks, record handoff. `complete` goes to Pi; `blocked` ends unsuccessfully. |
| `audit` | Pi, fresh. Independently check app behavior and persistence, strengthen meaningful tests where needed, and verify seed/report commands. `complete` goes to final commands; `blocked` ends unsuccessfully. |
| `acceptance` | Commands run all tests, seed a dedicated demo database, and generate/validate a deterministic inventory and overdue-loan report. Failure ends unsuccessfully; success leads to the successful finish. |
| terminal nodes | Separate `end` nodes labelled successful and unsuccessful. Ending at an unsuccessful node may still yield Workflowz's `completed` run status; evaluation must inspect the path and artifacts. |

An authored graph can handle ordinary correction without owner decisions. A technical
failure, process uncertainty or exhausted engine limit may still pause by design. Do
not bypass recovery rules or manually resume simply to make this trial appear autonomous.
Record an unexpected intervention requirement as a finding and stop dependent work.

Use prompt files, ordered project instructions, an extra review instruction file, tags,
explicit report context and command environment overrides where they serve these tasks.
For example, commands should receive an explicit demo database path and fixed report date.
Use shared tagged rules for routine command failure destinations and a specific rule
where the slice correction path overrides that shared rule. Verify inherited routes in
the checker. Never route a technical failure through a normal success outcome.

The baseline deliberately avoids speculative same-step retries of mutating work. Goto
repair paths and task iteration already exercise loops. A bounded `retry` with backoff
can be added to a genuinely repeatable, read-only readiness check if warranted by the
implementation. Do not manufacture failures to claim retry coverage.

## Feature coverage and limits of the trial

| Capability | Planned exercise | Evidence required |
| --- | --- | --- |
| File import, Graph/Form/YAML, Project, checker, Rules & limits | Inspect and author through the UI, including one reversible draft edit and checker repair before saving | Screenshots, observations and final validated text |
| Immutable revision, create versus Start | Save explicitly; inspect the ready run before Start | Revision/run IDs and visible states, without private access data |
| Commands, environment, cwd, output | Tests, dedicated database, seed and deterministic report | Exit results and visible saved Output |
| All five agent harnesses | Assignments above | Settled invocations with requested selections and acknowledged reports |
| Task import and task loop | Three checklist slices | Imported bodies, ordered tasks, completion counts; unchanged source checklist |
| Declared branching and report handoffs | Claude review, normal blocked results, explicit report context | Actual outcomes and content; untraversed edges marked unobserved |
| Exact session continuation | Codex finalize/repair in each task | Same-session evidence scoped to task/run/revision |
| Shared policies and overrides | Tagged command rules and specific correction route | Checker resolution and actual routing when traversed |
| Report correction, retries, failure limits | Configure one report correction; use bounds below | Record as configured unless naturally exercised; no deliberate failure injection |
| History, reports, output, run map and status groups | Observe during execution and after completion; navigate away and back | Discoverability, selection/focus behavior, understandable state and path |
| Browser reload while running | Once, after saving, with no active mutation request | Execution continues and the same run can be found again |
| Continued work | Separate maintenance-state change after baseline evaluation | New revision/run and preserved baseline history |

Manual decisions, paused-run editing, crash recovery, task overrides requiring intervention,
provider outage simulation, desktop packaging, broad security testing and live streaming
are outside this baseline. Output is saved capture after settlement, not a live stream.
For every feature, distinguish **planned**, **configured**, **observed**, **failed** and
**not exercised**. Successful configuration alone is not runtime evidence.

## Resource limits

- Main run: 4 hours wall time; 180 step executions, including task-control transitions.
- Agent step: 25 minutes. Command step: 3 minutes by default, with a documented longer
  bound only where needed. Leave agent silence timeout unset: silent useful work should
  not be mistaken for failure, especially with OpenCode's transport.
- Foundation: at most one explicit repair and recheck. Each task: implementation, one
  review-driven finalization/repair, and at most one additional command-failure repair.
  Integration and audit get one substantive invocation each. Report-only correction is
  enabled once, as supported by the engine; it is not an implementation repair.
- Follow-up run: 90 minutes and 60 transitions, with the same per-step limits and bounded
  correction approach. Provider checks: one small call per harness unless a diagnosed,
  resolved issue justifies another.

These are ceilings, not a target duration. Expect roughly 12–18 substantive agent calls
in the baseline, plus five small preflight calls; repair paths add a few more. No repeated
full runs or workload expansion merely to spend the remaining budget. There is no
Workflowz monetary-budget field in the current schema, and account pricing/usage meters
may not be available. Do not invent a dollar guarantee. Record actual available usage
and cost separately from wall time, and label unknown charges as unknown. Requested
models stay fixed; no paid upgrade or fallback model.

## Conducting and evaluating the run

Use the Workbench for import, inspection, editing, save, creation, Start and results.
Use terminal access for documented daemon startup, preflight, sample-app checks and
diagnosis where needed. Record any internal API or source-level workaround as friction;
do not silently use it as evidence that the browser flow worked.

Take concise observations as events occur, with elapsed time, visible state, intended
action, outcome and a screenshot where useful. Avoid constant polling that disrupts
the experience. Check whether historical selection stays pinned, progress is intelligible,
command output is findable, and the completed execution path remains discoverable.
Include keyboard navigation and desktop/tablet/phone inspection of relevant screens.
Do not claim untouched screens or all browser engines were verified.

After settlement, run the generated application's tests and independently exercise
equipment/borrower CRUD, checkout conflicts, return/recheckout, search/filters, overdue
boundaries, restart persistence and sample-report correctness. Capture useful evidence
without putting private logs in findings. An agent's assertion that tests passed is not
independent verification. Preserve the baseline before the follow-up.

The follow-up adds an equipment maintenance state: unavailable items cannot be lent,
existing loans remain returnable, and availability/search/reporting reflect the state.
Write that delta only after baseline evaluation, then use a new saved workflow revision
and run. It must not sneak into baseline scope. Reuse the existing project and exclude
the original three tasks from re-import explicitly; their source checkboxes remain
unchecked even after the original run.

## Findings and deliverables

Populate [EVALUATION.md](EVALUATION.md) with:

- Actual run outcomes, app acceptance results, harness participation, timing and available usage.
- Feature coverage with observed evidence and explicit omissions.
- UX friction, confusing terminology, unnecessary steps, editing effort, visual hierarchy,
  responsive behavior, keyboard/focus issues, progress visibility and error usefulness.
- Concrete bugs, reproduction steps, screenshots and expected versus actual behavior.
- Suggestions prioritized by impact/frequency, distinguishing observed needs from speculation.
- Attribution confidence: Workflowz, harness/provider, workflow authoring, generated app,
  evaluator/environment, or unresolved. More than one can contribute.

Do not fix Workflowz during the trial. If blocked, preserve the evidence and explain
the smallest proposed remedy; product changes are a separate task. Unexpected failures
are valid results. Never fabricate a passing run, completion receipt or observation.
