# Workflowz documentation

Start at [the project README](../README.md). Current work and finding status live in
[IMPROVEMENTS.md](../IMPROVEMENTS.md); contributor workflow lives in [AGENTS.md](../AGENTS.md).
The working beta is complete. A general continuation request starts from that local backlog;
GitHub issue setup is not required. Read only the current references needed for the selected
finding, then consult its historical evidence for context.

## Current product

- [User guide](USER_GUIDE.md): operating the implemented Workbench.
- [Design](DESIGN.md): approved UI behavior, decisions and deferred proposals.
- [Development](reference/development.md): local setup, checks and browser provisioning.

## Technical references

These are active implemented contracts. Verify affected behavior against current source/tests
when making changes. Phase numbers retained in them identify completed implementation history.

- [Product/runtime contract](reference/spec.md)
- [Architecture, authority, lifecycle and recovery](reference/architecture.md)
- [Workflow schema](reference/schema-v1.md)
- [Harness compatibility and verification limits](reference/harness-compatibility.md)

## Evaluations

- [Owner walkthrough](evaluations/owner-walkthrough.md): successful small live workflow and owner feedback.
- [Equipment-lending trial](evaluations/equipment-lending/README.md): multi-harness run, independent verification, original failures and critique.

These are completed evaluation records. The generated app, its databases, one-off helpers
and live setup runbooks were retired during cleanup. Public evidence and reports remain;
archived workflow YAML is historical input, not a runnable example or provider authorization.
The owner-walkthrough inputs needed by an offline browser test are under test/fixtures.

## History

[Historical records](history/README.md) retain previous feedback, plans and superseded UI
documentation. [Workbench implementation history](history/workbench-implementation-2026-10-22.md)
records completed slices/checkpoints. Rejected prototype assets were removed after the
Workbench replaced them. Historical plans and approvals are not current assignments.
