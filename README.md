# Workflowz

A local runner for user-defined coding-agent and command workflows. You choose the steps and
outcome rules; the runner executes them sequentially and saves progress/history in SQLite.
A local browser interface and the `wf` CLI control the same daemon.

## UI implementation status

The approved direction is **Workbench (C)**. The first slice is built: a shared dark theme,
a sidebar with workflows and run groups, and the Workflows table with file import. Slice 2 adds
Graph authoring with step settings, Outcome connections, automatic layout and a bottom checker.
Parsed imports open in Graph; malformed YAML stays editable as text. Slice 3 adds the Form steps
table and settings panel, the shared checker, natural command entry and browser effort
preferences. Slice 4 groups Runs by status, with direct sidebar navigation and explicit Open
actions. Run details is next. Desktop packaging and service lifecycle changes are deferred.

- [DESIGN.md](DESIGN.md): approved UI requirements, decisions and implementation status.
- [AGENTS.md](AGENTS.md): contribution instructions and runtime boundaries.
- [Development reference](archive/development.md): additional commands and browser provisioning.
- [Archive](archive/README.md): technical contracts and historical material.

The previous interface's guide, feedback and prototypes are archived. A new user guide will
follow the completed redesign; historical screen descriptions are not current instructions.

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
