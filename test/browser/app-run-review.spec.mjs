import { noSideScroll, pairApp, shot, WORKFLOW, watchPolicy } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

test("a later event-page failure cannot lose an accepted report or hide its read error", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { runId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, `#/runs/${runId}`);
  await expect(page.getByRole("region", { name: "What will run" })).toContainText("offline-model");
  let split = false;
  let failed = false;
  let holdFailure = true;
  await page.route("**/ui/api", async (route) => {
    const request = route.request().postDataJSON();
    if (request?.op !== "events") return route.continue();
    if (split && holdFailure) {
      failed = true;
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"Temporary later history page failure"}',
      });
    }
    const response = await route.fetch();
    const result = await response.json();
    const accepted = result.events.findIndex((event) => event.type === "report_accepted");
    if (!split && accepted >= 0) {
      split = true;
      const events = result.events.slice(0, accepted + 1);
      return route.fulfill({
        response,
        json: { events, nextAfter: events.at(-1).eventId, hasMore: true },
      });
    }
    return route.fulfill({ response, json: result });
  });
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect.poll(() => failed).toBe(true);
  await expect(
    page.getByRole("alert").filter({ hasText: "Temporary later history page failure" }),
  ).toBeVisible();
  // A partial history read must not prevent loading compatible paused-run decisions.
  await expect(page.getByRole("radio", { name: /Decide Work's result yourself/ })).toBeVisible();
  await shot(page, "run-review-history-read-error");
  holdFailure = false;
  await page.getByRole("button", { name: "Try loading history again" }).click();
  await expect(page.getByText("Accepted report", { exact: true })).toBeVisible();
  await page.getByText("Accepted report", { exact: true }).click();
  const reports = await app.request({ op: "reports", runId });
  await expect(page.getByRole("region", { name: "Accepted report JSON" })).toContainText(
    reports[0].attemptId,
  );
  await expect(
    page.getByText("Temporary later history page failure", { exact: false }),
  ).toHaveCount(0);
  await policy();
});

test("a map selection removed by another operator's revision falls back to a keyboard target", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  // "constructor" is a valid step ID as well as an inherited object property.
  const original = WORKFLOW.replace("goto: review", "goto: constructor").replace(
    "  review:\n",
    "  constructor:\n",
  );
  const { runId } = await app.seed({ workflowText: original });
  await pairApp(page, app, `#/runs/${runId}`);
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Paused");
  await page.getByRole("link", { name: "Map", exact: true }).click();
  await page.locator('svg.map [data-step="constructor"]').click();
  await expect(page.getByRole("region", { name: "Constructor", exact: true })).toBeVisible();
  const state = await app.status(runId);
  let definitionUnavailable = true;
  await page.route("**/ui/api", (route) => {
    const request = route.request().postDataJSON();
    if (
      definitionUnavailable &&
      request?.op === "load" &&
      request.source?.revisionId !== state.run.revisionId
    )
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"Temporary revised definition failure"}',
      });
    return route.continue();
  });
  const workflowText = original
    .replace("complete: {goto: constructor}", "complete: {goto: finish}")
    .replace(/ {2}constructor:\n[\s\S]*?(?= {2}finish:)/, "");
  await app.request({
    op: "revise",
    runId,
    expectedEventId: state.expectedEventId,
    edit: { workflowText, reason: "Remove the unused review step" },
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "Temporary revised definition failure" }),
  ).toBeVisible();
  // The new revision label must not be shown above the old revision's definition.
  await expect(page.locator("svg.map g.node")).toHaveCount(0);
  definitionUnavailable = false;
  await expect(page.locator("svg.map g.node")).toHaveCount(4);
  const target = page.locator('svg.map g.node[tabindex="0"]');
  await expect(target).toHaveCount(1);
  await expect(target).toHaveAttribute("data-step", "work");
  await expect(page.getByRole("region", { name: "Work", exact: true })).toContainText("Ran 1 time");
  await target.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('svg.map [data-step="finish"]')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await noSideScroll(page);
  await shot(page, "run-review-updated-map-mobile");
  await policy();
});
