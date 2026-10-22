# Walkthrough preparation verification

Prepared on 2026-10-21 (America/Los_Angeles), from `main` at `18f5165`; owner walkthrough
completed on 2026-10-22 (America/Los_Angeles). Application/runtime behavior was not changed.

## Prepared lab (used and cleaned)

The prepared lab was **`/tmp/workflowz-owner-EO96br`**:

- Import file: `/tmp/workflowz-owner-EO96br/workflow.yaml`
- Workflow folder: `/tmp/workflowz-owner-EO96br`
- Project folder: `/tmp/workflowz-owner-EO96br/project`
- Workflowz state: `/tmp/workflowz-owner-EO96br/state`
- OpenCode configuration: `/tmp/workflowz-owner-EO96br/opencode/config/opencode.json`

Before execution, its greeting was the baseline, `receipt.txt` was absent, and Workflowz state
was empty. After the successful walkthrough, the daemon was stopped and the marked lab directory
was removed. No daemon or disposable state remains. The lab/state directories were `0700`;
configuration and environment files were `0600`.
OpenCode's offline catalog check initialized only disposable OpenCode data.

For another walkthrough, create a fresh lab using
[runbook section 1](README.md#1-prepare-isolated-resources--no-provider), then rerun preflight.
Do not reuse the removed path. `/tmp` may be cleared by reboot or system cleanup. Use the
runbook's Stop and cleanup instructions when finished.

## Checks completed

- Build and typecheck pass. Full lint passes with the pre-existing CSS warning and
  informational diagnostics; changed JavaScript/config files pass with no diagnostics.
- **857 standard tests pass** (99 suites, no failures/skips).
- **59 offline Chromium tests pass**, including the new exact-artifact rehearsal.
  A focused screenshot run also passes; ready/paused desktop and paused/completed phone
  screenshots were inspected. Keyboard Apply/Resume and no-page-overflow checks pass at
  1280 and 390 px. Screenshots are at `/tmp/workflowz-owner-shots/` (synthetic data only).
- Workflow validation passes with five steps and exactly two expected `unreachable_step`
  warnings (`finish`, `done`), reflecting the owner's manual continuation.
- The preparation script and all eight runbook shell examples pass shell syntax checks.
  Both Node helpers parse. Disposable command checks cover baseline, changed contents,
  receipt creation and refusal to create a second receipt.
- Native CLI checks pass for a separate foreground daemon: start, status, empty run list,
  issuing browser access and graceful shutdown. No run was started. Its discovery/listener
  and temporary project/state were removed after shutdown.
- `preflight.mjs` accepts installed **OpenCode `v2.0.32`** at
  `/home/phagmaier/.opencode/bin/opencode`, with private API and model selection supported.
  `opencode models --standalone`, with fresh credential-free state and catalog refresh
  disabled, lists **`opencode/deepseek-v4.1-flash-free`**. The reviewed v2 configuration
  parses under that installed binary. A changed config is rejected before harness checks,
  without echoing the changed contents.
- All 28 local documentation links/anchors, nine shell blocks across the two walkthrough
  documents and `git diff --check` pass. Official model/config/agent
  references were fetched without inference; their links are in the [runbook](README.md).

The [offline browser rehearsal](../test/browser/owner-walkthrough.spec.mjs) uses the exact
workflow and project, real command execution and a scripted adapter that makes the one-line
edit and reports `complete`. It is not evidence of OpenCode provider/tool compatibility.

## Live walkthrough results

On 2026-10-22 the owner completed **Called Owner walkthrough**, run
`run_1bf09cc4-1138-4559-8b41-55c9c85ce7ad`, revision 1, using exactly OpenCode and
`opencode/deepseek-v4.1-flash-free`.

- Start reached the expected checkpoint pause after `baseline`, `edit_greeting` and
  `checkpoint`. The OpenCode attempt produced an accepted report and the run completed its
  expected route.
- After Apply selected `finish`, the run remained paused and `receipt.txt` was still absent.
- Explicit Resume ran `finish` and completed the run. Its output was
  `FINISH OK — receipt.txt created after explicit Resume`.
- Final checks passed: `greeting.txt` was exactly `Hello from Workflowz and OpenCode.`,
  `receipt.txt` was exactly `Owner resumed; greeting verified.`, and `check.mjs` was unchanged.
- The owner reported navigation was somewhat unclear, especially finding the run map after
  completion. They otherwise found the flow reasonably intuitive and considered it a success
  with room for improvement. Redacted notes are at
  `/tmp/workflowz-owner-walkthrough-notes-2026-10-22.md`.

This confirms exact-model availability, real tool behavior and an accepted live report for one
successful run. Provider rate limits and reliability across repeated runs or changing provider
conditions remain unverified. No alternate model, paid execution or global harness
reconfiguration was used.
