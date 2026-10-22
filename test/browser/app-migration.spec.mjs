import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { noSideScroll, pairApp, shot, WORKFLOW, watchPolicy } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

test("old app bookmarks redirect with their hash; imported YAML keeps exact source identity", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  await writeFile(
    path.join(app.root, "tasks.md"),
    "# Input preview\n- [ ] First task\n  Context <img src=x onerror=bad()>\n- [x] Already checked\n",
  );
  const { revisionId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app);
  await page.goto(`${app.url}/ui/app/#/workflows/${revisionId}/yaml`);
  await expect(page).toHaveURL(`${app.url}/ui/#/workflows/${revisionId}/yaml`);
  await expect(page.getByRole("link", { name: "Classic interface" })).toHaveCount(0);
  await expect(page.locator("pre.yaml")).toHaveText(WORKFLOW);
  await page.getByRole("link", { name: "Workflows", exact: true }).first().click();
  await page.getByRole("link", { name: "Import file…" }).click();
  const original = `# Keep this comment and formatting\n${WORKFLOW.replace("Implement and review", "Imported workflow")}  exact_command: {kind: command, argv: [printf, "", " a ", "b\\nc"], env: {SPACED: " v ", MULTILINE: "a\\nb"}, on: {complete: {goto: done}, failed: {pause: true}}}\n`;
  await page
    .getByLabel("Workflow YAML file")
    .setInputFiles({ name: "flow.yaml", mimeType: "text/yaml", buffer: Buffer.from(original) });
  await page.getByLabel("Workflow folder").fill(app.root);
  await noSideScroll(page);
  await shot(page, "migration-import-form-desktop");
  await page.getByLabel("Workflow folder").press("Tab");
  await expect(page.getByRole("button", { name: "Open draft" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await page.getByRole("link", { name: "YAML", exact: true }).click();
  await expect(page.locator("pre.yaml")).toHaveText(original);
  await expect(page.getByText("Checked · valid", { exact: true })).toBeVisible();
  await shot(page, "migration-import-desktop");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Saved as revision/)).toBeVisible();
  const importedId = Number(page.url().match(/#\/workflows\/(\d+)/)?.[1]);
  app.audit((store) => {
    const imported = store.listRevisions().find((r) => r.revisionId === importedId);
    assert.equal(imported.definitionYaml, original);
    assert.equal(imported.sourceDir, app.root);
  });
  expect((await app.request({ op: "runs" })).length).toBe(1); // Only the setup run exists.
  await page.getByRole("button", { name: "Create run…" }).click();
  const panel = page.getByRole("region", { name: "Create a run" });
  await expect(panel).toContainText("1 task will be copied");
  await panel.getByText("All checklist items", { exact: true }).click();
  await expect(panel).toContainText("Context <img src=x onerror=bad()>");
  await expect(panel).toContainText("Excluded · line 4 · checked in the file");
  await expect(panel.locator("img")).toHaveCount(0);
  await panel.getByRole("checkbox", { name: /Also include/ }).check();
  await expect(panel).toContainText("2 tasks will be copied");
  await expect(panel).not.toContainText("Excluded");
  await panel.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Ready to start");
  const runId = page.url().match(/#\/runs\/([^/]+)/)?.[1];
  const ready = await app.status(runId);
  expect(ready.tasks).toHaveLength(2);
  expect(ready.run.startTime).toBeNull();
  expect(ready.activeAttempt).toBeNull();
  expect(app.children).toEqual([]);
  await policy();
});

test("phone import keeps invalid text through failed checks, navigation and discard", async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const policy = await watchPolicy(page);
  await pairApp(page, app, "#/workflows/import");
  const file = page.getByLabel("Workflow YAML file");
  await file.setInputFiles({
    name: "large.yaml",
    mimeType: "text/yaml",
    buffer: Buffer.alloc(1024 * 1024 + 1),
  });
  await page.getByLabel("Workflow folder").fill("relative");
  await page.getByRole("button", { name: "Open draft" }).click();
  await expect(page.getByRole("alert")).toContainText("full workflow folder path");
  await page.getByLabel("Workflow folder").fill(app.root);
  await page.getByRole("button", { name: "Open draft" }).click();
  await expect(page.getByRole("alert")).toContainText("exceeds 1 MiB");
  await noSideScroll(page);
  await shot(page, "migration-import-form-mobile");
  const invalid = "# partial import\nsteps: [\n";
  await file.setInputFiles({
    name: "partial.yaml",
    mimeType: "text/yaml",
    buffer: Buffer.from(invalid),
  });
  await page.route("**/ui/api", (route) =>
    route.request().postDataJSON()?.op === "draft" ? route.abort() : route.continue(),
  );
  await page.getByRole("button", { name: "Open draft" }).click();
  const text = page.getByLabel("Workflow YAML", { exact: true });
  await expect(text).toHaveValue(invalid);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.unroute("**/ui/api");
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(page.getByText("Needs fixing", { exact: true })).toBeVisible();
  await text.fill(`${invalid}# still typing\n`);
  await text.press("Tab");
  await page.getByRole("link", { name: "Workflows", exact: true }).first().click();
  await page
    .getByRole("region", { name: "Unsaved drafts in this tab" })
    .getByRole("link", { name: "Untitled workflow" })
    .click();
  await page.getByRole("link", { name: /^YAML/ }).click();
  await expect(text).toHaveValue(`${invalid}# still typing\n`);
  await expect(page.getByText("Needs fixing", { exact: true })).toBeVisible();
  await noSideScroll(page);
  await shot(page, "migration-import-mobile");
  await page.getByRole("button", { name: "Discard draft", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Workflows" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Unsaved drafts in this tab" })).toHaveCount(0);
  expect(await app.request({ op: "runs" })).toEqual([]);
  expect(await app.request({ op: "workflows" })).toEqual([]);
  await policy();
});

test.describe("migrated classic execution and intervention proofs", () => {
  test.use({ scenario: "gate" });
  test("apply a revision then resume the task loop, preserving old reports and frozen inputs", async ({
    page,
    app,
  }) => {
    const policy = await watchPolicy(page);
    const { runId, revisionId } = await app.seed({ workflowText: WORKFLOW });
    await pairApp(page, app, `#/runs/${runId}`);
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Paused");
    const paused = await app.status(runId);
    const originalReports = await app.request({ op: "reports", runId });
    await page.getByRole("radio", { name: /Change the workflow for this run/ }).check();
    await page.getByRole("link", { name: "Edit the workflow for this run" }).click();
    await page
      .getByRole("region", { name: "Steps" })
      .getByRole("button", { name: /Work Codex/ })
      .click();
    const form = page.getByRole("region", { name: "Selected step" });
    await form.getByLabel("Model", { exact: true }).fill("offline-revised");
    await form.getByLabel("Prompt text").fill("Revised implementation {{task.text}}");
    await page.getByLabel(/^Reason \(saved/).fill("Use the repaired implementation");
    await page.getByRole("button", { name: "Apply to this run" }).click();
    await expect(page).toHaveURL(new RegExp(`#/runs/${runId}$`));
    const revised = await app.status(runId);
    expect(revised.run.status).toBe("paused");
    expect(revised.run.revisionId).not.toBe(revisionId);
    expect(await app.request({ op: "reports", runId })).toEqual(originalReports);
    await page.getByLabel(/^Reason \(saved/).fill("Execute the repaired revision");
    await page.getByRole("button", { name: "Resume run", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Completed");
    await expect(page.locator(".flash")).toHaveCount(0);
    const completed = await app.status(runId);
    expect(completed.tasks.map((t) => t.taskId)).toEqual(paused.tasks.map((t) => t.taskId));
    expect(completed.tasks.every((t) => t.state === "completed")).toBe(true);
    const reports = await app.request({ op: "reports", runId });
    expect(reports.slice(0, 1)).toEqual(originalReports);
    expect(reports.map((r) => r.outcome)).toEqual([
      "blocked",
      "complete",
      "complete",
      "complete",
      "complete",
    ]);
    const firstTask = page
      .locator(".group")
      .filter({ has: page.getByRole("button", { name: /^Task 1:/ }) });
    const groupToggle = firstTask.getByRole("button", { name: /^Task 1:/ });
    if ((await groupToggle.getAttribute("aria-expanded")) === "false") await groupToggle.click();
    await firstTask.getByRole("button", { name: /Work blocked/ }).click();
    const detail = page.getByRole("region", { name: "Work", exact: true });
    await expect(detail.locator(".who")).toContainText("offline-model");
    await expect(detail).toContainText(`Definition from revision ${revisionId}`);
    await detail.getByText("Step definition", { exact: true }).click();
    await expect(detail.locator("pre.out")).toHaveText("Work on {{task.text}}");
    await noSideScroll(page);
    await shot(page, "review-historical-definition-desktop");
    app.audit((store) => {
      const attempts = store.listAttempts(runId);
      assert.deepEqual(
        attempts.map((a) => a.revisionId),
        [revisionId, ...Array(4).fill(revised.run.revisionId)],
      );
      assert.equal(store.attemptInput(attempts[0].attemptId).model, "offline-model");
      assert.equal(store.attemptInput(attempts[1].attemptId).model, "offline-revised");
      assert.match(store.attemptInput(attempts[1].attemptId).prompt, /Revised implementation/);
      assert.deepEqual(
        attempts.map((a) => store.getReport(a.attemptId)),
        reports,
      );
      assert.deepEqual(store.listTasks(runId), completed.tasks);
      assert.equal(store.getRun(runId).status, "completed");
    });
    await policy();
  });
});

test.describe("task overrides", () => {
  test.use({ scenario: "intervention", viewport: { width: 390, height: 844 } });
  test("jump, skip task primitives and complete only the chosen task without execution", async ({
    page,
    app,
  }) => {
    const policy = await watchPolicy(page);
    const body = "Task body <script>bad()</script> stays inert";
    await writeFile(
      path.join(app.root, "tasks.md"),
      `# Work\n- [ ] First task\n  ${body}\n- [ ] Other task\n`,
    );
    const { runId } = await app.seed({ workflowText: WORKFLOW });
    await pairApp(page, app, `#/runs/${runId}`);
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Paused");
    const before = await app.status(runId);
    const reports = await app.request({ op: "reports", runId });
    await page.getByText("Run information", { exact: true }).click();
    await expect(page.locator(".kv").first()).toContainText(app.root);
    await page.getByText("First task · active · current", { exact: true }).click();
    await expect(page.getByRole("region", { name: "Imported tasks" })).toContainText(body);
    await expect(
      page.getByRole("region", { name: "Imported tasks" }).locator("script"),
    ).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Attention records" })).toContainText("blocked");
    const accepted = page.getByRole("region", { name: "Work", exact: true });
    await accepted.getByText("Accepted report", { exact: true }).click();
    await expect(accepted.locator("pre.raw")).toContainText(reports[0].attemptId);
    await noSideScroll(page);
    await shot(page, "migration-run-information-mobile");
    const choices = page.getByRole("group", { name: "What should happen next?" });
    await choices.getByRole("radio", { name: /Go to a different step/ }).check();
    await page.getByLabel("Continue at", { exact: true }).selectOption("review");
    await page.getByLabel(/^Reason \(saved/).fill("Choose review");
    await page.getByRole("button", { name: "Move the run", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("next step is Review");
    for (const step of ["Review", "Finish"]) {
      await choices
        .getByRole("radio", { name: `Decide ${step}'s result yourself`, exact: false })
        .check();
      await page.getByLabel(`${step}'s result`, { exact: true }).selectOption("complete");
      await page.getByLabel(/^Reason \(saved/).fill(`Skip ${step} without running it`);
      await page.getByRole("button", { name: "Record result", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        step === "Review" ? "next step is Finish" : "next step is Pick",
      );
      const state = await app.status(runId);
      expect(state.run.status).toBe("paused");
      expect(state.progress).toEqual(before.progress);
      expect(state.run.activeTaskId).toBe(before.run.activeTaskId);
      expect(await app.request({ op: "reports", runId })).toEqual(reports);
    }
    await choices.getByRole("radio", { name: /Mark a task done/ }).check();
    const other = before.tasks.find((t) => t.taskId !== before.run.activeTaskId);
    await page.getByLabel("Task", { exact: true }).selectOption(other.taskId);
    await page.getByLabel(/^Reason \(saved/).fill("Accept only the other task");
    await page.getByRole("button", { name: "Mark done", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Marked" })).toContainText(
      "Still paused",
    );
    const final = await app.status(runId);
    expect(final.run.status).toBe("paused");
    expect(final.run.cursorStepId).toBe("pick");
    expect(final.run.activeTaskId).toBe(before.run.activeTaskId);
    expect(final.progress).toEqual({ completed: 1, total: 2 });
    expect(final.tasks.find((t) => t.taskId === before.run.activeTaskId).state).not.toBe(
      "completed",
    );
    const history = await app.request({ op: "events", runId, after: 0, limit: 1000 });
    expect(history.hasMore).toBe(false);
    expect(
      history.events.filter((e) => e.type === "manual_override").map((e) => e.data.action),
    ).toEqual(["jump", "skip", "skip", "mark_task_complete"]);
    app.audit((store) => {
      assert.deepEqual(store.getRun(runId), final.run);
      assert.deepEqual(store.listTasks(runId), final.tasks);
      assert.deepEqual(store.listEvents(runId), history.events);
      assert.deepEqual(
        store.listAttempts(runId).map((a) => store.getReport(a.attemptId)),
        reports,
      );
    });
    await policy();
  });
});
