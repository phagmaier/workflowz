# AGENTS.md — Workflowz

<!-- codebase-memory-mcp:start -->
For structural codebase exploration, use the installed `codebase-memory` skill.
<!-- codebase-memory-mcp:end -->

## Current work

Refine the existing Workflowz Workbench using the owner's real-use feedback and the completed
multi-harness evaluation. Read `README.md`, then `IMPROVEMENTS.md`. Follow the current user
request to choose the next slice; the backlog is not an instruction to implement everything.
The completed sample app and one-off live exercise scaffolding were deliberately removed.

Documentation roles:

- `IMPROVEMENTS.md`: single active backlog, finding status and current checkpoint.
- `docs/DESIGN.md`: approved behavior and design decisions; consult for the selected UI slice.
- `docs/USER_GUIDE.md`: implemented user-facing operation; update when behavior changes.
- `docs/reference/`: runtime/schema/adapter contracts and development checks; verify against current source/tests.
- `docs/evaluations/` and `docs/history/`: evidence and historical decisions, not current assignments or reusable authorization.

## Working loop

1. Identify the selected finding and reproduce the current behavior with existing offline
   fixtures or a bounded local check. Separate observed defects from proposed remedies.
2. Implement one complete small slice. Make ordinary implementation decisions within the
   request; explain necessary behavior/API changes before implementing them.
3. Add a meaningful regression for a bug fix and run the checks appropriate to the change.
   Preserve input/focus and keep feedback beside the action that caused it.
4. Update the finding in IMPROVEMENTS.md with status, the actual change and verification.
   Update `docs/DESIGN.md` for behavior/decision changes and `docs/USER_GUIDE.md` for operating changes.
5. Report the result, checks and remaining limits. Keep one active backlog; avoid new root
   plans, handoffs, status files or session transcripts for routine work.

Use existing fake adapters and private disposable state for product work. UI changes need
applicable offline browser, visual, keyboard and responsive checks, alongside typecheck,
lint and meaningful tests. Documentation-only changes need link/example checks, not live
workflows. Consult `docs/reference/development.md` and package.json for commands.
Past provider trials do not authorize new live calls; retain the owner's exact requested
models if a new evaluation is requested. Clean up owned temporary resources after settlement.

## Product and runtime boundaries

Continue React + TypeScript/Vite through the existing daemon. Preserve the approved
Workbench direction and existing workflow capabilities. Desktop packaging/service lifecycle
remain deferred. There is no authorization for an engine rewrite or speculative features.

- Follow the authored deterministic graph. No supervisor LLM or mandatory review/test/approval stages.
- Keep the coordinator the sole canonical run/task state writer. State changes and audit events remain transactional, with stable IDs and immutable history.
- Wait for process/group/stream settlement before the next operation. Stop/timeout supervise and reap owned processes.
- Strict reports accept only declared outcomes. At most one configured exact-session correction follows clean missing-report execution; original technical failures bypass correction.
- Never automatically replay uncertain operations or signals after a crash. Preserve explicit recovery decisions and separate Resume.
- Keep creation, validation and saving separate from execution. Preserve explicit Start/Resume, stale-state rejection and no automatic mutation retries.
- Preserve pairing, loopback Host/Origin checks, separate report/management/browser authority and CSP. Browser close/reload must not stop execution.
- Arbitrary commands and unrestricted harnesses remain permitted. Explain consequences without inventing isolation, rollback or extra mandatory gates.
- Keep dependencies project-local; preserve global harness installations/configuration. Never expose credentials, report tokens, pairing codes or private runtime artifacts.

Use current official documentation for version-sensitive integrations. Update the affected
technical reference if a contract changes. Preserve lifecycle/recovery tests; do not weaken
them to fit a UI change. Treat old commit/push approvals as historical, not current task scope.
