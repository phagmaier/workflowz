# Archived project documentation

The active UI-overhaul guidance is in [README.md](../README.md), [AGENTS.md](../AGENTS.md) and
[DESIGN.md](../DESIGN.md). The previous planning/documentation set was archived on 2026-10-20
at the owner's request so it does not dictate or clutter the UI redesign.

These files preserve useful technical contracts, previous verification and walkthrough research.
Historical instructions, pending-status statements and approvals are not current assignments
or authorization. Read a specific reference when needed; there is no mandatory archive reading list.

| Reference | Purpose |
| --- | --- |
| [Product contract](spec.md) | Existing behavior, boundaries and acceptance scenarios |
| [Architecture](architecture.md) | Persistence, authority, processes, recovery and API contracts |
| [Workflow schema](schema-v1.md) | Accepted fields and runtime decisions |
| [Harness compatibility](harness-compatibility.md) | Adapter behavior, versions and verification limits |
| [Development reference](development.md) | Commands and browser provisioning details |
| [Previous refinement plan](refinement-plan.md) | Retired walkthrough/design sequence; not an active checklist |
| [Interrupted walkthrough](history/usability-walkthrough.md) | Completed command-only journey and observed UI problems; no agent run was started |
| [MVP history](history/README.md) | Earlier guide, completed roadmap, implementation log and compatibility history |

The runtime source, tests, fixtures and tooling were retained. The canonical overnight example
now points to the archived spec so its instruction-file reference remains valid. The user guide
will be rebuilt against the redesigned UI; the unfinished draft is preserved as research.

UI-focused reset verification: typecheck, lint, build and the existing CLI validation suite passed
(**10 tests**, including all **6 examples with zero warnings**). All **228 local Markdown links**
and heading anchors resolved; `git diff --check` passed. Runtime behavior was not changed; one
source comment and the overnight example's instruction path were updated for the archive move.
No model requests were made.
