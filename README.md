# Workflowz

A local runner for user-defined coding-agent and command workflows. You choose the steps and
outcome rules; the runner executes them sequentially and saves progress/history in SQLite.
A local browser interface and the `wf` CLI control the same daemon.

## UI implementation status

The approved **Workbench (C)** interface is complete, including Graph and Form authoring,
the shared checker, runs grouped by status, and run details with paused decisions, history,
Report / Output and the execution-path map. All five slices and the final interface review
are complete. The [user guide](USER_GUIDE.md) covers the current browser interface from pairing
through running, inspection and recovery. Desktop packaging and automatic service lifecycle
remain future work; a real-provider walkthrough is separate.

- [USER_GUIDE.md](USER_GUIDE.md): end-user instructions and advanced usage reference.
- [DESIGN.md](DESIGN.md): approved UI requirements, decisions and implementation status.
- [AGENTS.md](AGENTS.md): contribution instructions and runtime boundaries.
- [Development reference](archive/development.md): additional commands and browser provisioning.
- [Archive](archive/README.md): technical contracts and historical material.

The previous interface's guides, feedback and prototypes are archived; their screen descriptions
are historical context. Use the root user guide for current instructions.

## Development

Requires Linux with `/proc`, Node.js 26+ and npm. From the repository root:

```bash
npm ci
npm run build
npm run check
```

Start the application in one terminal:

```bash
bin/wf --state-dir "$HOME/.local/state/workflowz" daemon start
```

In another terminal, from this directory:

```bash
bin/wf --state-dir "$HOME/.local/state/workflowz" ui
```

Open the printed address and enter the one-use pairing code. Leave the daemon terminal open.
The interface opens at `/ui/`. Previous `/ui/app/` bookmarks redirect there, preserving hash
navigation. The classic interface has been removed.
An existing state directory must belong to you and have private permissions (`0700`).
Core tests use offline fixtures; browser checks are separate (`npm run test:browser`). See the
[archived development reference](archive/development.md) for provisioning and additional commands.
Agent workflows use separately installed harnesses and can modify user-accessible files;
stopping does not undo their changes. UI development does not require live model calls.
