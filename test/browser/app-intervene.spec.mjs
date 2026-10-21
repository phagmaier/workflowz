// New app at phone width: paused-run choices, a real stale rejection, and stop.
import { noSideScroll, pairApp, shot, WORKFLOW, watchPolicy } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

test.use({ scenario: "intervention", viewport: { width: 390, height: 844 } });

test("choose what happens next on a phone; stale choices change nothing and are not retried", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const overrides = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/ui/api") && request.postDataJSON()?.op === "override")
      overrides.push(request.postDataJSON());
  });
  const { runId } = await app.seed({ workflowText: WORKFLOW });
  // A deep link survives pairing.
  await pairApp(page, app, `#/runs/${runId}`);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toContainText("Ready to start");
  await noSideScroll(page);
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(heading).toContainText("Paused — Work needs your decision");
  await noSideScroll(page);
  await shot(page, "m1-paused");

  const choices = page.getByRole("group", { name: "What should happen next?" });
  await choices.getByRole("radio", { name: /Go to a different step/ }).check();
  const target = page.getByLabel("Continue at", { exact: true });
  // Only task-compatible steps are offered.
  await expect(target.locator("option")).toHaveText(["Choose a step…", "Review", "Finish", "Done"]);

  await choices.getByRole("radio", { name: /Decide Work's result yourself/ }).check();
  await page.getByLabel("Work's result", { exact: true }).selectOption("complete");
  await expect(choices).toContainText("Then the next step will be Review.");
  const reason = page.getByLabel(/^Reason/);
  await reason.fill("Finished by hand");
  await noSideScroll(page);

  // Hold the browser's submission while another operator changes the run.
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op === "override") await held;
    await route.continue();
  });
  const record = page.getByRole("button", { name: "Record result", exact: true });
  await record.click();
  await expect(choices.getByRole("status")).toContainText("Recording…");
  await expect(record).toBeDisabled();
  // Inspection stays available while the action is in flight.
  await page.getByRole("link", { name: "Map", exact: true }).click();
  await expect(page.locator("svg.map g.node")).toHaveCount(5);
  await page.getByRole("link", { name: "History", exact: true }).click();
  const before = await app.status(runId);
  await app.request({
    op: "override",
    runId,
    expectedEventId: before.expectedEventId,
    edit: { action: "jump", stepId: "review", reason: "Concurrent operator" },
  });
  release();
  await expect(page.getByRole("alert")).toContainText(
    "Not applied. The run changed since this page last updated, so nothing changed.",
  );
  await page.unroute("**/ui/api");
  expect(overrides).toHaveLength(1);
  expect(overrides[0].expectedEventId).toBe(before.expectedEventId);
  const after = await app.status(runId);
  expect(after.run.cursorStepId).toBe("review");
  expect(after.run.status).toBe("paused");
  await shot(page, "m2-stale");

  // The page shows the new state; the typed reason survives; nothing is resent on its own.
  await expect(heading).toContainText("Paused — next step is Review");
  await expect(
    choices.getByRole("radio", { name: /Decide Review's result yourself/ }),
  ).toBeChecked();
  await expect(reason).toHaveValue("Finished by hand");
  await expect(choices).toContainText("Then the next step will be Finish.");
  await page.waitForTimeout(6000);
  expect(overrides).toHaveLength(1);

  await record.click();
  await expect(choices.getByRole("status").or(page.locator(".result-line"))).toContainText(
    "Recorded “complete” for Review. Still paused",
  );
  expect(overrides).toHaveLength(2);
  expect(overrides[1].expectedEventId).toBe(after.expectedEventId);
  await expect(heading).toContainText("Paused — next step is Finish");
  const history = page.getByRole("region", { name: "What happened" });
  await expect(history).toContainText("You moved the run to Review");
  await expect(history).toContainText("complete · set by you");

  // Stop needs a reason and states that nothing is undone.
  await page.getByRole("button", { name: "Stop this run…", exact: true }).click();
  const stop = page.getByRole("button", { name: "Stop run", exact: true });
  await expect(page.locator(".stop-form")).toContainText("Changes already made to files are kept.");
  await stop.click();
  const stopReason = page.locator(".stop-form").getByLabel(/^Reason/);
  await expect(stopReason).toBeFocused();
  await stopReason.fill("Wrong approach");
  await stop.click();
  await expect(heading).toContainText("Stopped");
  await expect(page.locator(".lede").first()).toContainText("“Wrong approach”");
  await expect(page.locator(".lede").first()).toContainText("not rolled back");
  await expect(page.getByRole("group", { name: "What should happen next?" })).toHaveCount(0);
  await noSideScroll(page);
  await shot(page, "m3-stopped");

  await page.getByRole("link", { name: "Runs", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Runs" })).toBeFocused();
  await expect(page.getByRole("row", { name: /Stopped/ })).toContainText(runId);
  await expect(page.getByRole("link", { name: /needs attention/ })).toHaveCount(0);
  await noSideScroll(page);
  await shot(page, "m4-runs");
  await policy();
});
