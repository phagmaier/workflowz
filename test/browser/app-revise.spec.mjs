// New app at phone width: change a paused run's workflow in the editor; a stale Apply changes nothing.
import { noSideScroll, pairApp, shot, WORKFLOW, watchPolicy } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

test.use({ scenario: "intervention", viewport: { width: 390, height: 844 } });

test("edit the workflow for one paused run; a stale apply is refused, kept and not retried", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const revisions = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/ui/api") && request.postDataJSON()?.op === "revise")
      revisions.push(request.postDataJSON());
  });
  page.on("dialog", (dialog) => void dialog.accept());
  const { runId, revisionId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, `#/runs/${runId}`);
  const heading = page.getByRole("heading", { level: 1 });
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(heading).toContainText("Paused — Work needs your decision");

  const choices = page.getByRole("group", { name: "What should happen next?" });
  await choices.getByRole("radio", { name: /Change the workflow for this run/ }).check();
  await page.getByRole("link", { name: "Edit the workflow for this run" }).click();
  await expect(page).toHaveURL(new RegExp(`#/runs/${runId}/edit$`));
  await expect(heading).toHaveText("Implement and review");
  await expect(heading).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(
    "Change the workflow for this run",
  );
  await expect(page.getByText("No changes yet")).toBeVisible();
  await expect(page.locator(".run-edit")).toContainText("this paused run only");
  const apply = page.getByRole("button", { name: "Apply to this run" });
  await expect(apply).toBeDisabled();
  await noSideScroll(page);
  await shot(page, "r1-run-editor");

  // Change the review prompt; the form keeps the text through checks.
  await page
    .getByRole("region", { name: "Steps" })
    .getByRole("button", { name: /Review/ })
    .click();
  const form = page.getByRole("region", { name: "Selected step" });
  await expect(form.getByRole("heading", { level: 2 })).toHaveText("Review");
  await expect(form.getByRole("heading", { level: 2 })).toBeFocused();
  const prompt = form.getByLabel("Prompt text");
  await prompt.fill("Review carefully: {{task.text}}");
  await expect(page.getByText("Changes not applied yet")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Checks" })).toContainText("1 warning");
  await page.getByLabel(/^Reason \(saved/).fill("Ask for a careful review");
  await expect(apply).toBeEnabled();
  await noSideScroll(page);

  // Another operator moves the run between the check and Apply: nothing changes, edits stay.
  const before = await app.status(runId);
  await app.request({
    op: "override",
    runId,
    expectedEventId: before.expectedEventId,
    edit: { action: "jump", stepId: "review", reason: "Concurrent operator" },
  });
  await apply.click();
  await expect(page.locator(".run-edit")).toContainText(
    "Not applied. The run changed since this editor opened, so nothing changed.",
  );
  await expect(
    page.getByRole("alert").filter({ hasText: "applying would be refused" }),
  ).toBeVisible();
  await expect(prompt).toHaveValue("Review carefully: {{task.text}}");
  await expect(apply).toBeDisabled();
  expect(revisions).toHaveLength(1);
  expect((await app.status(runId)).run.revisionId).toBe(revisionId);
  await shot(page, "r2-stale");

  await page.getByRole("button", { name: "Check the run again" }).click();
  await expect(
    page.getByText("Up to date with the run again. Your edits were kept."),
  ).toBeVisible();
  await expect(page.getByLabel("Continue at")).toHaveValue("");
  await expect(page.getByLabel("Continue at").locator("option").first()).toHaveText(
    "Where it is now — Review",
  );
  expect(revisions).toHaveLength(1);
  await apply.click();
  await expect(page).toHaveURL(new RegExp(`#/runs/${runId}$`));
  await expect(
    page.getByRole("status").filter({ hasText: "Workflow changed for this run" }),
  ).toContainText("Still paused");
  expect(revisions).toHaveLength(2);
  const after = await app.status(runId);
  expect(after.run.status).toBe("paused");
  expect(after.run.revisionId).not.toBe(revisionId);
  await expect(page.getByRole("region", { name: "What happened" })).toContainText(
    `Workflow changed for this run (revision ${after.run.revisionId})`,
  );
  await noSideScroll(page);
  await shot(page, "r3-applied");
  await policy();
});
