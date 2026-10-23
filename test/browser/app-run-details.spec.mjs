import { writeFileSync } from "node:fs";
import path from "node:path";
import { noSideScroll, pairApp, shot, WORKFLOW, watchPolicy } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

const COMMANDS = `version: 1
name: Command output review
project: {root: .}
start: first
steps:
  first:
    kind: command
    argv: [node, -e, "console.log('FIRST <script>inert</script>'); console.error('FIRST diagnostic');"]
    on:
      complete: {goto: second}
      failed: {pause: true}
  second:
    kind: command
    argv: [node, -e, "console.log('SECOND output');"]
    on:
      complete: {goto: done}
      failed: {pause: true}
  done: {kind: end}
`;

async function commandRun(page, app) {
  const seeded = await app.seed({ workflowText: COMMANDS });
  await pairApp(page, app, `#/runs/${seeded.runId}`);
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Completed");
  return seeded;
}

async function takeShot(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, name);
}

const history = (page) => page.getByRole("region", { name: "What happened" });
const detail = (page, name) => page.getByRole("region", { name, exact: true });

test("ready and paused Workbench layouts keep Apply separate from Resume and retain keyboard focus", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { runId } = await app.seed({ workflowText: WORKFLOW });
  const mutations = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/ui/api")) return;
    const body = request.postDataJSON();
    if (["start", "resume", "override", "stop"].includes(body?.op)) mutations.push(body);
  });
  await pairApp(page, app, `#/runs/${runId}`);
  await expect(page.getByRole("region", { name: "What will run" })).toContainText("offline-model");
  for (const [width, height] of [
    [1440, 1000],
    [900, 1100],
    [390, 844],
    [320, 740],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole("region", { name: "Run overview" })).toContainText(
      "Ready to start",
    );
    await noSideScroll(page);
    await takeShot(page, `details-ready-${width}`);
  }
  expect(mutations).toEqual([]);
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Paused");
  await expect(page.getByRole("link", { name: "Waiting for you 1", exact: true })).toBeVisible();
  for (const [width, height] of [
    [1440, 1000],
    [900, 1100],
    [390, 844],
    [320, 740],
  ]) {
    await page.setViewportSize({ width, height });
    await noSideScroll(page);
    await takeShot(page, `details-paused-${width}`);
  }
  const choices = page.getByRole("group", { name: "What should happen next?" });
  await choices.getByRole("radio", { name: /^Continue from another step/ }).check();
  await page.getByLabel("Continue at", { exact: true }).selectOption("review");
  const reason = page.getByLabel(/^Reason \(saved/);
  await reason.fill("Review the existing work");
  const before = await app.status(runId);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("next step is Review");
  await expect(choices.getByRole("radio", { name: /^Continue with Review/ })).toBeChecked();
  await expect(reason).toBeFocused();
  await expect(reason).toHaveValue("Review the existing work");
  expect(mutations.map((request) => request.op)).toEqual(["start", "override"]);
  expect(mutations[1]).toMatchObject({
    expectedEventId: before.expectedEventId,
    edit: { action: "jump", stepId: "review" },
  });
  expect((await app.status(runId)).run.status).toBe("paused");
  await reason.fill("");
  await page.getByRole("button", { name: "Resume run", exact: true }).click();
  await expect(reason).toBeFocused();
  expect(mutations).toHaveLength(2);
  await page.getByRole("link", { name: "Map", exact: true }).click();
  await page.locator('svg.map [data-step="work"]').click();
  await page.getByRole("button", { name: "Show latest result in history" }).click();
  await expect(page.locator("#detail-title")).toBeFocused();
  await expect(detail(page, "Work")).toContainText("Fake agent result");
  await policy();
});

