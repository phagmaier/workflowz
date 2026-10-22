import { noSideScroll, pairApp, shot, WORKFLOW, watchPolicy } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

test.use({ scenario: "gate" });

test("author shared rules, defaults and limits; inspect all failures and reorder by keyboard", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const mutations = [];
  page.on("request", (r) => {
    const op = r.url().endsWith("/ui/api") && r.postDataJSON()?.op;
    if (["save", "create", "start", "revise", "resume"].includes(op)) mutations.push(op);
  });
  const { revisionId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, `#/workflows/${revisionId}`);
  const steps = page.getByRole("region", { name: "Steps" });
  const work = steps.getByRole("button", { name: "Configure Work", exact: true });
  await work.focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(work).toBeFocused();
  await expect(steps.getByRole("row").nth(1)).toHaveAttribute("data-step", "work");
  await expect(
    page.getByRole("status").filter({ hasText: "Work moved to position" }),
  ).toContainText("1 of 5");
  await page.getByRole("link", { name: "Rules & limits" }).click();
  await page.getByRole("button", { name: "＋ Add shared rule" }).click();
  const shared = page.getByRole("region", { name: "Shared rule 1", exact: true });
  await expect(shared.getByLabel("Applies to")).toBeFocused();
  await shared.getByLabel("Applies to").selectOption("step_ids");
  await shared.getByRole("checkbox", { name: "Work", exact: true }).check();
  await shared.getByLabel("Any technical failure (fallback)").selectOption("retry");
  await shared.getByLabel("Runs in total").fill("3");
  await shared.getByLabel("Wait between runs").fill("5");
  await shared.getByLabel("Result to add").fill("system.timeout");
  await shared.getByRole("button", { name: "Add rule", exact: true }).click();
  await shared.getByLabel("timed out", { exact: true }).selectOption("goto:done");
  const defaults = page.getByRole("region", { name: "Workflow defaults", exact: true });
  await defaults.getByRole("checkbox", { name: "Ask the agent once for its report" }).uncheck();
  await defaults.getByLabel("Result to add").fill("blocked");
  await defaults.getByRole("button", { name: "Add rule", exact: true }).click();
  const save = page.getByRole("button", { name: "Save", exact: true });
  await page.getByLabel("Maximum step executions").fill("-2");
  await expect(save).toBeDisabled();
  await expect(page.getByRole("complementary", { name: "Safety limits" })).toContainText("Limits:");
  await page.getByLabel("Maximum step executions").fill("40");
  await page.getByLabel("Maximum run time (seconds)").fill("600");
  await page.getByLabel("Agent silence timeout (seconds)").fill("30");
  await expect(save).toBeEnabled();
  await noSideScroll(page);
  await shot(page, "a1-rules-desktop");
  // Conflicts remain daemon errors, attached to this tab. Removing one restores validity.
  await page.getByRole("button", { name: "＋ Add shared rule" }).click();
  const second = page.getByRole("region", { name: "Shared rule 2", exact: true });
  await second.getByLabel("Applies to").selectOption("step_ids");
  await second.getByRole("checkbox", { name: "Work", exact: true }).check();
  await expect(save).toBeDisabled();
  await expect(page.getByRole("complementary", { name: "Safety limits" })).toContainText(
    "disagree",
  );
  await second.getByRole("button", { name: "Remove shared rule 2" }).click();
  await expect(save).toBeEnabled();
  await page.getByRole("link", { name: "Form", exact: true }).click();
  await work.click();
  const form = page.getByRole("region", { name: "Selected step" });
  await form.getByText("If something goes wrong technically", { exact: false }).click();
  await expect(
    form.locator(".disclosure select").filter({ has: page.locator("option") }),
  ).not.toHaveCount(0);
  await expect(form.getByLabel("If process failed, then")).toBeVisible();
  await expect(form.getByLabel("If internal error, then")).toBeVisible();
  await expect(form.getByLabel("If no valid report, then")).toHaveValue("inherit");
  await expect(form).toContainText("via “any technical failure”");
  await form.getByLabel("If process failed, then").selectOption("pause");
  await form.getByLabel("If process failed, then").selectOption("inherit");
  await expect(save).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Rules & limits" }).click();
  await noSideScroll(page);
  await shot(page, "a2-rules-mobile");
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Saved as revision" })).toBeVisible();
  await page.getByRole("link", { name: "YAML", exact: true }).click();
  await expect(page.locator("pre.yaml")).toContainText("report_correction_attempts: 0");
  await expect(page.locator("pre.yaml")).toContainText("max_step_executions: 40");
  expect(mutations).toEqual(["save"]);
  await policy();
});

