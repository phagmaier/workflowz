import assert from "node:assert/strict";
import { parse } from "yaml";
import { expect, test } from "./fixture.mjs";

// Each mutation awaits the actual canonical editor response, not a guessed sleep.
async function visual(page, label, scope = page) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/ui/api") && r.request().postDataJSON()?.op === "draft",
  );
  await scope.getByRole("button", { name: label, exact: true }).click();
  expect((await response).ok()).toBe(true);
  await expect(page.getByLabel("New stable step ID", { exact: true })).toBeEnabled();
  await expect(page.locator("#error")).toBeHidden();
}
async function addStage(page, id, kind) {
  await page.getByLabel("New stable step ID", { exact: true }).fill(id);
  await page.getByLabel("New step kind").selectOption(kind);
  await visual(page, "Add stage");
}
async function selectStage(page, id, kind) {
  await page.getByRole("button", { name: new RegExp(`^${id} · ${kind}`) }).click();
}
async function route(page, outcome, target) {
  // Scope to stage detail, distinct from workflow defaults and policy controls.
  const detail = page
    .locator("#visual-fields")
    .getByRole("heading", {
      name: / · (agent|command|task\.next|task\.complete)$/,
    })
    .locator("..");
  await detail.getByLabel("Outcome to add", { exact: true }).fill(outcome);
  await visual(page, "Add pause rule", detail);
  if (target) {
    const row = detail
      .locator(".transition-row")
      .filter({ has: page.locator("strong", { hasText: new RegExp(`^${outcome}$`) }) });
    await row.getByLabel("Action").selectOption("goto");
    await row.getByLabel("Target ID").selectOption(target);
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/ui/api") && r.request().postDataJSON()?.op === "draft",
    );
    await row.getByRole("button", { name: "Apply transition", exact: true }).click();
    expect((await response).ok()).toBe(true);
    await expect(page.getByLabel("New stable step ID", { exact: true })).toBeEnabled();
  }
}

test.use({ scenario: "gate" });

