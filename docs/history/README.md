# Documentation archive

Historical records only. Current work is tracked in [IMPROVEMENTS.md](../../IMPROVEMENTS.md).
The [Workbench implementation history](workbench-implementation-2026-10-22.md) records the
completed redesign; [evaluations](../README.md#evaluations) record subsequent real use.
This directory contains retired MVP plans, superseded interfaces and completed Workbench
implementation records. Read a record when it explains a specific decision or finding;
the current [user guide](../USER_GUIDE.md) describes the implemented interface.

Historical instructions, approval statements and incomplete-milestone notes describe their
original session. They are not current assignments or authorization to execute, commit or push.
Commands and UI descriptions may become outdated. Use the [current README](../../README.md),
[approved design](../DESIGN.md), [spec](../reference/spec.md) and [architecture](../reference/architecture.md)
for current direction and contracts.

| File | Why retained |
| --- | --- |
| [Previous README](mvp-readme.md) | Previous entry point and historical CLI/service examples |
| [Completed MVP plan](mvp-plan.md) | Original phases, acceptance criteria and milestone evidence |
| [Implementation log](implementation-log.md) | Detailed verification, recovery/process limits and post-MVP repair evidence |
| [Interrupted usability walkthrough](usability-walkthrough.md) | Verified initial steps and findings; the owner stopped before agent execution because the UI blocked learning |
| [Previous user guide](user-guide.md) | Historical operating details, superseded by the current Workbench guide |
| [Harness compatibility history](harness-compatibility.md) | Versioned sources, earlier failures and scoped live-report/session evidence |
| [Previous React user guide](react-user-guide-2026-10-21.md) | The rejected React interface; superseded by the Workbench redesign |
| [Demo feedback](demo-feedback-2026-10-21.md) | Research already incorporated into current design decisions |
| [Previous design brief](design-brief-2026-10-21.md) | Earlier implementation slices and acceptance history, superseded by Workbench |
| [Refinement plan](refinement-plan.md) | Completed pre-Workbench refinement plan; not the active backlog |
| [Workbench implementation](workbench-implementation-2026-10-22.md) | Completed Workbench slices and their checkpoint verification |

Bodies were preserved apart from archive notices and relative-link repairs. Duplicated history
was removed from active entry points. Application source, tests, fixtures, dependencies and
runtime state were outside this cleanup.

The earlier post-MVP checkpoint recorded **826 tests / 91 suites** and **3 Chromium scenarios**
in the [repair record](implementation-log.md#correctnesssecurity-repairs-after-the-final-mvp-gate).
Later Workbench and evaluation records contain their own results. None of those historical
counts substitutes for running the checks appropriate to a new change.
