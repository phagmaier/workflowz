# Equipment lending trial

A realistic, autonomous Workflowz evaluation. **The owner authorized continuation after the transport fix; Foundation is running again.**
OpenCode produced a runnable foundation. The evaluator did not implement or repair it.

- [PLAN.md](PLAN.md): agreed scope, workflow design, preflight, limits and evaluation.
- [EVALUATION.md](EVALUATION.md): actual results, independent partial verification,
  feature coverage and prioritized findings.
- [project/SPEC.md](project/SPEC.md): sample application's requirements and acceptance criteria.
- [project/AGENTS.md](project/AGENTS.md): instructions for agents building the sample.
- [project/TASKS.md](project/TASKS.md): three implementation tasks for Workflowz to import.

The project directory is `/home/phagmaier/Code/workflowz/trials/equipment-lending/project`.
It has no separate Git repository, remote or deployment target. Workflowz source stays
outside the sample project's scope. No Git commands are part of this exercise.

Execution was authorized by the continuation handoff (2026-10-22).
All five minimal live tool/report preflights passed. [workflow.yaml](workflow.yaml) validates
with 18 nodes and no warnings. Revision 1 was saved, the ready run inspected, then explicitly
started through the Workbench. At 5m03s the bridge emitted a protocol error and the run paused.
An [offline diagnostic](evidence/wait-diagnostic.json) reproduced a 300-second HTTP header
timeout in the unmodified bridge. No model substitution, manual outcome, Resume or product
fix was applied. All three tasks remain pending; the other four harnesses only ran preflight.

The owner subsequently authorized a separate transport repair. The bridge has been changed
and passed all 866 standard tests plus an actual 310-second offline wait; see the [repair record](EVALUATION.md#owner-authorized-transport-repair). The original run has not been resumed or rerun.

The partial app's 11 tests pass independently. Seed/report/database agreement, restart
persistence and storage conflict/deletion checks passed; CRUD is absent and an invalid-month
storage gap was found. [Independent results](evidence/independent-partial.json) are explicitly
partial evidence. The follow-up was not attempted against this unaccepted baseline.

Private daemon state is preserved at `/tmp/workflowz-equipment-trial-cdyf0bhm/state`.
Public screenshots and sanitized preflight results are in [evidence/](evidence/).
The evaluator [browser driver](browser-driver.mjs) uses actual UI controls and keeps pairing
codes/cookies in memory. No Git/GitHub setup or Workflowz product edits are part of this trial.

The daemon remains available for inspection; execution is paused. From the repository root,
`bin/wf --state-dir /tmp/workflowz-equipment-trial-cdyf0bhm/state ui` issues fresh browser access.
The run is `run_9ae79946-41f0-4b67-a8ab-1a83d516d6f2`, revision 1. Do not treat inspection as
authorization to rerun or apply a manual result. Sample/diagnostic servers and evaluator
Chromium are stopped after verification; private state and the original partial snapshot
are preserved under the same `/tmp/workflowz-equipment-trial-cdyf0bhm` directory.

This is a new exercise, independent of the older [owner walkthrough](../../walkthrough/README.md).
The [Workbench guide](../../USER_GUIDE.md) describes the current interface.

The latest owner instruction explicitly authorized restart/continuation. The evaluator
continued the same run through the Workbench, recording the reason and retaining the
failed attempt. See the evaluation's continuation section for current results; earlier
paused-status paragraphs describe the original failure and repair checkpoint.
