# AGENTS.md — UI overhaul

<!-- codebase-memory-mcp:start -->
For structural codebase exploration, use the installed `codebase-memory` skill.
<!-- codebase-memory-mcp:end -->

## Current assignment

Redesign Workflowz's frontend. The owner stopped the walkthrough because the interface was too
confusing to follow even with instructions. The direction is a substantial UI overhaul with
focused screens and clear navigation. Read `README.md`, then `DESIGN.md`.

There is no active `todo.md` or user-guide assignment. Old specifications, plans, walkthroughs
and milestone approvals are archived reference, not current assignments or authorization.
Use specific archived references only when a technical contract is relevant; do not require
reading the historical documentation set before design work.

## Design workflow

- Start with comparable visual/interactive proposals using realistic content. The owner needs help choosing a design; do not ask them to supply a finished design specification.
- Show distinct layouts and interaction approaches, then develop the chosen direction. Keep production implementation separate from clearly labeled prototypes.
- Use the focused screens and design prompt in `DESIGN.md`. Develop navigation, hierarchy and authoring interactions before selecting detailed styling.
- Preserve all existing workflow capabilities. Make ordinary tasks straightforward and keep advanced YAML, policies and diagnostic details accessible in appropriate views.
- Keep action feedback at the action and make created/selected objects apparent. Preserve input and focus through asynchronous updates and failures.
- Record the selected direction and material decisions in `DESIGN.md`. Keep guidance concise; avoid another large issue checklist or session transcript.
- Write the new user guide after the redesigned interface works. Do not resume the abandoned walkthrough unless the owner requests it.

## Technical boundaries

The proposed implementation direction is React + TypeScript for the frontend, served by the
existing local daemon. Decide the exact integration and project-local tooling after reviewing
the interaction direction. There is no authorization for an engine rewrite or speculative features.

- Follow the authored deterministic graph. No supervisor LLM or mandatory review/test/approval stages.
- Keep the coordinator as the sole canonical run/task state writer. State changes and their audit events remain transactional, with stable IDs and immutable historical records.
- Wait for process/group/stream settlement before starting another operation. Stop/timeout must supervise and reap owned processes.
- Strict reports accept only declared outcomes. At most one configured exact-session correction follows clean missing-report execution; original technical failures bypass correction.
- Never replay uncertain operations or signals automatically after a crash. Preserve explicit recovery decisions and separate resume.
- Keep creation, validation and saving distinct from execution. Preserve explicit Start/Resume, stale-state rejection and no automatic mutation retries.
- Preserve pairing, loopback Host/Origin checks, separate report/management/browser authority and CSP. Browser close/reload must not stop execution.
- User-authored arbitrary commands and unrestricted harnesses remain permitted. Make consequences understandable without inventing isolation, rollback or extra mandatory workflow gates.
- Do not edit global harness installations/configuration. Never expose credentials, report tokens, pairing codes or private runtime artifacts.

The [archived architecture](archive/architecture.md), [schema](archive/schema-v1.md), and
[product contract](archive/spec.md) preserve detailed runtime constraints. Verify current
source/tests for the area being changed; those documents include implementation history.

## Verification and scope

- Use existing fake adapters and disposable state. No paid provider execution is authorized for UI work. The owner's future walkthrough selection is OpenCode with `opencode/deepseek-v4.1-flash-free`; never substitute a paid model.
- Keep dependencies project-local. Use current official docs when selecting frontend tooling or changing version-sensitive integrations.
- Code changes require typecheck, lint and meaningful relevant tests. UI changes also require applicable offline browser checks and visual/keyboard/responsive verification. Do not weaken existing lifecycle/recovery checks to fit the UI.
- Documentation-only work requires link/example checks. Do not run live workflows merely to verify documentation.
- Explain any necessary behavior/API changes before implementing them, and update the relevant archived technical reference when its contract changes. Favor small complete frontend slices over a simultaneous rewrite of unrelated modules.
- Report what changed, what was checked, and remaining limitations. Do not treat old commit/push approvals as current authorization.
