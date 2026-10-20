# Sample workflows

Paths are valid from this repository: each YAML uses `project.root: ".."`
(relative to its file); instruction/checklist/cwd paths then use that root.
Validate any sample offline with `npm run validate -- examples/<name>.yaml`.
Validation compiles and checks paths; it never launches agents or command steps.
The parameterized CLI test discovers every `examples/*.yaml`, including overnight.

| Sample | Purpose | Execution prerequisites | Task source | Safety notes |
| --- | --- | --- | --- | --- |
| [minimal-single-step.yaml](minimal-single-step.yaml) | One agent reports declared `complete`, then end | Configured/authenticated Codex | None | Prompt requests read-only inspection; unrestricted agent execution is not a sandbox and may incur provider charges. |
| [task-loop.yaml](task-loop.yaml) | `task.next → implement → task.complete → task.next` | Configured/authenticated Codex; disposable project copy | [sample-tasks.md](sample-tasks.md), two unchecked tasks | Agent edits files; engine completion does not edit the checklist. The explicit execution limit bounds the loop. |
| [implement-review-commit.yaml](implement-review-commit.yaml) | Task-driven implementation, review `revise` loop and explicit staging/commit path | Configured/authenticated Codex and Pi; Git repository and commit identity; disposable copy | [sample-tasks.md](sample-tasks.md) | **Mutating:** `git add -A` stages all changes, including unrelated ones; `git commit` invokes local hooks. No push. Review is authored policy, not engine certification or a mandatory quality gate. Tests validate only; never execute these commands. |
| [human-checkpoint.yaml](human-checkpoint.yaml) | Existing `{pause: true}` transition for operator inspection | Configured/authenticated Codex; operator for continuation | None | No approval kind/permission barrier. See explicit continuation semantics below. |
| [command-only.yaml](command-only.yaml) | `node --version`, then `git status --short`, then end | Node and Git on PATH; repository root | None | No agents, providers or tasks. Configured commands are read-only; output may reveal local filenames. |
| [overnight.yaml](overnight.yaml) | Canonical eight-step task/debug/review/Git scenario | Configured/authenticated Codex and Pi; Git commit identity; disposable copy | [tasks.md](tasks.md), larger illustrative checklist | Mutates files, stages all changes and commits. Validation alone needs no provider. |

## Human checkpoint continuation

The agent reports `checkpoint`; that outcome pauses at `inspect` and opens attention.
An operator must inspect the report and repository, then deliberately choose what
happens next using existing [run controls](../README.md#management-cli-and-local-daemon-phase-73)
or [paused browser intervention](../README.md#browser-preparation-editor-dashboard-and-intervention-phases-81–84):

- Accept the inspection externally: explicitly jump to `done` with a reason, then
  explicitly resume. A jump alone leaves the run paused.
- Request another inspection: explicitly resume; this **reruns `inspect`**, normally
  reporting `checkpoint` and pausing again. Resume alone is not an approval.
- To use the declared `complete → done` branch, explicitly revise the paused prompt
  to request `complete` after inspecting the findings, then explicitly resume.

No human approval is inferred, persisted as an agent outcome on the operator's
behalf, or enforced as an engine-wide quality gate. Pausing is not rollback.

## Before execution

Use the explicit foreground daemon and separate create/start commands described
in the root README. Import/create does not execute; start/resume does. Agent
samples may use paid providers when started; this sample-validation milestone
uses no live provider. Review prompts, argv, hooks and working directory before
starting. Use a disposable copy for mutating samples, not this development tree.