test("visual two-stage workflow: ready, blocked attention, revise, explicit resume", async ({
  page,
  app,
}) => {
  await app.pair(page);
  await page.getByLabel("Original workflow directory (absolute)").fill(app.root);
  await visual(page, "New workflow in this directory");
  await page.getByLabel("Markdown checklist path (blank for no tasks)").fill("tasks.md");
  // Commit project fields with the real change event produced by leaving the input.
  const project = page.waitForResponse(
    (r) => r.url().endsWith("/ui/api") && r.request().postDataJSON()?.op === "draft",
  );
  await page.getByLabel("Markdown checklist path (blank for no tasks)").press("Tab");
  await project;
  await expect(page.getByLabel("New stable step ID", { exact: true })).toBeEnabled();

  await addStage(page, "pick", "task.next");
  await addStage(page, "implement", "agent");
  await page.getByLabel("model", { exact: true }).fill("offline-original");
  await page.getByLabel("Prompt text or prompt file path").fill("Implement {{task.text}}");
  await page.getByLabel("Declared outcomes — one per line").fill("complete\nblocked");
  await visual(page, "Apply stage fields");
  await addStage(page, "review", "agent");
  await page.getByLabel("harness", { exact: true }).fill("pi");
  await page.getByLabel("Prompt text or prompt file path").fill("Review {{task.text}}");
  await visual(page, "Apply stage fields");
  await addStage(page, "finish", "task.complete");

  await selectStage(page, "pick", "task.next");
  await route(page, "task_ready", "implement");
  await route(page, "exhausted", "done");
  await selectStage(page, "implement", "agent");
  await route(page, "complete", "review");
  await route(page, "blocked");
  await selectStage(page, "review", "agent");
  await route(page, "complete", "finish");
  await selectStage(page, "finish", "task.complete");
  await route(page, "complete", "pick");
  await page.getByLabel("Workflow name", { exact: true }).fill("Offline visual gate");
  await page.getByLabel("Start step ID (not display order)").selectOption("pick");
  await visual(page, "Apply name / start");
  await expect(page.locator("#draft-status")).toContainText("Valid draft");
  await expect(page.locator(".effective")).toContainText("goto pick");

  await page.getByRole("button", { name: "Preview tasks & validate", exact: true }).click();
  await expect(page.locator("#preview-summary")).toContainText("runnable");
  expect(await app.request({ op: "runs" })).toEqual([]);
  await page.getByRole("button", { name: "Save configured workflow", exact: true }).click();
  await expect(page.locator("#message")).toContainText("Saved immutable revision");
  expect(await app.request({ op: "runs" })).toEqual([]);
  const originalText = await page.locator("#yaml").inputValue();
  const originalModel = parse(originalText);
  expect(
    Object.values(originalModel.steps)
      .filter((s) => s.kind === "agent")
      .map((s) => s.harness),
  ).toEqual(["codex", "pi"]);
  await page.getByRole("button", { name: "Import tasks & create ready run", exact: true }).click();
  await expect(page.locator("#run-state")).toContainText("ready");
  const [created] = await app.request({ op: "runs" });
  const ready = await app.status(created.runId);
  expect(ready.run.status).toBe("ready");
  expect(ready.run.startTime).toBeNull();
  expect(ready.activeAttempt).toBeNull();
  expect(await app.request({ op: "reports", runId: created.runId })).toEqual([]);
  const taskIds = ready.tasks.map((t) => t.taskId);

  await expect(page.locator("#run-permissions")).toBeVisible();
  await expect(page.locator("#run-permissions")).toContainText("Configured agent permission modes");
  await expect(page.locator("#run-permissions")).toContainText(
    "implement · codex · dangerously-bypass-approvals-and-sandbox",
  );
  await expect(page.locator("#run-permissions")).toContainText(
    "review · pi · default-unrestricted-tools",
  );
  await expect(page.locator("#run-permissions")).toContainText("any files accessible to your user");
  await expect(page.locator("#run-permissions")).toContainText("No isolation or rollback");
  await expect(page.locator("#run-permissions")).toContainText(
    "Invocation events record observed launch evidence",
  );

  await page.getByRole("button", { name: "Start", exact: true }).click();
  const blocked = await app.until(created.runId, (s) => s.run.status === "paused");
  await expect(page.locator("#run-state")).toContainText("paused");
  await expect(page.locator("#run-attention")).toContainText(/blocked/);
  await expect(page.locator("#run-task")).toContainText(blocked.tasks[0].title);
  await expect(page.locator("#run-task img")).toHaveCount(0);
  const history = await app.request({ op: "reports", runId: created.runId });
  expect(history.map((r) => r.outcome)).toEqual(["blocked"]);
  await page.locator("#run-reports summary").click();
  await expect(page.locator("#run-reports")).toContainText(history[0].attemptId);

  await page.getByRole("button", { name: "Edit paused revision", exact: true }).click();
  await expect(page.locator("#revision-target")).toContainText(created.runId);
  expect(await page.locator("#yaml").inputValue()).toBe(originalText);
  await selectStage(page, "implement", "agent");
  await page.getByLabel("model", { exact: true }).fill("offline-revised");
  await page
    .getByLabel("Prompt text or prompt file path")
    .fill("Revised implementation {{task.text}}");
  await visual(page, "Apply stage fields");
  await expect(
    page.getByRole("button", { name: "Save configured workflow", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Apply revision — keep paused", exact: true }).click();
  await expect(page.locator("#error")).toContainText(/reason.*confirm/);
  expect((await app.status(created.runId)).run.revisionId).toBe(ready.run.revisionId);
  await page.getByLabel("Revision audit reason").fill("Use the visually repaired implementation");
  await page.locator("#revision-confirm").check();
  await page.getByRole("button", { name: "Apply revision — keep paused", exact: true }).click();
  const revised = await app.until(created.runId, (s) => s.run.revisionId !== ready.run.revisionId);
  expect(revised.run.status).toBe("paused");
  expect(await app.request({ op: "reports", runId: created.runId })).toEqual(history);
  await expect(page.locator("#run-state")).toContainText("paused");
  await page
    .getByLabel("Reason (required for stop/resume)")
    .fill("Execute the selected repaired revision");
  await expect(page.locator("#run-permissions")).toBeVisible();
  await expect(page.locator("#run-permissions")).toContainText(
    "dangerously-bypass-approvals-and-sandbox",
  );
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  const completed = await app.until(created.runId, (s) => s.run.status === "completed");
  await expect(page.locator("#run-state")).toContainText("completed");
  expect(completed.tasks.map((t) => t.taskId)).toEqual(taskIds);
  expect(completed.tasks.every((t) => t.state === "completed")).toBe(true);
  const reports = await app.request({ op: "reports", runId: created.runId });
  expect(reports.slice(0, 1)).toEqual(history);
  expect(reports.map((r) => r.outcome)).toEqual([
    "blocked",
    ...taskIds.flatMap(() => ["complete", "complete"]),
  ]);
  app.audit((store) => {
    const attempts = store.listAttempts(created.runId);
    assert.deepEqual(
      attempts.map((a) => a.revisionId),
      [
        ready.run.revisionId,
        ...taskIds.flatMap(() => [revised.run.revisionId, revised.run.revisionId]),
      ],
    );
    assert.equal(store.attemptInput(attempts[0].attemptId).model, "offline-original");
    assert.equal(store.attemptInput(attempts[1].attemptId).model, "offline-revised");
    assert.match(store.attemptInput(attempts[1].attemptId).prompt, /Revised implementation/);
    assert.deepEqual(
      attempts.map((a) => store.getReport(a.attemptId)),
      reports,
    );
    assert.equal(store.getRun(created.runId).status, "completed");
    assert.deepEqual(
      store.listTasks(created.runId).map((t) => t.taskId),
      taskIds,
    );
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Refresh run", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
