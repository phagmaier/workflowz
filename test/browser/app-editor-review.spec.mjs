import { pairApp, WORKFLOW, watchPolicy } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

test.use({ scenario: "gate" });

test("step renaming supports keyboard focus and preserves structural references", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { revisionId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, `#/workflows/${revisionId}`);
  const form = page.getByRole("region", { name: "Selected step" });
  await page
    .getByRole("region", { name: "Steps" })
    .getByRole("button", { name: /Work Codex/ })
    .click();
  const rename = form.getByRole("button", { name: "Rename", exact: true });
  await rename.focus();
  await page.keyboard.press("Enter");
  const input = form.getByLabel("Step name", { exact: true });
  await expect(input).toBeFocused();
  await input.fill("Implement task");
  await page.keyboard.press("Enter");
  await expect(form.getByRole("heading", { level: 2 })).toHaveText("Implement task");
  await expect(form.getByRole("heading", { level: 2 })).toBeFocused();
  await form.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(input).toBeFocused();
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(form.getByRole("button", { name: "Rename", exact: true })).toBeFocused();
  await page.getByRole("link", { name: "YAML", exact: true }).click();
  await expect(page.locator("pre.yaml")).toContainText("implement_task:");
  await expect(page.locator("pre.yaml")).toContainText("goto: implement_task");
  await policy();
});

test("failed task previews can be retried without losing the checked workflow", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { revisionId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, `#/workflows/${revisionId}`);
  let previews = 0;
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op === "preview" && ++previews === 1)
      await route.abort("connectionreset");
    else await route.continue();
  });
  await page.getByRole("button", { name: "Create run…" }).click();
  const panel = page.getByRole("region", { name: "Create a run" });
  await expect(panel).toContainText("The task list couldn't be read");
  await expect(panel.getByRole("button", { name: "Create run", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(panel).toContainText("2 tasks will be copied");
  await expect(panel.getByRole("button", { name: "Create run", exact: true })).toBeEnabled();
  expect(previews).toBe(2);
  expect((await app.request({ op: "runs" })).length).toBe(1);
  await policy();
});

test("Checks opens a collapsed advanced field before moving keyboard focus", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { revisionId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, `#/workflows/${revisionId}`);
  await page
    .getByRole("region", { name: "Steps" })
    .getByRole("button", { name: /Work Codex/ })
    .click();
  const form = page.getByRole("region", { name: "Selected step" });
  const advanced = form.locator("summary").filter({ hasText: /^Advanced/ });
  await advanced.click();
  const timeout = form.getByLabel("Time limit (seconds)", { exact: true });
  await timeout.fill("0");
  const check = page
    .getByRole("complementary", { name: "Checks" })
    .getByRole("button")
    .filter({ hasText: "time limit:" });
  await expect(check).toBeVisible();
  await advanced.click();
  await expect(timeout).toBeHidden();
  await check.click();
  await expect(timeout).toBeVisible();
  await expect(timeout).toBeFocused();
  await timeout.fill("30");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await policy();
});

