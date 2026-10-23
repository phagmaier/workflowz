# Browser interaction acceptance recipe

This optional command checks a browser journey through a disposable application. The
repository regression proves that API CRUD and page delivery can pass while this command
fails on erased input. The same command passes against the repaired fixture.

## Adapt the application contract

Read [check.mjs](check.mjs) and adapt its labels, readiness signal, data and journeys to your
application's acceptance criteria. The supplied example expects:

- An **Item name** input, **Description** textarea and **Add item** / **Save item** buttons.
- An **Items** table with the item's name in a cell and **Edit** / **Delete** buttons on its row.
- `aria-busy="false"` on the table when its data has loaded. Replace `ready()` with your
  application's real readiness signal; a visible empty table alone does not prove loading finished.
- Immediate deletion with no confirmation dialog. Adapt the Delete interaction if yours differs.

Use a disposable application/database you control. The recipe creates, edits and deletes
uniquely named records. Its failure cleanup targets only its invocation's UUID prefix; if
cleanup is unverified, the report includes that prefix for inspection. It does not undo
other application effects or replay uncertain create/update requests.

## Provision and run

From this repository, use its pinned project-local dependencies and browser:

```bash
npm ci
./node_modules/.bin/playwright install chromium --no-shell
```

Provision Linux browser dependencies as described in
[development](../../docs/reference/development.md#offline-chromium-smoke-prerequisites).
The recipe installs nothing. When copying it into another project, use a project-local
pinned Playwright dependency and explicitly provision its matching browser. A custom
`PLAYWRIGHT_BROWSERS_PATH` must be consistent during provisioning and execution.

Start your disposable application, adapt the script, then supply its explicit local URL:

```bash
node examples/browser-acceptance/check.mjs http://127.0.0.1:4173/
```

Only credential-free HTTP loopback URLs are accepted by this example. It uses a fresh
browser context for each viewport and closes its browser. Authentication requires explicit
project-specific setup; keep credentials and profiles private.

The JSON output records the browser, executed checks, viewport sizes, failure location,
cleanup status and verification limits. Exit codes are **0** for all configured checks
passing, **1** for a journey/setup/cleanup failure, and **2** for an invalid target argument.
Missing dependencies can fail before JSON output; complete provisioning first. A setup
failure with no executed results establishes no browser acceptance.

## Use in an authored workflow

[browser-acceptance.yaml](../browser-acceptance.yaml) is an ordinary command-only workflow.
Adapt its script path and target URL, or place the command at the point you choose in your
own workflow. Its `complete` route ends successfully and its `failed` route pauses. You
choose the routes; Workflowz adds no mandatory browser/review/approval gate.

Validate the sample offline, then inspect/import it and explicitly Start when ready:

```bash
npm run validate -- examples/browser-acceptance.yaml
```

Validation checks the workflow definition and paths. Execution needs the adapted application
already running with disposable data; the sample starts no application server or agent.
Inspect the command's saved Output for the actual JSON result. A command's successful end
means its configured checks passed; apply the listed limits when assessing your application's
full acceptance criteria.

In agent prompts, request exact commands/results, browser and viewport coverage, failed or
unexecuted acceptance criteria, and cleanup status in the existing report summary/handoff.
Use the workflow's declared Outcomes for inability to run required checks. Keep outstanding
manual criteria explicitly unverified until inspected.

## What this recipe verifies

Chromium at **1280 × 900** and **390 × 900**: keyboard input/focus, field retention across
another field's edit, create/read/update/delete, updated data surviving a page reload,
deletion remaining effective after reload, and page horizontal overflow. It stops after
the first failed viewport and records only executed checks.

Firefox/WebKit, authentication, simultaneous edits, server/database restart persistence,
visual polish and a full accessibility audit are unverified. Add journeys and manual checks
from your actual specification. A reload check exercises the current server's state.

The repository's provider-free verification is runnable without another application:

```bash
npm run test:browser -- app-acceptance.spec.mjs
```

That test owns a synthetic loopback form fixture with isolated in-memory data. It proves
API/page checks pass in both variants, the browser command fails specifically on erased edit
input in the broken variant, and the repaired variant completes both viewports. Both cases
execute through Workflowz's ordinary command routes and clean up their owned data/resources.

Playwright references: [locators and keyboard input](https://playwright.dev/docs/input),
[retrying assertions](https://playwright.dev/docs/test-assertions), and
[browser provisioning](https://playwright.dev/docs/browsers).