test("command output is inert text; delayed output from an earlier selection cannot replace the selected attempt", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { runId } = await commandRun(page, app);
  const events = await app.request({ op: "events", runId, after: 0, limit: 1000 });
  const firstId = events.events.find(
    (event) => event.type === "attempt_started" && event.data.stepId === "first",
  ).attemptId;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let outputReads = 0;
  await page.route("**/ui/api", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.op === "output") outputReads++;
    if (body?.op === "output" && body.attemptId === firstId) await pending;
    return route.continue();
  });
  try {
    await history(page)
      .getByRole("button", { name: /First complete/ })
      .click();
    await expect(detail(page, "First").getByRole("tab", { name: "Output" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(detail(page, "First")).toContainText("Loading saved output");
    await history(page)
      .getByRole("button", { name: /Second complete/ })
      .click();
    await expect(page.getByRole("region", { name: "Standard output", exact: true })).toContainText(
      "SECOND output",
    );
  } finally {
    release();
  }
  await expect(detail(page, "Second")).toContainText("SECOND output");
  await expect(detail(page, "Second")).not.toContainText("FIRST");
  await history(page)
    .getByRole("button", { name: /First complete/ })
    .click();
  await expect(page.getByRole("region", { name: "Standard output", exact: true })).toContainText(
    "FIRST <script>inert</script>",
  );
  await expect(page.locator("main script")).toHaveCount(0);
  await expect(detail(page, "First")).toContainText("Exit code 0");
  await expect(page.getByRole("region", { name: "Error output", exact: true })).toContainText(
    "FIRST diagnostic",
  );
  const output = detail(page, "First").getByRole("tab", { name: "Output" });
  const readsBeforeSwitch = outputReads;
  await output.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(detail(page, "First").getByRole("tab", { name: "Report" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(output).toBeFocused();
  await expect(page.getByRole("region", { name: "Standard output", exact: true })).toContainText(
    "FIRST <script>inert</script>",
  );
  expect(outputReads).toBe(readsBeforeSwitch);
  await page.keyboard.press("Tab");
  await expect(detail(page, "First").getByRole("button", { name: "Refresh output" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("region", { name: "Standard output", exact: true })).toBeFocused();
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await noSideScroll(page);
    if (width <= 1100) {
      await history(page).getByRole("button", { name: "View selected step", exact: true }).click();
      await expect(page.locator("#detail-title")).toBeFocused();
    }
    await takeShot(page, `details-output-${width}`);
  }
  await policy();
});

test("agent output read failures recover at the retry action; empty and absent captures remain distinct", async ({
  page,
  app,
}) => {
  const { runId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, `#/runs/${runId}`);
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Paused");
  let mode = "fail";
  await page.route("**/ui/api", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.op !== "output") return route.continue();
    if (mode === "fail")
      return route.fulfill({ status: 503, json: { error: "Temporary output failure" } });
    return route.fulfill({
      json: {
        runId,
        attemptId: body.attemptId,
        stdout: mode === "empty" ? "" : null,
        truncated: false,
      },
    });
  });
  const work = detail(page, "Work");
  await work.getByRole("tab", { name: "Output" }).click();
  await expect(work.getByRole("alert")).toContainText("Temporary output failure");
  mode = "empty";
  await work.getByRole("button", { name: "Try loading output again" }).click();
  await expect(work).toContainText("produced no standard output");
  const refresh = work.getByRole("button", { name: "Refresh output" });
  await expect(refresh).toBeFocused();
  mode = "absent";
  await refresh.click();
  await expect(work).toContainText("No saved output is available");
  await expect(refresh).toBeFocused();
  await work.getByRole("tab", { name: "Report" }).click();
  await expect(work).toContainText("Fake agent result");
  expect((await app.status(runId)).run.status).toBe("paused");
});

test("the Output tab discloses saved stdout and diagnostic capture limits", async ({
  page,
  app,
}) => {
  const { runId } = await app.seed({
    workflowText: COMMANDS.replace(
      "console.log('FIRST <script>inert</script>'); console.error('FIRST diagnostic');",
      "process.stdout.write('x'.repeat(70000)); process.stderr.write('y'.repeat(5000));",
    ),
  });
  await pairApp(page, app, `#/runs/${runId}`);
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Completed");
  await history(page)
    .getByRole("button", { name: /First complete/ })
    .click();
  const standard = page.getByRole("region", { name: "Standard output", exact: true });
  const diagnostic = page.getByRole("region", { name: "Error output", exact: true });
  const limit = detail(page, "First").getByText("Standard output reached its capture limit", {
    exact: false,
  });
  await expect(limit).toBeVisible();
  await expect(detail(page, "First")).toContainText("additional error output was not saved here");
  expect(await standard.locator("pre").textContent()).toHaveLength(64 * 1024);
  expect(await diagnostic.locator("pre").textContent()).toHaveLength(4096);
  await page.setViewportSize({ width: 320, height: 800 });
  await limit.scrollIntoViewIfNeeded();
  await expect(limit).toBeInViewport();
  expect(await standard.evaluate((element) => element.scrollTop)).toBe(0);
  await noSideScroll(page);
  await shot(page, "review-output-limits-320");
});

test("run statuses and long labels stay readable, including interrupted recovery and stale reads", async ({
  page,
  app,
}) => {
  const { runId } = await app.seed({ workflowText: WORKFLOW });
  let status = "ready";
  let fail = false;
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op !== "status") return route.continue();
    if (fail) return route.fulfill({ status: 503, json: { error: "Temporary run read failure" } });
    const response = await route.fetch();
    const state = await response.json();
    return route.fulfill({
      response,
      json: { ...state, run: { ...state.run, status, cursorStepId: "review_".repeat(12) } },
    });
  });
  await pairApp(page, app, `#/runs/${runId}`);
  for (const value of [
    "ready",
    "running",
    "pausing",
    "paused",
    "interrupted",
    "stopped",
    "completed",
  ]) {
    status = value;
    await page.getByRole("button", { name: "Refresh run", exact: true }).click();
    await expect(page.locator(`.run-overview-${value}`)).toBeVisible();
    const map = page.getByRole("region", { name: "Run overview", exact: true }).getByRole("link", {
      name: "View map",
      exact: true,
    });
    if (["stopped", "completed"].includes(value)) {
      await expect(map).toHaveAttribute("href", `#/runs/${runId}/map`);
      await map.press("Enter");
      await expect(page.getByRole("region", { name: "Run map", exact: true })).toBeFocused();
      await page.getByRole("link", { name: "View results", exact: true }).press("Enter");
      await expect(page.getByRole("region", { name: "Run results", exact: true })).toBeFocused();
    } else await expect(map).toHaveCount(0);
    for (const width of [1280, 900, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      await noSideScroll(page);
    }
    if (value === "interrupted") {
      await expect(page.getByRole("region", { name: "Recovery", exact: true })).toContainText(
        "Nothing reruns automatically",
      );
      await takeShot(page, "details-interrupted-320");
    }
  }
  fail = true;
  await page.getByRole("button", { name: "Refresh run", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Temporary run read failure" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh run", exact: true })).toBeFocused();
  await expect(page.locator(".run-overview-completed")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Refresh run", exact: true }).click();
  await expect(page.getByText("Temporary run read failure", { exact: false })).toHaveCount(0);
});

test("a successful delayed Apply preserves a newer reason and decision", async ({ page, app }) => {
  const { runId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, `#/runs/${runId}`);
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Paused");
  const choices = page.getByRole("group", { name: "What should happen next?" });
  await choices.getByRole("radio", { name: /^Continue from another step/ }).check();
  await page.getByLabel("Continue at", { exact: true }).selectOption("review");
  await page.getByLabel(/^Reason \(saved/).fill("Move to review");
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const submitted = [];
  await page.route("**/ui/api", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.op === "override") {
      submitted.push(body);
      await pending;
    }
    return route.continue();
  });
  try {
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(choices.getByRole("status")).toContainText("Moving the run");
    await choices.getByRole("radio", { name: /^Decide Work's result yourself/ }).check();
    const reason = page.getByLabel(/^Reason \(saved/);
    await reason.fill("Keep this new draft");
    release();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("next step is Review");
    await expect(
      choices.getByRole("radio", { name: /^Decide Review's result yourself/ }),
    ).toBeChecked();
    await expect(reason).toHaveValue("Keep this new draft");
    await expect(reason).toBeFocused();
    expect(submitted).toHaveLength(1);
    expect(submitted[0].edit.reason).toBe("Move to review");
    expect((await app.status(runId)).run.status).toBe("paused");
  } finally {
    release();
  }
});

test("Apply completion keeps focus in the map when the owner inspects it while waiting", async ({
  page,
  app,
}) => {
  const { runId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, `#/runs/${runId}`);
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Paused");
  await page.getByRole("radio", { name: /^Continue from another step/ }).check();
  await page.getByLabel("Continue at", { exact: true }).selectOption("review");
  await page.getByLabel(/^Reason \(saved/).fill("Continue with review");
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op === "override") await pending;
    return route.continue();
  });
  try {
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Moving the run" })).toBeVisible();
    await page.getByRole("link", { name: "Map", exact: true }).click();
    const node = page.locator('svg.map [data-step="work"]');
    await node.focus();
    release();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("next step is Review");
    await expect(node).toBeFocused();
    await expect(page.getByRole("radio", { name: /^Continue with Review/ })).toBeChecked();
    expect((await app.status(runId)).run.status).toBe("paused");
  } finally {
    release();
  }
});

test("an initial run read retry retains focus on success and leaves later keyboard choices alone", async ({
  page,
  app,
}) => {
  const { runId } = await app.seed({ workflowText: WORKFLOW });
  let fail = true;
  let hold;
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op !== "status") return route.continue();
    if (fail) return route.fulfill({ status: 503, json: { error: "Temporary run read failure" } });
    if (hold) await hold;
    return route.continue();
  });
  await pairApp(page, app, `#/runs/${runId}`);
  await expect(page.getByRole("alert")).toContainText("Temporary run read failure");
  fail = false;
  await page.getByRole("button", { name: "Try again now" }).click();
  const refresh = page.getByRole("button", { name: "Refresh run", exact: true });
  await expect(refresh).toBeFocused();
  // Repeat, moving away from the retry while its successful response is delayed.
  fail = true;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Temporary run read failure");
  let release;
  hold = new Promise((resolve) => {
    release = resolve;
  });
  try {
    fail = false;
    await page.getByRole("button", { name: "Try again now" }).click();
    const workflows = page
      .getByRole("navigation", { name: "Main", exact: true })
      .getByRole("link", {
        name: "Workflows",
        exact: true,
      });
    await workflows.focus();
    release();
    await expect(refresh).toBeVisible();
    await expect(workflows).toBeFocused();
  } finally {
    release();
  }
});

