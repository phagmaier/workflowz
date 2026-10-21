# Workflowz

A local runner for user-defined coding-agent and command workflows. You choose the steps and
outcome rules; the runner executes them sequentially and saves progress/history in SQLite.
A local browser interface and the `wf` CLI control the same daemon.

## Browser interface

The developer workspace provides Workflows, a visual/YAML editor, Runs and focused run details.
The [user guide](USER_GUIDE.md) covers creation, rules, results, paused decisions and recovery.

- [DESIGN.md](DESIGN.md): the design brief, design-selection process and reusable prompt.
- [AGENTS.md](AGENTS.md): focused instructions for contributing to the UI overhaul.
- [archive/](archive/README.md): previous specs, guides, plans and compatibility evidence.

The selected direction and implementation decisions are recorded in
[DESIGN.md](DESIGN.md#decisions); the [design-direction prototypes](prototypes/design-directions/index.html) remain for reference.

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
