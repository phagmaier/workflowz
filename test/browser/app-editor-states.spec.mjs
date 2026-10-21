// New app editor states: late checks never stand in for newer typing, an unanswered save is not
// retried, unsaved drafts survive navigation, can be discarded, and are lost only on reload.
import { pairApp, shot, WORKFLOW, watchPolicy } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

test.use({ scenario: "gate" });

test("edit a saved workflow through slow checks, failures, navigation and discard", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const saves = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/ui/api") && request.postDataJSON()?.op === "save")
      saves.push(request.postDataJSON());
  });
  page.on("dialog", (dialog) => void dialog.accept());
  const { revisionId } = await app.seed({ workflowText: WORKFLOW });

  await pairApp(page, app, "#/workflows");
  await page.getByRole("link", { name: "Implement and review" }).click();
  await expect(page).toHaveURL(new RegExp(`#/workflows/${revisionId}$`));
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("Implement and review");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByText(`revision ${revisionId}`, { exact: true })).toBeVisible();

  // Keyboard: the step list is buttons; Enter selects without moving focus on a wide screen.
  const list = page.getByRole("region", { name: "Steps" });
  const work = list.getByRole("button", { name: /Work Codex/ });
  await work.focus();
  await page.keyboard.press("Enter");
  await expect(work).toHaveAttribute("aria-current", "true");
  await expect(work).toBeFocused();
  const form = page.getByRole("region", { name: "Selected step" });
  const prompt = form.getByLabel("Prompt text");

  // Hold the first check of an edit; a later edit's check answers first and wins.
  let releaseFirst;
  const firstHeld = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let drafts = 0;
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op === "draft" && ++drafts === 1) await firstHeld;
    await route.continue();
  });
  const save = page.getByRole("button", { name: "Save", exact: true });
  const firstSent = page.waitForRequest(
    (request) => request.url().endsWith("/ui/api") && request.postDataJSON()?.op === "draft",
  );
  await prompt.fill("First version {{task.text}}");
  await firstSent;
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Checks" })).toContainText("Checking…");
  await expect(save).toBeDisabled();
  await prompt.fill("Final version {{task.text}}");
  await expect(page.getByRole("complementary", { name: "Checks" })).toContainText("1 warning");
  await expect(save).toBeEnabled();
  releaseFirst();
  await page.waitForTimeout(300);
  await expect(prompt).toHaveValue("Final version {{task.text}}");
  await page.getByRole("link", { name: "YAML" }).click();
  await expect(page.locator("pre.yaml")).toContainText("Final version");
  await expect(page.locator("pre.yaml")).not.toContainText("First version");
  await page.unroute("**/ui/api");

  // An unanswered save says the outcome is unknown and is never resent on its own.
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op === "save") await route.abort("connectionreset");
    else await route.continue();
  });
  await save.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "unknown whether this was saved" }),
  ).toBeVisible();
  await page.waitForTimeout(1000);
  expect(saves).toHaveLength(1);
  await page.unroute("**/ui/api");
  await shot(page, "s1-save-unknown");

  // The draft survives leaving the editor and is listed on Workflows.
  await page.getByRole("link", { name: "Workflows", exact: true }).first().click();
  const drafts$ = page.getByRole("region", { name: "Unsaved drafts in this tab" });
  await expect(drafts$).toContainText(`Implement and review · changes to revision ${revisionId}`);
  await shot(page, "s2-unsaved-listed");
  await drafts$.getByRole("link", { name: "Implement and review" }).click();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Selected step" }).getByLabel("Prompt text"),
  ).toHaveValue("Final version {{task.text}}");

  // Discard asks once, then returns to the saved revision.
  await page.getByRole("button", { name: "Discard changes" }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Selected step" }).getByLabel("Prompt text"),
  ).toHaveValue("Work on {{task.text}}");
  expect(saves).toHaveLength(1);

  // A new draft lives only in this tab: reloading loses it, and the page says so.
  await page.goto(`${app.url}/ui/#/workflows/new/commands`);
  await page.getByLabel("Name", { exact: true }).fill("Build");
  await page.getByLabel("Project folder").fill(app.root);
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/#\/workflows\/draft\/\d+$/);
  await expect(page.getByText("New draft · not saved yet")).toBeVisible();
  await page.reload();
  await expect(heading).toHaveText("This draft is gone");
  await shot(page, "s3-draft-gone");
  await policy();
});
