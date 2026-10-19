# Workflow schema v1 — implementation decisions

This file records how the implementation resolves points that `spec.md` §3 leaves open, and where it differs from the spec's field names. Any change here must also be reflected in `spec.md` or `architecture.md` (AGENTS.md change protocol).

The reference fixture is [`examples/overnight.yaml`](../examples/overnight.yaml). It compiles with zero diagnostics. Negative fixtures live in [`test/fixtures/workflows/invalid/`](../test/fixtures/workflows/invalid/) and each is pinned to one expected code in `src/engine/compile.test.ts`.

## Accepted fields

| Level | Fields |
| --- | --- |
| top | `version` (must be `1`), `name`, `project` (`root`, `instructions`), `tasks` (`source.kind: markdown_checklist`, `source.path`), `start`, `limits`, `defaults` (`on`, `report_correction_attempts`), `policies`, `steps` |
| `agent` | `harness`, `model`, `reasoning_effort`, `session` (`fresh`\|`resume`, required), exactly one of `prompt`\|`prompt_file`, `instructions`, `cwd`, `outcomes` (required), `on`, `tags`, `timeout_seconds`, `context.include_reports` |
| `command` | `argv` (required, `argv[0]` non-empty), `cwd`, `env`, `timeout_seconds`, `on`, `tags` |
| `task.next`, `task.complete` | `on`, `tags` |
| `end` | `label` |
| `limits` | `max_wall_time_seconds`, `max_step_executions`, `agent_idle_timeout_seconds` |

## Decisions and deviations

1. **`timeout_seconds` instead of `timeout`.** Matches `limits.max_wall_time_seconds`, so every duration says its unit. Field name change only.
2. **`session` is required on agent steps.** The spec lists it without a default. An implicit `fresh` would hide a choice that changes which context the agent sees.
3. **`instructions` on an agent step is a list of paths, added after `project.instructions`.** The spec names the field but not its semantics. Paths resolve against the project root and must exist (checked by `checkReferencedPaths`).
4. **`limits.agent_idle_timeout_seconds` is accepted but not yet enforced.** It is validated now so workflows can state it. Enforcement belongs to the runner (todo Phase 3).
5. **`retry.max_attempts` counts total executions, including the first.** The spec example `max_attempts: 2` is read as "run the step at most twice". `max_attempts` must be at least 2, because 1 would be a no-op. The user confirmed this reading. `backoff_seconds` is validated and stored, but the runner does not wait yet (todo 7.4). A retry on an engine-only step (`task.next`, `task.complete`) pauses the run instead of rerunning it.
6. **`command` steps have fixed outcomes:** `complete` and `failed` (spec §3.2). Spawn errors route as `system.*`. `task.next` produces `task_ready` and `exhausted`. `task.complete` produces `complete`.
7. **Every normal outcome needs an exact rule.** That means a step `on` entry, a matching policy, or `defaults.on`. A missing one is an `incomplete_transition` error, not an implicit pause (spec §3.3, architecture §3).
8. **Policy selectors are exactly one of** `{tags: [...]}`, `{step_ids: [...]}`, or `{all: true}`. A policy whose tags match no step is a warning.
9. **Conflicts are checked per precedence level.** Two policies at the same level that cover the same step and outcome must agree. Policies at different levels never conflict, because precedence decides. The result does not depend on the order policies are written in (tested).
10. **`system.*` routing.** An exact rule wins. Otherwise `system.error` is tried through the same levels. Otherwise the built-in pause applies. Unknown `system.*` names are rejected at compile time.
11. **Harness validation has two stages.** The compiler checks that a harness id exists in the registry and that the registry advertises the capabilities the step needs (`session: resume` → `supportsResume`; `model` → `supportsModelSelection`). Whether an adapter is implemented and has passed conformance is checked at run start. It is not part of the compile, so a workflow stays valid while adapters are still being built. `reasoning_effort` has no matching capability yet, so it is passed through unchecked.
12. **Permissions default to each harness's unrestricted mode; there is no schema field.** The user chose this: adapters launch with the harness's yolo or full-access setting (table in [`harness-compatibility.md`](harness-compatibility.md#unrestricted-mode-used-by-the-adapters)). Each adapter must record the mode it launched with in the attempt's events, as spec §2.4 requires. The runner imposes no approval gates (spec §6).
13. **Placeholders are allowed only where they make sense.** The templated fields are `prompt`, `prompt_file`, `cwd`, `instructions` items, command `argv` items, and command `env` values. Placeholders in `name`, `project.root`, `tasks.source.path`, `label`, `harness`, `model`, and `reasoning_effort` are rejected.
14. **Triple braces (`{{{`, `}}}`) are rejected** as ambiguous.
15. **YAML aliases (`*name`) are rejected.** Anchors are accepted but unused. YAML 1.2 is used, so an unquoted `on:` key stays a string.
16. **Loops.** A loop reachable from `start` produces an `unbounded_cycle` warning unless `limits.max_step_executions` or `limits.max_wall_time_seconds` is set. Retries are not counted as loops, because their `max_attempts` bounds them.
17. **Missing files and directories** (task source, instruction files, `prompt_file`, literal `cwd`) are checked by the caller with a supplied stat function, not by the compiler. Values that contain placeholders are skipped.

## Identifiers

Step IDs, outcome names, and tags match `^[a-z][a-z0-9_]{0,63}$`. Dots are excluded so that placeholders and `system.*` names cannot collide with user names.
