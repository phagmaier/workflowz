# Workflowz

A local runner for user-defined coding-agent and command workflows. You choose steps and
outcome rules; Workflowz executes them sequentially and saves progress/history in SQLite.
The browser Workbench and `wf` CLI control the same daemon.

**Current phase: improve the completed working beta.** The Workbench redesign, owner walkthrough
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

## Continuing with an agent

[AGENTS.md](AGENTS.md) is the shared instruction entry point; `CLAUDE.md` links to it.
Read this README, then [IMPROVEMENTS.md](IMPROVEMENTS.md) for current gripes, priorities,
proposed remedies and the latest checkpoint. Work is local; GitHub stores the repository.
There is no required issue, label or PR workflow.

A fresh agent can start with: **“Continue improving Workflowz from IMPROVEMENTS.md.”**
It should resume an unfinished slice or choose the first actionable open finding, reproduce
current behavior, implement and verify a complete small change, then update that finding and
the checkpoint. For planning, ask it to plan the next finding; the proposal belongs beside
that finding in the same backlog. See AGENTS.md for the full working loop and runtime boundaries.

Use [docs/README.md](docs/README.md) to find the relevant current guide or contract. Historical
reports supply evidence, not assignments or permission to rerun providers. Keep disposable
experiments outside the repository and retain useful findings/regressions after cleanup.
`node_modules/` and `dist/` are ignored development/install output.
