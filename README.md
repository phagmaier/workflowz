# Workflowz

A local runner for user-defined coding-agent and command workflows. You choose steps and
outcome rules; Workflowz executes them sequentially and saves progress/history in SQLite.
The browser Workbench and `wf` CLI control the same daemon.

**Current phase: refine Workflowz from real use.** The Workbench redesign, owner walkthrough
and five-harness equipment-lending trial are complete. The disposable sample app has been
removed; its findings and public evidence are archived. Start with
[IMPROVEMENTS.md](IMPROVEMENTS.md) for current priorities and what we learned.

## Project map

| Path | Purpose |
| --- | --- |
| [IMPROVEMENTS.md](IMPROVEMENTS.md) | Single active improvement backlog and current checkpoint |
| [AGENTS.md](AGENTS.md) | Contribution workflow and runtime boundaries; CLAUDE.md links here |
| [docs/](docs/README.md) | User guide, approved design, technical references and past evaluations |
| `src/` | Workflow contracts, engine, persistence, harness adapters and local daemon/CLI |
| `ui/` | React + TypeScript Workbench |
| `test/` | Offline browser regressions and fixtures; unit tests live beside source |
| [examples/](examples/README.md) | Illustrative workflow definitions and task inputs |
| `scripts/`, `bin/` | Build/check helpers and the local `wf` entry point |

## Development

Requires Linux with `/proc`, Node.js 26+ and npm. Run from the repository root:

```bash
npm ci
npm run check
npm run test:browser
```

The core check builds the app, typechecks, lints and runs offline tests. Browser checks are
separate and require the pinned Chromium to be provisioned; see
[development and browser setup](docs/reference/development.md).
No live model calls are needed for ordinary product improvements.

Start the service in one terminal:

```bash
bin/wf --state-dir "$HOME/.local/state/workflowz" daemon start
```

In another terminal:

```bash
bin/wf --state-dir "$HOME/.local/state/workflowz" ui
```

Open the printed address and enter the one-use pairing code. Keep the daemon terminal open.
An existing state directory must be owned by you with private permissions (`0700`). Use
[the user guide](docs/USER_GUIDE.md) for authoring, running, results and recovery.
Agents can modify user-accessible files; stopping does not undo their changes.

## Improvement workflow

Choose one finding from IMPROVEMENTS.md, reproduce current behavior, implement a complete
small slice, and verify the affected flow. Update that finding's status/evidence; update
the design or guide only when behavior changes. Historical reports are evidence, not a new
assignment or permission to rerun providers. Keep temporary experiments outside the repository
and preserve only useful findings/regressions afterward. `node_modules/` and `dist/` are
ignored development/install output, not documentation or archived evidence.