test("late Save keeps its revision without redirecting a screen already left", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { revisionId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, `#/workflows/${revisionId}/project`);
  await page.getByLabel("Workflow name").fill("Saved while leaving");
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeEnabled();
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let stored;
  const committed = new Promise((resolve) => {
    stored = resolve;
  });
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op !== "save") return route.continue();
    const response = await route.fetch();
    stored((await response.json()).revisionId);
    await held;
    await route.fulfill({ response });
  });
  await save.click();
  const savedRevision = await committed;
  await page.getByRole("link", { name: "Workflows", exact: true }).first().click();
  const answered = page.waitForResponse(
    (r) => r.url().endsWith("/ui/api") && r.request().postDataJSON()?.op === "save",
  );
  release();
  await answered;
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Workflows");
  await expect(page).toHaveURL(/#\/workflows$/);
  await expect(page.getByRole("link", { name: "Saved while leaving", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Implement and review", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Implement and review");
  await expect(page.getByText(`revision ${revisionId}`, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Workflows", exact: true }).first().click();
  await page.getByRole("link", { name: "Saved while leaving", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/workflows/${savedRevision}$`));
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect((await app.request({ op: "runs" })).length).toBe(1);
  await policy();
});

test("canceling a pending creation leaves the prepared run without redirecting", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { revisionId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, `#/workflows/${revisionId}`);
  await page.getByRole("button", { name: "Create run…" }).click();
  const panel = page.getByRole("region", { name: "Create a run" });
  await expect(panel).toContainText("2 tasks will be copied");
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let stored;
  const committed = new Promise((resolve) => {
    stored = resolve;
  });
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op !== "create") return route.continue();
    const response = await route.fetch();
    stored((await response.json()).runId);
    await held;
    await route.fulfill({ response });
  });
  await panel.getByRole("button", { name: "Create run", exact: true }).click();
  const createdRun = await committed;
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  const answered = page.waitForResponse(
    (r) => r.url().endsWith("/ui/api") && r.request().postDataJSON()?.op === "create",
  );
  release();
  await answered;
  await expect(page).toHaveURL(new RegExp(`#/workflows/${revisionId}$`));
  await expect(page.getByRole("button", { name: "Create run…" })).toBeFocused();
  await page.getByRole("link", { name: "Runs", exact: true }).first().click();
  await expect(page.locator(`a[href="#/runs/${createdRun}"]`)).toBeVisible();
  const created = await app.status(createdRun);
  expect(created.run.status).toBe("ready");
  expect(created.activeAttempt).toBeNull();
  expect((await app.request({ op: "runs" })).length).toBe(2);
  await policy();
});

test("reopening the same draft while Save is pending moves only that editor to its new revision", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { revisionId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, `#/workflows/${revisionId}/project`);
  await page.getByLabel("Workflow name").fill("Pending reopened draft");
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeEnabled();
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let stored;
  const committed = new Promise((resolve) => {
    stored = resolve;
  });
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op !== "save") return route.continue();
    const response = await route.fetch();
    stored((await response.json()).revisionId);
    await held;
    await route.fulfill({ response });
  });
  await save.click();
  const savedRevision = await committed;
  await page.getByRole("link", { name: "Workflows", exact: true }).first().click();
  await page
    .getByRole("region", { name: "Unsaved drafts in this tab" })
    .getByRole("link", { name: "Pending reopened draft", exact: true })
    .click();
  await page.getByRole("link", { name: "YAML", exact: true }).click();
  const answered = page.waitForResponse(
    (r) => r.url().endsWith("/ui/api") && r.request().postDataJSON()?.op === "save",
  );
  release();
  await answered;
  await expect(page).toHaveURL(new RegExp(`#/workflows/${savedRevision}/yaml$`));
  await expect(page.locator("pre.yaml")).toContainText("Pending reopened draft");
  await expect(page.getByText(`revision ${savedRevision}`, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Workflows", exact: true }).first().click();
  await page.getByRole("link", { name: "Implement and review", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Implement and review");
  await expect(page.getByText(`revision ${revisionId}`, { exact: true })).toBeVisible();
  await policy();
});

test("late Apply keeps the run paused and does not redirect a screen already left", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { runId, revisionId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, `#/runs/${runId}`);
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Paused");
  await page.goto(`${app.url}/ui/#/runs/${runId}/edit/project`);
  await page.getByLabel("Workflow name").fill("Applied while leaving");
  await page.getByLabel(/^Reason \(saved/).fill("Review the new revision separately");
  const apply = page.getByRole("button", { name: "Apply to this run", exact: true });
  await expect(apply).toBeEnabled();
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let stored;
  const committed = new Promise((resolve) => {
    stored = resolve;
  });
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op !== "revise") return route.continue();
    const response = await route.fetch();
    stored((await response.json()).revisionId);
    await held;
    await route.fulfill({ response });
  });
  await apply.click();
  const revised = await committed;
  expect(revised).not.toBe(revisionId);
  await page.getByRole("link", { name: "Workflows", exact: true }).first().click();
  const answered = page.waitForResponse(
    (r) => r.url().endsWith("/ui/api") && r.request().postDataJSON()?.op === "revise",
  );
  release();
  await answered;
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Workflows");
  await expect(page).toHaveURL(/#\/workflows$/);
  const changed = await app.status(runId);
  expect(changed.run.status).toBe("paused");
  expect(changed.run.revisionId).toBe(revised);
  await policy();
});
