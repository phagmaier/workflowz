# Workflowz

A local runner for user-defined coding-agent and command workflows. You choose the steps and
outcome rules; the runner executes them sequentially and saves progress/history in SQLite.
A local browser interface and the `wf` CLI control the same daemon.

## Current work: UI overhaul

The engine is working. The existing single-page interface made even guided use too difficult.
The walkthrough is stopped. We are exploring a professional interface with clear navigation,
focused screens, understandable authoring, visible feedback and readable results.

- [DESIGN.md](DESIGN.md): the design brief, design-selection process and reusable prompt.
- [AGENTS.md](AGENTS.md): focused instructions for contributing to the UI overhaul.
- [archive/](archive/README.md): previous specs, guides, plans and compatibility evidence.

The tutorial will be written after the improved UI works. No new design direction is selected yet.

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
An existing state directory must belong to you and have private permissions (`0700`).
Core tests use offline fixtures; browser checks are separate (`npm run test:browser`). See the
[archived development reference](archive/development.md) for provisioning and additional commands.
Agent workflows use separately installed harnesses and can modify user-accessible files;
stopping does not undo their changes. UI development does not require live model calls.