test("inspecting the automatically selected attempt pins it through background progress and retains its tab across Map", async ({
  page,
  app,
}) => {
  const { runId } = await commandRun(page, app);
  const saved = await app.request({ op: "events", runId, after: 0, limit: 1000 });
  const next = saved.events.find(
    (event) => event.type === "attempt_started" && event.data.stepId === "second",
  );
  const boundary = saved.events.findLast((event) => event.eventId < next.eventId).eventId;
  let reveal = false;
  await page.route("**/ui/api", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.op !== "events" || reveal) return route.continue();
    return route.fulfill({
      json: {
        events: saved.events.filter(
          (event) => event.eventId > body.after && event.eventId <= boundary,
        ),
        nextAfter: boundary,
        hasMore: false,
      },
    });
  });
  await page.reload();
  const first = detail(page, "First");
  await expect(first.getByRole("region", { name: "Standard output", exact: true })).toContainText(
    "FIRST",
  );
  await first.getByRole("tab", { name: "Report", exact: true }).click();
  await page.keyboard.press("Tab");
  await expect(first.getByRole("tabpanel", { name: "Report", exact: true })).toBeFocused();
  reveal = true;
  // Trigger a normal background refresh without clicking away from the inspected details.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(history(page).getByRole("button", { name: /Second complete/ })).toBeVisible();
  await expect(first.getByRole("tab", { name: "Report", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(first.getByRole("tabpanel", { name: "Report", exact: true })).toBeFocused();
  await page.getByRole("link", { name: "Map", exact: true }).click();
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(first.getByRole("tab", { name: "Report", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

// Each long step waits for its own release file in the project folder; no timer decides when.
const WAIT =
  "const file = process.argv[1]; const timer = setInterval(() => { if (require('node:fs').existsSync(file)) { clearInterval(timer); console.log(file + ' released'); } }, 50);";
const PHASES = `version: 1
name: Foundation, tasks and integration
project: {root: .}
tasks:
  source: {kind: markdown_checklist, path: tasks.md}
start: foundation
steps:
  foundation:
    kind: command
    argv: [node, -e, "${WAIT}", release-foundation]
    timeout_seconds: 60
    on:
      complete: {goto: pick}
      failed: {pause: true}
  pick:
    kind: task.next
    on:
      task_ready: {goto: work}
      exhausted: {goto: integrate}
  work:
    kind: command
    argv: [node, -e, "console.log('task work')"]
    on:
      complete: {goto: finish}
      failed: {pause: true}
  finish:
    kind: task.complete
    on:
      complete: {goto: pick}
  integrate:
    kind: command
    argv: [node, -e, "${WAIT}", release-integrate]
    timeout_seconds: 60
    on:
      complete: {goto: done}
      failed: {pause: true}
  done: {kind: end, label: Integrated}
`;

test("long steps show their activity and attempt time; finished tasks don't read as a finished run", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { runId } = await app.seed({ workflowText: PHASES });
  const mutations = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/ui/api")) return;
    const body = request.postDataJSON();
    if (["start", "pause", "resume", "override", "stop"].includes(body?.op))
      mutations.push(body.op);
  });
  await pairApp(page, app, `#/runs/${runId}`);
  const heading = page.getByRole("heading", { level: 1 });
  const overview = page.getByRole("region", { name: "Run overview", exact: true });
  const fact = (label) =>
    overview
      .locator(".facts > div")
      .filter({ has: page.getByText(label, { exact: true }) })
      .locator("dd");
  await page.getByRole("button", { name: "Start run", exact: true }).click();

  // Before any task: the step's own activity and attempt time, not just total elapsed.
  await expect(heading).toContainText("Running — Foundation");
  await expect(fact("Task")).toHaveText("None started yet");
  await expect(fact("Tasks done")).toContainText("0/2");
  await expect(fact("Current step")).toContainText("Foundation · Command");
  await expect(fact("Current step")).toContainText(/Command running · [2-9]s this attempt/);
  await expect(fact("Elapsed")).toContainText("since start");
  await expect(fact("Elapsed")).not.toContainText("paused");
  await expect(detail(page, "Foundation")).toContainText("Workflowz doesn't show live output");
  await expect(page.getByText("Started. It keeps going if you close this browser.")).toBeVisible();
  await takeShot(page, "progress-foundation");

  // Pause after the step, then resume: paused time is named, not hidden inside elapsed.
  await page.getByRole("button", { name: "Pause after this step", exact: true }).click();
  await expect(heading).toContainText("Pausing after Foundation finishes");
  await expect(fact("Current step")).toContainText("Command running");
  const pauseFeedback = page.getByText(/^Pause requested\./);
  await expect(pauseFeedback).toBeVisible();
  writeFileSync(path.join(app.root, "release-foundation"), "release\n");
  await expect(heading).toContainText("Paused at your request");
  // Control feedback describes where the run was; once it moves on, it doesn't linger (UX-1).
  await expect(pauseFeedback).toHaveCount(0);
  await expect(fact("Next step")).toHaveText("Pick · Pick the next task");
  const refresh = page.getByRole("button", { name: "Refresh run", exact: true });
  await expect(async () => {
    await refresh.click();
    await expect(fact("Elapsed")).toContainText(/incl\. [1-9]s paused/, { timeout: 500 });
  }).toPass();
  await page.getByRole("radio", { name: /^Continue with Pick/ }).check();
  await page.getByLabel(/^Reason/).fill("Foundation inspected");
  await page.getByRole("button", { name: "Resume run", exact: true }).click();

  // All tasks done while integration continues: the run is clearly not finished.
  await expect(heading).toContainText("Running — Integrate");
  await expect(page.getByText(/^Resumed\./)).toHaveCount(0);
  await expect(page.getByText(/^Started\./)).toHaveCount(0);
  await expect(fact("Task")).toHaveText(/^All 2 done\s*Run not finished yet$/);
  await expect(fact("Tasks done")).toContainText("2/2");
  await expect(page.locator(".lede").first()).toContainText(
    "All 2 imported tasks are done; the workflow continues with Integrate.",
  );
  await expect(fact("Current step")).toContainText(/Command running · (<1s|\d+s) this attempt/);
  await expect(fact("Elapsed")).toContainText(/incl\. \d+s paused/);

  // Polling keeps the inspected attempt, its Report/Output choice and keyboard focus.
  await history(page)
    .getByRole("button", { name: /Foundation complete/ })
    .click();
  const foundation = detail(page, "Foundation");
  const output = foundation.getByRole("tab", { name: "Output", exact: true });
  await expect(output).toHaveAttribute("aria-selected", "true");
  await expect(foundation).toContainText("release-foundation released");
  await output.focus();
  await page.keyboard.press("ArrowLeft");
  const report = foundation.getByRole("tab", { name: "Report", exact: true });
  await expect(report).toBeFocused();
  // Later polls advance the attempt time without moving the owner's choice or focus.
  await expect(fact("Current step")).toContainText(/Command running · [2-9]s this attempt/);
  await expect(report).toBeFocused();
  await expect(report).toHaveAttribute("aria-selected", "true");

  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
    [320, 740],
  ]) {
    await page.setViewportSize({ width, height });
    await noSideScroll(page);
    await takeShot(page, `progress-integrate-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  writeFileSync(path.join(app.root, "release-integrate"), "release\n");
  await expect(heading).toContainText("Completed — Integrated");
  await expect(page.locator(".lede").first()).toContainText(
    /Finished in \S+( \S+)?, including \S+( \S+)? paused\. 2 of 2 tasks done\./,
  );
  await expect(fact("Task")).toHaveText("All 2 done");
  await expect(fact("Last step")).toHaveText("Done · Finish");
  await takeShot(page, "progress-completed");
  await expect(fact("Elapsed")).toContainText("start to finish");
  await expect(report).toHaveAttribute("aria-selected", "true");
  await expect(report).toBeFocused();
  expect(mutations).toEqual(["start", "pause", "resume"]);
  await policy();
});
