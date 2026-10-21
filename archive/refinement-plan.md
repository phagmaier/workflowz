# Refinement plan — Agent Workflow Runner

> Archived for the UI-focused reset on 2026-10-20. This is reference/history, not the current work plan or agent instructions. Use [DESIGN.md](../DESIGN.md) and [AGENTS.md](../AGENTS.md) for active direction.

**Current milestone:** 3 — Design and prototype the replacement UI from the observed usability failures.
**Order:** Cleanup → initial walkthrough (stopped) → UI design → UI implementation → renewed walkthrough and guide.

This is the single active development checklist. The [completed MVP plan](history/mvp-plan.md)
and [implementation evidence](history/implementation-log.md) are historical reference.
The existing application is the baseline; this plan does not authorize speculative feature work,
performance optimization, an engine rewrite, or running paid providers.

Work on one milestone at a time. Check an item only when its observable result has been verified.
Record validation evidence with the completed work. Findings that do not fit the current milestone
go in the parking lot with a concrete user problem, not directly into implementation.

## 1. Repository and documentation cleanup

- [x] Archive the completed MVP roadmap, implementation log, previous README, guide and compatibility history; label historical instructions and approvals clearly.
- [x] Replace the README with a short introduction and documentation map; retain useful development commands separately.
- [x] Update agent guidance and reconcile stale status/design sketches in active technical references without changing runtime behavior.
- [x] Check local documentation links, whitespace, tooling and example validation; record results before marking this milestone complete.

**Done when:** Current guidance has an obvious entry point and next step; historical material is
accessible without being presented as current instructions; application code is unchanged.

**Completed 2026-10-20.** Archived five historical documents; retained current references,
examples, fixtures and tooling. Removed duplicated implementation narratives and stale assignments;
corrected the module/table descriptions and outdated status language. Application source, tests
and dependencies are unchanged; the overnight YAML edit changes only its introductory comment.

Validation: `npm run typecheck`, `npm run lint` (exit 0; existing informational diagnostics),
`npm run build`, and `node --test --test-reporter=spec dist/app/validate-cli.test.js` all passed.
The focused CLI suite passed **10 tests / 1 suite**, including all **6 examples with zero warnings**.
Local Markdown path/heading checks and `git diff --check` passed. The initial restricted test run
could not capture child output (`spawnSync` returned `EPERM`); the same existing tests passed with
subprocess capture allowed. No provider calls, credential reads or workflow execution occurred.
The full core and Chromium suites were not rerun for this documentation-only cleanup.

## 2. Initial walkthrough — stopped by the owner

**Stopped at the owner's explicit request on 2026-10-20.** The UI made even guided actions hard
to follow. Do not require the owner to finish this walkthrough before UI work.

The product explanation and command-only load/validate/create/start/inspect journey were completed.
Fresh installation, shutdown/recovery, agent execution and independent workflow authoring were not
completed. They are deferred, not checked off. The unfinished guide is preserved in
[the walkthrough archive](history/usability-walkthrough.md); observed problems now inform
[the UI design brief](../DESIGN.md).

The selected future live harness/model remains OpenCode with **DeepSeek V4.1 Flash Free**
(`opencode/deepseek-v4.1-flash-free`), free usage only. Its installed catalog entry is confirmed;
no live reporting or correction with that model was tested. Do not substitute a paid model.

## 3. UI design — active

Plan a substantial redesign of navigation, page structure, authoring and action feedback.
Use concrete screens and interactions to make choices reviewable. The current proposal is a
React frontend served by the existing daemon; production dependencies and routing remain to be
selected after the interaction direction is reviewed.

- [ ] Establish the design brief from observed failures, defining core journeys and acceptance criteria.
- [ ] Produce comparable interactive screen proposals with clear separation between authoring and run inspection.
- [ ] Review navigation, visual direction and the basic creation/run journey with the owner; revise the proposal.
- [ ] Settle empty/loading/error/invalid/running/paused/disconnected states, keyboard/focus behavior and responsive layouts.
- [ ] Finalize components, frontend integration approach and a small ordered implementation checklist.

**Done when:** The owner can understand the proposed flows from the prototype, a visual direction
is selected, and concrete implementation tasks and relevant checks are recorded. Changes to
observable product behavior beyond presentation must be identified explicitly in spec/architecture.

## 4. UI implementation

- [ ] Build the selected frontend shell and navigation, preserving pairing and same-origin authority boundaries.
- [ ] Implement workflow selection/creation and a focused editor with comprehensible fields and direct outcome routing controls.
- [ ] Implement ready/run detail screens with clear action feedback, readable step results and technical details on demand.
- [ ] Carry paused edits/intervention and advanced YAML/policy controls into appropriate focused views without losing existing capability.
- [ ] Preserve unsaved input, stale-control handling, explicit Start/Resume and browser-independent execution; verify with relevant offline/browser coverage.
- [ ] Keep spec, architecture and developer commands aligned with the implementation.

**Done when:** The selected journeys work in the real application, required typecheck/lint/tests
and applicable browser/visual checks pass, and the owner can follow the UI. Preserve deterministic
routing, engine-owned state, sequential settlement, strict reports and explicit recovery.

## 5. Renewed walkthrough and user guide

- [ ] Repeat the basic journey against the new interface and resolve remaining observed confusion.
- [ ] Verify fresh installation, startup, pairing, normal controls and shutdown.
- [ ] Set up the chosen free agent workflow and create a reusable workflow with optional task iteration.
- [ ] Cover blocked work, revisions, recovery and clearly explained remaining limitations.
- [ ] Write a fresh `docs/user-guide.md` from the improved experience, with useful examples and screenshots.
- [ ] Have the owner, and another developer if available, complete the basic journey using the published guidance.

**Done when:** A newcomer can install, create, run, inspect and appropriately intervene using the
interface and guide. Keep unfinished tasks visible; do not present the interrupted draft as complete.

## Findings and scope

The observed navigation, feedback, authoring and history failures are maintained in
[docs/ui-design.md](../DESIGN.md), which is the current design source of truth.
Performance optimization, an engine rewrite and speculative product additions remain deferred.
