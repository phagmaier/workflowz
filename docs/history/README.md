# Documentation archive

Historical records only. Current work is tracked in [IMPROVEMENTS.md](../../IMPROVEMENTS.md).
The [Workbench implementation history](workbench-implementation-2026-10-22.md) records the
completed redesign; [evaluations](../README.md#evaluations) record subsequent real use.


> Archived for the UI-focused reset on 2026-10-20. This is reference/history, not the current work plan or agent instructions. Use [DESIGN.md](../DESIGN.md) and [AGENTS.md](../../AGENTS.md) for active direction.

This directory contains material retired during the UI reset on **2026-10-20** and the
Workbench implementation cleanup on **2026-10-21**. It retains technical evidence and prior
operating details for reference during UI implementation and later guide development.

Historical instructions, approval statements and incomplete-milestone notes describe their
original session. They are not current assignments or authorization to execute, commit or push.
Commands and UI descriptions may become outdated. Use the [current README](../../README.md),
[active plan](../DESIGN.md), [spec](../reference/spec.md) and [architecture](../reference/architecture.md)
for current direction and contracts.

| File | Why retained |
| --- | --- |
| [Previous README](mvp-readme.md) | Previous entry point and detailed CLI/service examples; useful during the walkthrough |
| [Completed MVP plan](mvp-plan.md) | Original phases, acceptance criteria and milestone evidence |
| [Implementation log](implementation-log.md) | Detailed verification, recovery/process limits and post-MVP repair evidence |
| [Interrupted usability walkthrough](usability-walkthrough.md) | Verified initial steps and findings; the owner stopped before agent execution because the UI blocked learning |
| [Previous user guide](user-guide.md) | Operating details to check while writing the replacement from real use |
| [Harness compatibility history](harness-compatibility.md) | Versioned sources, earlier failures and scoped live-report/session evidence |
| [Previous React user guide](react-user-guide-2026-10-21.md) | The rejected React interface; superseded by the Workbench redesign |
| [Demo feedback](demo-feedback-2026-10-21.md) | Research already incorporated into current design decisions |
| [Previous design brief](design-brief-2026-10-21.md) | Earlier implementation slices and acceptance history, superseded by Workbench |

Bodies were preserved apart from archive notices and relative-link repairs. Duplicated history
was removed from active entry points. Application source, tests, fixtures, dependencies and
runtime state were outside this cleanup.

The last recorded code verification before this cleanup was **826 tests / 91 suites** and
**3 Chromium scenarios**, in the [post-MVP repair record](implementation-log.md#correctnesssecurity-repairs-after-the-final-mvp-gate).
These are historical results, not tests rerun by archiving documents.
