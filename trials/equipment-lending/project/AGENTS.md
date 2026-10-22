# Equipment lending sample — agent instructions

## Assignment and boundaries

This directory is a standalone sample project for a Workflowz trial. Your assignment is
the current workflow step/task and [SPEC.md](SPEC.md), not the parent repository's UI
overhaul. Read the specification before implementation. Build only what this project
needs; do not implement the later maintenance-state change yet.

Work only inside this project directory. Do not edit Workflowz, other trials, global
harness configuration, user skills or account settings. Do not initialize a repository,
commit, push, deploy or create external resources. Harness tool permissions are not
filesystem isolation; honor this scope explicitly. Use fictional data only.

## Collaboration

Multiple harnesses work sequentially on this shared project. Read the current files and
handoff before changing them. Preserve working features and other agents' changes.
Prefer focused changes to replacement implementations. Report interface/command changes
clearly so the next harness can use the result.

Use Python standard library, SQLite and local HTML/CSS/JavaScript. No package installation
or network dependency is needed. Keep command contracts in SPEC.md stable. Do not remove
or weaken tests simply to obtain a passing command. Tests should establish behavior,
including conflicts and persistence, rather than just repeat implementation details.

## Autonomous decisions

Choose ordinary implementation details yourself. Do not ask the owner design questions
or add approval stages. Missing optional visual preferences are not blockers. If genuinely
unable to proceed, report the declared blocked outcome with the exact reason and evidence;
do not invent functionality or silently change scope, harness or model.

Do not spawn nested coding agents or delegate to other models. Workflowz's authored
steps provide the harness collaboration being evaluated. Do not issue Start, Resume,
manual outcome, task override or management commands. Do not edit the source checklist
to advance execution: Workflowz imports it and owns task completion state.

## Checks and artifacts

Run checks relevant to your changes against temporary databases. Never erase the demo
database to make a test pass. Manage any test server you launch and stop/reap it before
ending your step. Do not leave background work running or assume the next step will clean
it up. Keep public verification notes under `artifacts/`, with commands, actual outcomes
and limitations. Do not copy private harness logs or credentials there.

The evaluator will independently test the finished app. Distinguish tests you executed
from suggested tests and observations you could not make. Keep the launch/test/report
instructions current in the generated README.

## Workflow reporting

Use the invocation's injected reporting instructions and `wf report` interface. Submit
exactly one valid declared outcome with a concise summary, checks performed, known issues
and useful handoff. Confirm the report was acknowledged; ordinary final text is not a
Workflowz report. A report does not excuse leaving a process running.

Use only the current step's declared outcome names. Do not invent `system.*` outcomes or
claim a successful check that failed. Never print or persist authorization tokens, pairing
codes, private runtime artifacts or account configuration. End the invocation after
reporting and settling owned work.
