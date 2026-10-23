// Workbench Runs: only read responses are rewritten for statuses that would otherwise require
// uncertain recovery or long-running work. Controls always use the real offline daemon.
import { noSideScroll, pairApp, shot, WORKFLOW, watchPolicy } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

const GROUPS = [
  ["waiting", "Waiting for you"],
  ["ready", "Ready to start"],
  ["running", "Running"],
  ["finished", "Finished"],
];

async function listFixture(page, app, statuses) {
  const seeded = await app.seed({ workflowText: WORKFLOW });
  const [base] = await app.request({ op: "runs" });
  const rows = statuses.map((status, index) => ({
    ...base,
    runId: status === "ready" ? seeded.runId : `run_${status}_example`,
    status,
    createdAt: `2026-10-20T10:0${index}:00.000Z`,
    cursorStepId: "review_changes",
    endTime: ["completed", "stopped"].includes(status) ? "2026-10-20T11:00:00.000Z" : null,
  }));
  let fail = false;
  let reads = 0;
  const mutations = [];
  await page.route("**/ui/api", async (route) => {
    const body = route.request().postDataJSON();
    if (["start", "resume", "stop", "pause", "override", "revise"].includes(body?.op))
      mutations.push(body);
    if (body?.op !== "runs") return route.continue();
    reads++;
    return fail
      ? route.fulfill({ status: 400, json: { error: "disk unavailable" } })
      : route.fulfill({ json: rows });
  });
  return {
    ...seeded,
    rows,
    mutations,
    reads: () => reads,
    fail: (value) => {
      fail = value;
    },
  };
}

