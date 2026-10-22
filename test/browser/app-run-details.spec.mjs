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
