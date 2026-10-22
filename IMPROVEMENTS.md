# Workflowz improvement backlog

**Checkpoint — 2026-10-22:** the Workbench, owner walkthrough and realistic five-harness trial
are complete. We are improving the existing product from those findings. Cleanup removed
the disposable lending app, old live-run setup scripts and rejected prototype assets.
The useful reports/evidence live under [docs/evaluations/](docs/README.md#evaluations).
No new product-improvement slice has started.

This is the single active backlog. Select work using the current user request, then update
its row with status, implementation and verification. Suggested solutions below are inputs
for a small design/implementation slice, not blanket approval for every feature.

## Next improvements

| ID | Priority / status | Observed problem | Direction and completion evidence |
| --- | --- | --- | --- |
| OWNER-1 | High · open | The owner struggled to find the completed run's graph/map again. | Make Finished → run → Map/results obvious; verify with the owner and keyboard. The agent later finding Map does not resolve owner discoverability. |
| F5 | High · open | A transport/process failure was presented as an agent report/provider failure. | Distinguish technical failure from declared outcome and show the safe cause near the main heading. Check the repaired bridge's diagnostics end to end. |
| F6 | High · open | Passing API/page checks missed browser CRUD that continually erased input. | Provide a verified browser acceptance recipe and clear verification limits in authored workflows. Preserve deterministic routing and author choice; no mandatory engine gate. |
| F3 | Medium · open | Long steps show little activity; 3/3 tasks appeared while integration/audit still remained. | Show current phase and useful attempt/activity timing separately from task totals and paused elapsed time. Do not imply unsupported live output. |
| F2 | Medium · open | Fit shrank an 18-node graph to unreadable 35%; Form was easier to inspect. | Explore readable selected-path/node focus or collapsed repair sections, keeping every route inspectable. Test the proposed interaction. |
| F1 | Medium · open | Checker showed an array/string schema error instead of “Close the double quote”. | Carry the useful command-parser message into the checker, suppress duplicate noise and preserve Fix focus. |
| UX-1 | Low · open | “Foundation runs again” feedback stayed visible during later tasks. | Use past tense or clear transient feedback when execution advances. |
| UX-2 | Low · open | The large Pause/Stop panel pushes history and results down. | Explore compact normal-running controls with Stop still distinct and accessible. |

Sources: [owner walkthrough feedback](docs/evaluations/owner-walkthrough.md#owner-feedback),
[full trial findings](docs/evaluations/equipment-lending/EVALUATION.md#findings),
[prioritized critique](docs/evaluations/equipment-lending/EVALUATION.md#prioritized-recommendations-and-limits).

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