test("all statuses are grouped once; sidebar links focus groups and survive history and reload", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const fixture = await listFixture(page, app, [
    "draft",
    "ready",
    "running",
    "pausing",
    "paused",
    "interrupted",
    "completed",
    "stopped",
  ]);
  await pairApp(page, app, "#/workflows");
  const side = page.getByRole("navigation", { name: "Main" });
  for (const [id, label] of GROUPS) {
    const link = side.getByRole("link", { name: `${label} 2` });
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`#/runs\\?group=${id}$`));
    await expect(page.locator(`#runs-${id}`)).toBeFocused();
    await expect(page.locator(`#runs-${id}`)).toBeInViewport();
    await expect(link).toHaveAttribute("aria-current", "location");
    await expect(
      page.getByRole("region", { name: `${label} 2`, exact: true }).getByRole("row"),
    ).toHaveCount(3);
    // Activating the current link still brings its heading back into view.
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(`#runs-${id}`)).toBeFocused();
    await expect(page.locator(`#runs-${id}`)).toBeInViewport();
  }
  await expect(page.getByRole("main").getByRole("row")).toHaveCount(12); // 8 runs + 4 headers
  await expect(page.getByRole("row", { name: /Interrupted/ })).toContainText(
    "Needs a recovery decision",
  );
  await expect(page.getByRole("row", { name: /Pausing/ })).toContainText(
    "Finishing the current step",
  );
  await expect(page.getByRole("row", { name: /Stopped/ })).toContainText("Ended");
  const finished = page.getByRole("region", { name: "Finished 2", exact: true });
  await expect(finished.locator(".run-identity")).toHaveText([
    `run_stopped_example · revision ${fixture.revisionId}`,
    `run_completed_example · revision ${fixture.revisionId}`,
  ]);
  for (const status of ["completed", "stopped"]) {
    const runId = `run_${status}_example`;
    await expect(
      finished.getByRole("link", { name: `View results for run ${runId}`, exact: true }),
    ).toHaveAttribute("href", `#/runs/${runId}`);
    await expect(
      finished.getByRole("link", { name: `View map for run ${runId}`, exact: true }),
    ).toHaveAttribute("href", `#/runs/${runId}/map`);
  }
  await expect(page.getByRole("link", { name: /^View map for run / })).toHaveCount(2);
  for (const [width, height, name] of [
    [900, 1100, "runs-all-statuses-tablet"],
    [390, 844, "runs-all-statuses-phone"],
    [1280, 900, "runs-all-statuses"],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await noSideScroll(page);
    await shot(page, name);
  }

  await page.goBack();
  await expect(page.locator("#runs-running")).toBeFocused();
  await page.goForward();
  await expect(page.locator("#runs-finished")).toBeFocused();
  await page.reload();
  await expect(page.locator("#runs-finished")).toBeFocused();
  await side.getByRole("link", { name: "Runs", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Runs" })).toBeFocused();
  // Opening a real prepared run is navigation; Start remains a separate action.
  const open = page.getByRole("link", { name: `Open run ${fixture.runId}`, exact: true });
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#/runs/${fixture.runId}$`));
  await expect(page.getByRole("button", { name: "Start run", exact: true })).toBeVisible();
  expect(fixture.mutations).toEqual([]);
  await policy();
});

test("polling moves runs between groups without stealing focus; failed refresh retains rows and retries", async ({
  page,
  app,
}) => {
  const fixture = await listFixture(page, app, ["ready", "running"]);
  await pairApp(page, app, "#/runs?group=ready");
  const open = page.getByRole("link", { name: `Open run ${fixture.runId}`, exact: true });
  await expect(page.locator("#runs-ready")).toBeFocused();
  await open.focus();
  const reads = fixture.reads();
  fixture.rows[1].status = "paused";
  await expect(
    page
      .getByRole("region", { name: "Waiting for you 1", exact: true })
      .getByRole("row", { name: /Paused/ }),
  ).toBeVisible();
  expect(fixture.reads()).toBeGreaterThan(reads);
  await expect(open).toBeFocused();
  await expect(page.getByText("No runs are running.", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Waiting for you 1" }),
  ).toBeVisible();

  fixture.fail(true);
  await expect(page.getByRole("heading", { name: "Runs couldn't be refreshed" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("list and counts below may be out of date");
  await expect(open).toBeFocused();
  await expect(open).toBeVisible();
  await shot(page, "runs-stale-read");
  fixture.fail(false);
  await page.getByRole("button", { name: "Try again now" }).click();
  await expect(page.getByRole("heading", { name: "Runs couldn't be refreshed" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again now" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh runs", exact: true })).toBeFocused();
  expect(fixture.mutations).toEqual([]);
});

test("a focused run keeps keyboard focus when polling moves it to another group", async ({
  page,
  app,
}) => {
  const fixture = await listFixture(page, app, ["ready"]);
  await pairApp(page, app, "#/runs?group=ready");
  await expect(page.locator("#runs-ready")).toBeFocused();
  const open = page.getByRole("link", { name: `Open run ${fixture.runId}`, exact: true });
  await open.focus();
  fixture.rows[0].status = "paused";
  await expect(
    page.locator(".run-group-waiting").getByRole("link", { name: /^Open run / }),
  ).toBeVisible();
  await expect(open).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  const title = page.locator(".run-group-waiting .row-title");
  await expect(title).toBeFocused();
  fixture.rows[0].status = "completed";
  await expect(page.locator(".run-group-finished .row-title")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: `View results for run ${fixture.runId}`, exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#/runs/${fixture.runId}$`));
  expect(fixture.mutations).toEqual([]);
});

test("a delayed first read preserves keyboard focus moved to Refresh runs", async ({
  page,
  app,
}) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op !== "runs") return route.continue();
    await pending;
    return route.continue();
  });
  await pairApp(page, app, "#/runs?group=finished");
  try {
    await expect(page.getByText("Loading runs…", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Refresh runs", exact: true }).focus();
  } finally {
    release();
  }
  await expect(page.locator("#runs-finished")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh runs", exact: true })).toBeFocused();
});

test("loading and initial read failure recover to empty groups with useful navigation", async ({
  page,
  app,
}) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let first = true;
  let fail = true;
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op !== "runs") return route.continue();
    if (first) {
      first = false;
      await pending;
    }
    return fail
      ? route.fulfill({ status: 400, json: { error: "disk unavailable" } })
      : route.continue();
  });
  await pairApp(page, app, "#/runs?group=waiting");
  try {
    await expect(page.getByRole("status").filter({ hasText: "Loading runs…" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No runs yet" })).toHaveCount(0);
    await shot(page, "runs-loading");
  } finally {
    release();
  }
  await expect(page.getByRole("heading", { name: "Runs couldn't be loaded" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("disk unavailable");
  await shot(page, "runs-failed-read");
  fail = false;
  await page.getByRole("button", { name: "Try again now" }).click();
  await expect(page.getByRole("heading", { name: "No runs yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh runs", exact: true })).toBeFocused();
  const side = page.getByRole("navigation", { name: "Main" });
  for (const [id, label] of GROUPS) {
    await side.getByRole("link", { name: `${label} 0` }).click();
    await expect(page.locator(`#runs-${id}`)).toBeFocused();
    await expect(page.getByRole("region", { name: `${label} 0`, exact: true })).toBeVisible();
  }
  // A later failed read of an empty list still reports the failure.
  fail = true;
  await expect(page.getByRole("heading", { name: "Runs couldn't be refreshed" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No runs yet" })).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Try again now" }).click();
  await expect(page.getByRole("heading", { name: "No runs yet" })).toBeVisible();
  await shot(page, "runs-empty-groups");
  await page.getByRole("link", { name: "Open Workflows", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Workflows" })).toBeVisible();
});

test("long names and unknown revisions stay readable at desktop, tablet and phone sizes", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const fixture = await listFixture(page, app, ["paused", "ready", "running", "completed"]);
  fixture.rows[0].runId = `run_${"very_long_identifier_".repeat(5)}`;
  fixture.rows[0].cursorStepId = "review_changes_with_a_very_long_step_name";
  fixture.rows[2].revisionId = 987654;
  fixture.rows[2].retryNotBefore = "2999-01-01T00:00:00.000Z";
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op !== "workflows") return route.fallback();
    const response = await route.fetch();
    const saved = await response.json();
    return route.fulfill({
      response,
      json: saved.map((row) => ({
        ...row,
        name: `Review <script>inert</script> ${"long_workflow_name_".repeat(6)}`,
      })),
    });
  });
  await pairApp(page, app, "#/runs");
  await expect(
    page.getByRole("main").getByRole("link", { name: "Revision 987654", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("row", { name: /Running/ })).toContainText("Retry after");
  await expect(page.locator("main script")).toHaveCount(0);
  for (const [width, height, name] of [
    [1440, 1100, "desktop"],
    [1100, 1100, "small-desktop"],
    [900, 1100, "tablet"],
    [761, 1100, "narrow-tablet"],
    [760, 1100, "stacked"],
    [390, 844, "phone"],
    [320, 740, "small-phone"],
  ]) {
    await page.setViewportSize({ width, height });
    await noSideScroll(page);
    for (const [, label] of GROUPS) {
      const region = page.getByRole("region", { name: `${label} 1`, exact: true });
      if (label === "Finished") {
        await expect(region.getByRole("link", { name: /^View results for run / })).toBeVisible();
        await expect(region.getByRole("link", { name: /^View map for run / })).toBeVisible();
      } else await expect(region.getByRole("link", { name: /^Open run / })).toBeVisible();
    }
    await shot(page, `runs-${name}`);
    const ready = page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Ready to start 1" });
    await ready.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#runs-ready")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("region", { name: "Ready to start 1", exact: true }).getByRole("link").first(),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: `Open run ${fixture.runId}`, exact: true }),
    ).toBeFocused();
  }
  expect(fixture.mutations).toEqual([]);
  await policy();
});