test("edit exact YAML through invalid text, delayed replies and failed checks", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  page.on("dialog", (d) => void d.accept());
  const { revisionId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, `#/workflows/${revisionId}/yaml`);
  await page.getByRole("button", { name: "Edit as text" }).click();
  const yaml = page.getByLabel("Workflow YAML", { exact: true });
  await expect(yaml).toBeFocused();
  const original = await yaml.inputValue();
  const save = page.getByRole("button", { name: "Save", exact: true });
  await yaml.fill("version: [");
  await expect(page.getByRole("region", { name: "YAML checks" })).toContainText("Line 1");
  await expect(yaml).toHaveValue("version: [");
  await expect(save).toBeDisabled();
  await expect(page.getByRole("button", { name: "Return to visual editor" })).toBeDisabled();
  await page.getByRole("region", { name: "YAML checks" }).getByRole("button").first().click();
  await expect(yaml).toBeFocused();
  await page.getByRole("link", { name: "Form", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Visual editing is paused" })).toBeVisible();
  await page.getByRole("link", { name: "Continue editing YAML" }).click();
  await expect(yaml).toHaveValue("version: [");
  await page.getByRole("link", { name: "Workflows", exact: true }).first().click();
  await page
    .getByRole("region", { name: "Unsaved drafts in this tab" })
    .getByRole("link", { name: "Implement and review" })
    .click();
  await page.getByRole("link", { name: "Continue editing YAML" }).click();
  await expect(yaml).toHaveValue("version: [");

  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op === "draft" && first) {
      first = false;
      await held;
    }
    await route.continue();
  });
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/ui/api") && r.postDataJSON()?.op === "draft",
  );
  await yaml.fill(original.replace("Implement and review", "Earlier YAML"));
  await sent;
  const exact = `# Keep this comment and spacing\n${original.replace("Implement and review", "Final YAML")}`;
  await yaml.fill(exact);
  await expect(save).toBeEnabled();
  const earlierReply = page.waitForResponse(
    (r) =>
      r.url().endsWith("/ui/api") &&
      r.request().postDataJSON()?.workflowText?.includes("Earlier YAML"),
  );
  release();
  await earlierReply;
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Final YAML");
  await expect(yaml).toHaveValue(exact);
  await expect(yaml).toBeFocused();
  await page.unroute("**/ui/api");
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op === "draft") await route.abort("connectionreset");
    else await route.continue();
  });
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.locator(".inline-alert").filter({ hasText: "daemon" })).toBeVisible();
  await expect(yaml).toHaveValue(exact);
  await expect(save).toBeDisabled();
  await page.unroute("**/ui/api");
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(save).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await noSideScroll(page);
  await shot(page, "a3-yaml-mobile");
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Saved as revision" })).toBeVisible();
  await page.getByRole("button", { name: "Return to visual editor" }).click();
  await expect(page.locator("pre.yaml")).toHaveText(exact);
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.locator("pre.yaml")).toHaveText(exact);
  await page.getByRole("link", { name: "Form", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Selected step" }).getByRole("heading", { level: 2 }),
  ).toBeVisible();
  await policy();
});

test("explain incompatible continuation, review a revision, then resume explicitly", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  page.on("dialog", (d) => void d.accept());
  const { runId, revisionId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, `#/runs/${runId}`);
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Paused");
  const paused = await app.status(runId);
  await app.request({
    op: "override",
    runId,
    expectedEventId: paused.expectedEventId,
    edit: {
      action: "mark-task-complete",
      taskId: paused.run.activeTaskId,
      reason: "Choose the remaining path explicitly",
    },
  });
  await page.goto(`${app.url}/ui/#/runs/${runId}/edit`);
  const apply = page.getByRole("button", { name: "Apply to this run" });
  const cursor = page.getByLabel("Continue at", { exact: true });
  await expect(page.locator(".run-edit")).toContainText("There is no active task");
  await expect(cursor.locator("option[value=work]")).toBeDisabled();
  await expect(cursor.locator("option[value=review]")).toBeDisabled();
  await expect(cursor.locator("option[value=finish]")).toBeDisabled();
  await page.getByText("Why some steps are unavailable", { exact: true }).click();
  await expect(page.locator(".run-edit")).toContainText("Needs an active task. Pick a task first.");
  await page.getByRole("link", { name: "Project", exact: true }).click();
  await page.getByLabel("Workflow name").fill("Revised task loop");
  await page.getByLabel(/^Reason \(saved/).fill("Finish this run here");
  await expect(apply).toBeDisabled();
  await cursor.selectOption("done");
  await expect(apply).toBeEnabled();
  await page.getByText(new RegExp(`Changes against revision ${revisionId}`)).click();
  await expect(page.locator(".revision-changes")).toContainText("Workflow name changed.");
  await page.setViewportSize({ width: 390, height: 844 });
  await noSideScroll(page);
  await shot(page, "a4-revision-compare-mobile");
  const eventsBefore = (await app.status(runId)).expectedEventId;
  const mutations = [];
  page.on("request", (r) => {
    const op = r.url().endsWith("/ui/api") && r.postDataJSON()?.op;
    if (["revise", "resume"].includes(op)) mutations.push(op);
  });
  await apply.click();
  await expect(page).toHaveURL(new RegExp(`#/runs/${runId}$`));
  await expect(page.getByRole("button", { name: "Resume run", exact: true })).toBeVisible();
  expect((await app.status(runId)).run.status).toBe("paused");
  expect(mutations).toEqual(["revise"]);
  await expect(page.getByRole("radio", { name: /Continue with Done/ })).toBeChecked();
  await page.getByLabel(/^Reason \(saved/).fill("Execute the revised finish step");
  await noSideScroll(page);
  await shot(page, "a5-guided-resume-mobile");
  await page.getByRole("button", { name: "Resume run", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Completed");
  expect(mutations).toEqual(["revise", "resume"]);
  expect((await app.status(runId)).expectedEventId).toBeGreaterThan(eventsBefore);
  await policy();
});
