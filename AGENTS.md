# AGENTS.md — Development guidance for Agent Workflow Runner

You are contributing to a **new local deterministic coding-agent workflow runner**. Read the following files in order before designing or writing code:

1. [`README.md`](README.md): overview.
2. [`spec.md`](spec.md): product behavior and acceptance criteria.
3. [`architecture.md`](architecture.md): contracts, state machine, persistence, and recovery.
4. [`todo.md`](todo.md): ordered implementation plan and completion criteria.
5. [`examples/overnight.yaml`](examples/overnight.yaml): end-to-end scenario the engine must be capable of expressing.

## Project philosophy

- **No supervisor LLM.** The runner follows a user-defined deterministic graph of steps, policies, and reported outcomes.
- **User chooses trust level.** Reviews, tests, commits, worktrees, and human approvals are workflow steps only if the workflow author specifies them. Never hardcode a quality gate or force manual approval for agents.
- **Reports are mandatory and strict.** Accept only declared step outcomes; never silently coerce an invalid outcome to success. Allow one additional correction turn after a *clean* execution without a valid report, then pause by default. Provider errors do not trigger this correction.
- **Single owner of state.** Agents submit reports through `wf`; they never edit the SQLite current-step/task cursor.
- **Sequential execution.** Do not start another operation until the previous operation has truly settled or its process tree has been terminated/reaped.
- **Avoid overengineering.** This is a personal tool. No microservices, Kubernetes, parallel worker pools, job queues, enterprise permissions, or large plugin frameworks.

## Engineering rules

- Implement features in the order of `todo.md`; choose the smallest runnable vertical slice. Keep each milestone verifiable through automated tests.
- Do not treat illustrative YAML or TS snippets as implemented API. First define strict typed contracts and validate the example before building runtime behavior.
- Avoid silently adding extra workflow behavior, report fields, hidden retries, or mandatory validation not in the specifications. Propose deviations explicitly.
- Keep workflow control logic pure/testable and isolated from subprocess/harness adapters.
- Use stable IDs for workflow steps, imported tasks, runs, and attempts. Persist changes transactionally. State mutations and events must agree.
- Use proper child-process supervision; timeouts/stop must account for process groups and reaping. Crash recovery must not replay uncertain side-effectful actions automatically.
- Never log attempt-scoped report tokens, provider credentials, environment secrets, or full auth files.
- No agent or API call is required for most tests. Build fake adapter fixtures first.
- Use current official and installed documentation for each harness (Codex, Pi, omp, OpenCode, Claude Code) when implementing adapters. Versions change. Feature-detect and record compatibility rather than guessing flags or requiring undocumented behavior.
- Permit the user to configure unrestricted harness permissions and arbitrary command steps; do not claim the tool provides isolation or rollback.
- Do not alter existing globally installed harness setups or global configs as a side effect of development. Use project-local deps and explicit fixtures.

## Documentation and change protocol

- Update `todo.md` checkboxes only when milestone acceptance criteria are demonstrably satisfied; include test command/results in the commit/PR description or log.
- Keep `spec.md` and `architecture.md` synchronized if implementing a design adjustment. Large architectural changes require a short documented rationale rather than speculative rewrite.
- Prefer concise module-level documentation that explains invariants and why unusual edge handling exists.
- Provide user-friendly failure messages for invalid definitions, invalid reports, unsupported adapters, and paused/uncertain runs.

## Definition of done for an individual feature

A feature is done when its observable contract is implemented, meaningful tests cover success and expected failure modes, no new nondeterministic control-flow behavior was introduced, typecheck/lint/tests pass, and pertinent documentation/example configuration is updated.

## First assignment

First establish project tooling and an executable test-driven core for contract/schema parsing and policy compilation (see [`todo.md`](todo.md) Phases 0–1). Do **not** start by building the visual editor.
