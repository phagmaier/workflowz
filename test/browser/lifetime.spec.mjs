import assert from "node:assert/strict";
import { expect, test } from "./fixture.mjs";

test.use({ scenario: "lifetime" });

test("reload and last-tab closure do not stop or replay an active fake operation", async ({
  page,
  context,
  app,
}) => {
  const { runId } = await app.seed({
    workflowText: `version: 1
name: Browser lifetime
project: {root: .}
start: work
steps:
  work:
    kind: agent
    harness: codex
    session: fresh
    prompt: Offline file-gated work
    outcomes: [complete]
    on:
      complete: {goto: done}
  done: {kind: end}
`,
  });
  await app.pair(page);
  await page
    .locator("#runs tr")
    .filter({ hasText: runId })
    .getByRole("button", { name: "Inspect", exact: true })
    .click();
  await expect(page.locator("#run-state")).toContainText("ready");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const active = await app.until(
    runId,
    (s) => s.run.status === "running" && s.activeAttempt?.pid && s.latestReport,
  );
  const attemptId = active.activeAttempt.attemptId;
  // Report acceptance cannot settle the file-gated supervised child.
  expect(active.latestReport.outcome).toBe("complete");
  process.kill(active.activeAttempt.pid, 0);
  await expect(page.locator("#run-state")).toContainText("running");

  await page.reload();
  await expect(page.locator("#workspace")).toBeVisible();
  await expect(page.locator("#dashboard")).toBeHidden();
  const afterReload = await app.status(runId);
  expect(afterReload.run.status).toBe("running");
  expect(afterReload.activeAttempt.attemptId).toBe(attemptId);
  process.kill(afterReload.activeAttempt.pid, 0);
  await page.close();
  expect(context.pages()).toEqual([]);

  // Independent management inspection while no browser client is open.
  const withoutBrowser = await app.status(runId);
  expect(withoutBrowser.run.status).toBe("running");
  expect(withoutBrowser.activeAttempt.attemptId).toBe(attemptId);
  expect(withoutBrowser.activeAttempt.pid).toBe(active.activeAttempt.pid);
  process.kill(withoutBrowser.activeAttempt.pid, 0);
  expect((await app.request({ op: "reports", runId })).map((r) => r.attemptId)).toEqual([
    attemptId,
  ]);
  await app.release();
  const complete = await app.until(runId, (s) => s.run.status === "completed");
  expect(complete.activeAttempt).toBeNull();
  expect(context.pages()).toEqual([]);

  const reconnected = await context.newPage();
  await reconnected.setViewportSize({ width: 390, height: 844 });
  await reconnected.goto(`${app.url}/ui/`);
  await expect(reconnected.locator("#workspace")).toBeVisible();
  await reconnected
    .locator("#runs tr")
    .filter({ hasText: runId })
    .getByRole("button", { name: "Inspect", exact: true })
    .click();
  await expect(reconnected.locator("#run-state")).toContainText("completed");
  await expect(reconnected.locator("#run-progress")).toContainText(/Graph-only/);
  await expect(reconnected.locator("#run-reports summary")).toHaveCount(1);
  await reconnected.locator("#run-reports summary").click();
  await expect(reconnected.locator("#run-reports")).toContainText(attemptId);
  expect(await reconnected.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  const reports = await app.request({ op: "reports", runId });
  app.audit((store) => {
    const attempts = store.listAttempts(runId);
    assert.deepEqual(
      attempts.map((a) => a.attemptId),
      [attemptId],
    );
    assert.equal(attempts[0].status, "succeeded");
    assert.equal(store.getRun(runId).status, "completed");
    assert.deepEqual(
      attempts.map((a) => store.getReport(a.attemptId)),
      reports,
    );
    assert.equal(store.listEvents(runId).filter((e) => e.type === "attempt_started").length, 1);
    assert.equal(store.listTransitions(runId).filter((t) => t.attemptId === attemptId).length, 1);
  });
});
