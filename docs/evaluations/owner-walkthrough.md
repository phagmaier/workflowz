# Completed owner walkthrough — 2026-10-22

Historical evaluation record. The disposable live lab and its setup scripts have been
retired. The [offline browser regression](../../test/browser/owner-walkthrough.spec.mjs)
still uses the preserved [fixture](../../test/fixtures/owner-walkthrough/workflow.yaml).
See [IMPROVEMENTS.md](../../IMPROVEMENTS.md) for the active improvement backlog.

## Live result

The owner completed **Called Owner walkthrough**, run
`run_1bf09cc4-1138-4559-8b41-55c9c85ce7ad`, revision 1, with OpenCode v2.0.32 and exactly
`opencode/deepseek-v4.1-flash-free`.

- Import, inspection, Save and ready-run creation preceded explicit Start.
- Baseline → greeting edit → checkpoint reached the intended pause, with an accepted report.
- Applying the continuation to finish left the run paused and the receipt absent.
- Explicit Resume created the receipt and completed the run.
- Final greeting was exactly `Hello from Workflowz and OpenCode.` with a trailing newline;
  receipt was exactly `Owner resumed; greeting verified.`; the checker was unchanged.
- The daemon was stopped and its marked disposable lab removed after verification.

The lab used separate private Workflowz/OpenCode state. No alternate model, global harness
configuration change or paid-model substitution was used. One successful live run does not
establish provider reliability or rate limits.

## Owner feedback

The owner considered the walkthrough successful and otherwise reasonably intuitive.
Navigation was somewhat unclear: after completion, finding the run's graph/map again was
not obvious. Expected: a clear path from completed run details to Map. The owner had to
work out how to return. This remains OWNER-1 in the active backlog; a later agent finding
the existing Map does not demonstrate that discoverability has improved.

This preserves the relevant feedback from the redacted owner note previously held under
`/tmp`; no credentials, pairing codes or private transcripts are included.

## Offline verification at the walkthrough checkpoint

857 standard tests and 59 offline Chromium checks passed, along with build/typecheck/lint,
fixture checks and shell/CLI checks. These are historical checkpoint counts, before the
later transport repair. The browser regression uses a scripted adapter and real commands,
not a live provider. The fixture's two unreachable-step warnings are intentional: a manual
continuation reaches finish. Current verification commands are in
[the development reference](../reference/development.md).
