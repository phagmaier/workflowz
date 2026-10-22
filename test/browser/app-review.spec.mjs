import { noSideScroll, pairApp, shot, WORKFLOW, watchPolicy } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

test("saving keeps earlier revision addresses immutable and preserves a colliding draft", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { revisionId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, `#/workflows/${revisionId}/yaml`);
  await page.getByRole("button", { name: "Edit as text" }).click();
  const text = page.getByLabel("Workflow YAML", { exact: true });
  const revised = `# second revision\n${WORKFLOW}`;
  await text.fill(revised);
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText(/Saved as revision/)).toBeVisible();
  const savedId = Number(page.url().match(/#\/workflows\/(\d+)/)?.[1]);
  expect(savedId).not.toBe(revisionId);

  await page.getByRole("link", { name: "Workflows", exact: true }).first().click();
  await page.getByText("1 earlier revision", { exact: true }).click();
  await page.getByRole("link", { name: `Revision ${revisionId}`, exact: true }).click();
  await page.getByRole("link", { name: "YAML", exact: true }).click();
  await expect(page.locator("pre.yaml")).toHaveText(WORKFLOW);
  await page.getByRole("button", { name: "Edit as text" }).click();
  await text.fill("# keep this unfinished draft\nversion: [");
  await expect(page.getByText("Needs fixing", { exact: true })).toBeVisible();

  // Another draft saves identical text, so storage returns the already-open revision.
  await page.getByRole("link", { name: "Workflows", exact: true }).first().click();
  await page.getByRole("link", { name: "Import file…" }).click();
  await page.getByLabel("Workflow YAML file").setInputFiles({
    name: "same.yaml",
    mimeType: "text/yaml",
    buffer: Buffer.from(WORKFLOW),
  });
  await page.getByLabel("Workflow folder").fill(app.root);
  await page.getByRole("button", { name: "Open draft" }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText(/Saved as revision/)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/workflows/${revisionId}/map$`));
  await page.getByRole("link", { name: "YAML", exact: true }).click();
  await expect(page.locator("pre.yaml")).toHaveText(WORKFLOW);
  await page.getByRole("link", { name: "Workflows", exact: true }).first().click();
  await page.getByRole("region", { name: "Unsaved drafts in this tab" }).getByRole("link").click();
  await page.getByRole("link", { name: "Continue editing YAML" }).click();
  await expect(text).toHaveValue("# keep this unfinished draft\nversion: [");
  await expect(save).toBeDisabled();
  expect((await app.request({ op: "workflows" })).length).toBe(2);
  expect(app.children).toEqual([]);
  await policy();
});

test("invalid step time limits cannot save or create a run and survive editor navigation", async ({
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
  await form.getByText("Advanced", { exact: false }).click();
  const limit = form.getByLabel("Time limit (seconds)", { exact: true });
  const save = page.getByRole("button", { name: "Save", exact: true });
  await limit.fill("30");
  await expect(save).toBeEnabled();
  await limit.fill("thirty");
  await expect(form).toContainText("Enter a whole number");
  await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "Create run…" }).click();
  const panel = page.getByRole("region", { name: "Create a run" });
  await expect(panel.getByRole("button", { name: "Create run", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("link", { name: "Project", exact: true }).click();
  await page.getByRole("link", { name: /^Form/ }).click();
  await form.getByText("Advanced", { exact: false }).click();
  await expect(limit).toHaveValue("thirty");
  await expect(save).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await noSideScroll(page);
  await shot(page, "review-invalid-limit-mobile");
  await limit.fill("45");
  await expect(save).toBeEnabled();
  await expect(limit).toBeFocused();
  await save.click();
  await expect(page.getByText(/Saved as revision/)).toBeVisible();
  await page.getByRole("link", { name: "YAML", exact: true }).click();
  await expect(page.locator("pre.yaml")).toContainText("timeout_seconds: 45");
  expect(app.children).toEqual([]);
  await policy();
});

test("an accepted report is read again after a transient report fetch failure", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { runId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, `#/runs/${runId}`);
  // Loading the plan follows the initial empty report read.
  await expect(page.getByRole("region", { name: "What will run" })).toContainText("offline-model");
  let reportsReads = 0;
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op === "reports" && ++reportsReads === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"Temporary offline fixture failure"}',
      });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Paused");
  await expect.poll(() => reportsReads, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await page.getByText("Accepted report", { exact: true }).click();
  const reports = await app.request({ op: "reports", runId });
  await expect(page.getByRole("region", { name: "Accepted report JSON" })).toContainText(
    reports[0].attemptId,
  );
  await policy();
});

test("incomplete command environment lines stay visible and block saving", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { revisionId } = await app.seed({
    workflowText: `version: 1
name: Command input review
project: {root: .}
start: command
steps:
  command:
    kind: command
    argv: [node, --version]
    on: {complete: {goto: done}, failed: {pause: true}}
  done: {kind: end}
`,
  });
  await pairApp(page, app, `#/workflows/${revisionId}`);
  const form = page.getByRole("region", { name: "Selected step" });
  await form.getByText("Advanced", { exact: false }).click();
  const env = form.getByLabel("Environment variables", { exact: false });
  const save = page.getByRole("button", { name: "Save", exact: true });
  await env.fill("NAME=value\nUNFINISHED");
  await expect(form.locator(".field-err")).toBeVisible();
  await expect(save).toBeDisabled();
  await page.getByRole("link", { name: "Project", exact: true }).click();
  await page.getByRole("link", { name: /^Form/ }).click();
  await form.getByText("Advanced", { exact: false }).click();
  await expect(env).toHaveValue("NAME=value\nUNFINISHED");
  await env.fill("NAME=value\nFINISHED=other value");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText(/Saved as revision/)).toBeVisible();
  await page.getByRole("link", { name: "YAML", exact: true }).click();
  await expect(page.locator("pre.yaml")).toContainText("FINISHED: other value");
  expect(app.children).toEqual([]);
  await policy();
});
