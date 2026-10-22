# Equipment-lending evaluation — completed 2026-10-22

This is the historical record of the realistic five-harness Workflowz trial. The generated
sample app, SQLite databases, caches, one-off evaluator scripts and live setup scaffolding
were removed after completion at the owner's request. Current work is refining Workflowz;
use [IMPROVEMENTS.md](../../../IMPROVEMENTS.md).

## Read the results

- [Full evaluation and critique](EVALUATION.md): original failures, observations, attribution,
  verified outcomes, feature coverage and prioritized recommendations.
- [Public evidence](evidence/): screenshots, sanitized events and independent check results.
- [Agent reports](reports/): foundation, implementation/review, integration, audit and repairs.
- [Original sample specification](inputs/SPEC.md) and [maintenance delta](inputs/MAINTENANCE.md).
- [Timing and invocation summary](evidence/trial-summary.json),
  [independent execution recheck](evidence/execution-recheck.json) and
  [final historical verification](evidence/final-verification.json).

## Outcome

OpenCode, Codex, Claude, OMP and Pi all performed substantive work using the owner's exact
selections. The original timeout paused the baseline; an owner-authorized transport fix
and explicit Resume preserved the failure history. A separate browser repair followed an
independent failure, then the planned maintenance revision completed.

Final independent results: 20 Python tests, 40 baseline API/process checks, 29 maintenance/
migration checks, 19 baseline browser checks, 8 maintenance browser checks and a two-tab
checkout conflict passed. Those checks exercised the then-existing sample; removal means
they are evidence, not a currently runnable sample suite.

The main, browser-repair and maintenance runs used revisions 1, 3 and 5. Their run IDs and
paths are preserved in the event/summary files. Archived YAML under workflows/ preserves
authored graph inputs; it depends on removed prompts/project files and must not be imported
as a working example. inputs/AGENT_INPUT.md is historical input, not repository instructions.

Source manifests and runtime paths in evidence describe the evaluation checkpoint. The
private disposable state, raw logs and app snapshots under `/tmp` were removed after
confirming all three runs were complete and no dedicated trial process was active.
Historical runtime paths in evidence no longer resolve.
Use the [current user guide](../../USER_GUIDE.md) and [runtime references](../../README.md#technical-references)
for ongoing product work.
