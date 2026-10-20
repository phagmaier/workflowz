import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "./fixture.mjs";

const WORKFLOW = `version: 1
name: Offline intervention smoke
project:
  root: .
  instructions: [instructions.md]
tasks:
  source: {kind: markdown_checklist, path: tasks.md}
start: pick
steps:
  pick:
    kind: task.next
    on:
      task_ready: {goto: work}
      exhausted: {goto: done}
  work:
    kind: agent
    harness: codex
    model: offline-model
    session: fresh
    prompt: Work on {{task.text}}
    outcomes: [complete, blocked]
    on:
      complete: {goto: review}
      blocked: {pause: true}
  review:
    kind: agent
    harness: pi
    model: offline-review-model
    session: fresh
    prompt: Review {{task.text}}
    outcomes: [complete, blocked]
    on:
      complete: {goto: finish}
      blocked: {pause: true}
  finish:
    kind: task.complete
    on:
      complete: {goto: pick}
  done: {kind: end}
`;

function bodyOf(request) {
  return request.url().endsWith("/ui/api") && request.method() === "POST"
    ? request.postDataJSON()
    : null;
}

function gate() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function selectRun(page, runId) {
  await page.getByRole("button", { name: "Refresh lists", exact: true }).click();
  await page
    .locator("#runs tr")
    .filter({ has: page.getByRole("cell", { name: runId, exact: true }) })
    .getByRole("button", { name: "Inspect", exact: true })
    .click();
  await expect(page.locator("#run-heading")).toHaveText(`Run ${runId}`);
}

async function inspectManual(page, runId) {
  await page.getByRole("button", { name: "Inspect manual intervention", exact: true }).click();
  await expect(page.locator("#intervention-target")).toContainText(`Run ${runId} · revision r`);
  await expect(page.locator("#intervention-authorization")).toContainText(
    /Pinned inspection.*current/,
  );
}

async function choose(page, action, target, reason) {
  await page.locator("#override-action").selectOption(action);
  await page.getByLabel("Explicit target / outcome", { exact: true }).selectOption(target);
  await page.getByLabel("Audit reason", { exact: true }).fill(reason);
  await page.locator("#override-confirm").check();
}

async function pausedAt(page, app, runId, cursor) {
  const status = await app.until(
    runId,
    (value) => value.run.status === "paused" && value.run.cursorStepId === cursor,
  );
  await expect(page.locator("#run-state")).toHaveText(
    `paused · revision ${status.run.revisionId} · inspected event ${status.expectedEventId}`,
  );
  await expect(page.locator("#run-stage")).toHaveText(`${cursor} · ${status.current.kind}`);
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
  return status;
}

async function fitsMobile(page, selector) {
  const control = page.locator(selector);
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.height).toBeGreaterThanOrEqual(24);
}

test.use({ scenario: "intervention", viewport: { width: 390, height: 844 } });

test("mobile manual decisions stay paused, audit durably, reject a real stale submission and pin drafts", async ({
  page,
  app,
}) => {
  const inertTask = `<img data-offline-task src=x onerror="document.body.dataset.taskHtml='executed'"> unfinished task`;
  await writeFile(
    path.join(app.root, "tasks.md"),
    `# Offline tasks\n- [ ] ${inertTask}\n- [ ] Explicit other unfinished task\n`,
  );
  const { runId } = await app.seed({ workflowText: WORKFLOW });
  const browserOverrides = [];
  const browserDrafts = [];
  page.on("request", (request) => {
    const body = bodyOf(request);
    if (body?.op === "override") browserOverrides.push(body);
    if (body?.op === "draft") browserDrafts.push(body);
  });
  await app.pair(page);
  await selectRun(page, runId);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const initial = await pausedAt(page, app, runId, "work");
  expect(initial.progress).toEqual({ completed: 0, total: 2 });
  const activeTaskId = initial.run.activeTaskId;
  const otherTask = initial.tasks.find((task) => task.taskId !== activeTaskId);
  expect(activeTaskId).toBeTruthy();
  expect(otherTask.title).toBe("Explicit other unfinished task");
  await expect(page.locator("#run-task")).toContainText(inertTask);
  await expect(page.locator("#run-task img, #run-task script")).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveAttribute("data-task-html", "executed");
  const reports = await app.request({ op: "reports", runId });
  expect(reports).toHaveLength(1);
  expect(reports[0].outcome).toBe("blocked");

  await inspectManual(page, runId);
  await page.locator("#override-action").selectOption("jump");
  await expect(page.locator('#override-target option[value="pick"]')).toHaveCount(0);
  await expect(page.locator('#override-target option[value="review"]')).toHaveCount(1);
  await page.getByLabel("Explicit target / outcome", { exact: true }).selectOption("review");
  await expect(page.locator("#override-consequence")).toContainText(
    /work.*review.*No stage executes/,
  );
  await expect(page.locator("#override-consequence")).toContainText(/Task progress.*unchanged/);
  for (const selector of [
    "#override-action",
    "#override-target",
    "#override-reason",
    "#override-form label.checkbox",
    "#apply-override",
  ]) {
    await fitsMobile(page, selector);
  }
  const apply = page.getByRole("button", {
    name: "Apply manual intervention — keep paused",
    exact: true,
  });
  await page.locator("#override-confirm").check();
  await apply.click();
  await expect(page.locator("#override-reason")).toBeFocused();
  await expect(page.locator("#override-reason:invalid")).toHaveCount(1);
  await page.getByLabel("Audit reason", { exact: true }).fill("   ");
  await apply.click();
  await expect(page.locator("#error")).toContainText(/target.*nonblank reason.*confirm/);
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Review is the compatible next stage");
  await page.locator("#override-confirm").uncheck();
  await apply.click();
  await expect(page.locator("#override-confirm")).toBeFocused();
  await expect(page.locator("#override-confirm:invalid")).toHaveCount(1);
  expect(browserOverrides).toHaveLength(0);
  expect((await app.status(runId)).expectedEventId).toBe(initial.expectedEventId);
  await page.locator("#override-confirm").check();
  await apply.click();
  const jumped = await pausedAt(page, app, runId, "review");
  expect(jumped.progress).toEqual(initial.progress);
  expect(jumped.run.activeTaskId).toBe(activeTaskId);

  await inspectManual(page, runId);
  await choose(page, "skip", "complete", "Bypass review through its declared outcome");
  await expect(page.locator("#override-consequence")).toContainText(
    /Effective route:.*"target":"finish"/,
  );
  await expect(page.locator("#override-consequence")).toContainText(
    /No process.*report.*does not complete.*task/,
  );
  await expect(page.locator('#override-target option[value="invented"]')).toHaveCount(0);
  await apply.click();
  const skippedReview = await pausedAt(page, app, runId, "finish");
  expect(skippedReview.progress).toEqual(initial.progress);
  expect(await app.request({ op: "reports", runId })).toEqual(reports);

  // Skipping task.complete is also a route choice, never acceptance of the task.
  await inspectManual(page, runId);
  await choose(page, "skip", "complete", "Bypass task primitive without accepting its task");
  await apply.click();
  const skippedCompletion = await pausedAt(page, app, runId, "pick");
  expect(skippedCompletion.progress).toEqual(initial.progress);
  expect(skippedCompletion.run.activeTaskId).toBe(activeTaskId);
  expect(skippedCompletion.tasks).toEqual(initial.tasks);
  expect(await app.request({ op: "reports", runId })).toEqual(reports);

  await inspectManual(page, runId);
  await choose(
    page,
    "mark-task-complete",
    otherTask.taskId,
    "Accept only the explicitly selected other task",
  );
  await expect(page.locator("#override-consequence")).toContainText(otherTask.taskId);
  await expect(page.locator("#override-consequence")).toContainText(
    /complete without implementing.*cursor stays pick/,
  );
  await apply.click();
  const completed = await pausedAt(page, app, runId, "pick");
  expect(completed.progress).toEqual({ completed: 1, total: 2 });
  expect(completed.run.activeTaskId).toBe(activeTaskId);
  expect(completed.tasks.find((task) => task.taskId === otherTask.taskId).state).toBe("completed");
  expect(completed.tasks.find((task) => task.taskId === activeTaskId).state).not.toBe("completed");

  // Hold the actual browser request before the server sees it, then race a separate operator.
  await inspectManual(page, runId);
  await choose(page, "jump", "work", "Stale browser decision must never commit");
  const releaseOverride = gate();
  const holdOverride = async (route) => {
    const body = bodyOf(route.request());
    if (body?.op === "override") await releaseOverride.promise;
    await route.continue();
  };
  await page.route("**/ui/api", holdOverride);
  const staleResponse = page.waitForResponse(
    (response) => bodyOf(response.request())?.op === "override",
  );
  const submitted = page.waitForRequest((request) => bodyOf(request)?.op === "override", {
    timeout: 5000,
  });
  try {
    await apply.click();
    const stalePayload = bodyOf(await submitted);
    expect(stalePayload.expectedEventId).toBe(completed.expectedEventId);
    const fresh = await app.status(runId);
    await app.request({
      op: "override",
      runId,
      expectedEventId: fresh.expectedEventId,
      edit: {
        action: "jump",
        stepId: "review",
        reason: "Concurrent operator deliberately selects review",
      },
    });
    releaseOverride.release();
    const response = await staleResponse;
    expect(response.status()).toBe(409);
    expect((await response.json()).error).toContain("stale control request");
    await expect(page.locator("#run-error")).toContainText("stale control request");
    await expect(page.locator("#run-updated")).toContainText(
      /No automatic retry.*Refresh and inspect/,
    );
    await expect(apply).toBeDisabled();
    await expect(page.locator("#override-reason")).toHaveValue(
      "Stale browser decision must never commit",
    );
    await expect(page.locator("#override-target")).toHaveValue("work");
  } finally {
    releaseOverride.release();
    await page.unroute("**/ui/api", holdOverride);
  }
  await page.getByRole("button", { name: "Refresh run", exact: true }).click();
  await pausedAt(page, app, runId, "review");
  await expect(apply).toBeDisabled();
  await expect(page.locator("#intervention-authorization")).toContainText(
    /inspect manual intervention.*again/,
  );
  await inspectManual(page, runId);
  await expect(apply).toBeEnabled();
  await expect(page.locator("#override-target")).toHaveValue("");
  await expect(page.locator("#override-reason")).toHaveValue("");
  await expect(page.locator("#override-confirm")).not.toBeChecked();
  await page.locator("#override-action").selectOption("mark-task-complete");
  await expect(page.locator(`#override-target option[value="${otherTask.taskId}"]`)).toHaveCount(0);
  await expect(page.locator(`#override-target option[value="${activeTaskId}"]`)).toHaveCount(1);

  const alternate = await app.seed({
    workflowText: WORKFLOW.replace("Offline intervention smoke", "Different ready run"),
  });
  await page.getByRole("button", { name: "Edit paused revision", exact: true }).click();
  await expect(page.locator("#revision-edit")).toBeVisible();
  await expect(page.locator("#draft-status")).toContainText(/Valid draft/);
  const pinnedTarget = await page.locator("#revision-target").textContent();
  expect(pinnedTarget).toContain(`Run ${runId} · revision r${initial.run.revisionId}`);
  const originalDraft = await page.getByLabel("Canonical YAML draft", { exact: true }).inputValue();
  const firstDraft = originalDraft.replace("model: offline-model", "model: unsaved-first-model");
  const keptDraft = firstDraft.replace("unsaved-first-model", "unsaved-kept-model");
  expect(keptDraft).not.toBe(originalDraft);
  const releaseDraft = gate();
  const holdDraft = async (route) => {
    const body = bodyOf(route.request());
    if (body?.op === "draft") await releaseDraft.promise;
    await route.continue();
  };
  await page.route("**/ui/api", holdDraft);
  const delayedValidation = page.waitForResponse(
    (response) => bodyOf(response.request())?.op === "draft",
  );
  const validationRequest = page.waitForRequest((request) => bodyOf(request)?.op === "draft", {
    timeout: 5000,
  });
  try {
    await page.getByLabel("Canonical YAML draft", { exact: true }).fill(firstDraft);
    await page.getByRole("button", { name: "Validate YAML draft", exact: true }).click();
    const validationPayload = bodyOf(await validationRequest);
    expect(validationPayload.run.runId).toBe(runId);
    expect(validationPayload.workflowText).toBe(firstDraft);
    const polled = page.waitForResponse((response) => {
      const body = bodyOf(response.request());
      return body?.op === "events" && body.runId === runId;
    });
    await page.getByLabel("Canonical YAML draft", { exact: true }).fill(keptDraft);
    await polled;
    await expect(page.locator("#yaml")).toHaveValue(keptDraft);
    await expect(page.locator("#revision-target")).toHaveText(pinnedTarget);
    releaseDraft.release();
    expect((await delayedValidation).status()).toBe(200);
    await expect(
      page.getByRole("button", { name: "Validate YAML draft", exact: true }),
    ).toBeEnabled();
    await expect(page.locator("#yaml")).toHaveValue(keptDraft);
    await expect(page.locator("#draft-status")).toContainText(/Unvalidated YAML/);
    await expect(page.getByLabel("New stable step ID", { exact: true })).toBeDisabled();
  } finally {
    releaseDraft.release();
    await page.unroute("**/ui/api", holdDraft);
  }
  await page.getByRole("button", { name: "Validate YAML draft", exact: true }).click();
  await expect(page.locator("#draft-status")).toContainText(/Valid draft/);
  await selectRun(page, alternate.runId);
  await expect(page.locator("#run-state")).toContainText("ready · revision");
  await expect(page.locator("#yaml")).toHaveValue(keptDraft);
  await expect(page.locator("#revision-target")).toHaveText(pinnedTarget);
  await expect(page.locator("#revision-authorization")).toContainText(/Draft retained unchanged/);
  await expect(
    page.getByRole("button", { name: "Apply revision — keep paused", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Refresh edit authorization — keep draft", exact: true })
    .click();
  await expect(page.locator("#error")).toContainText(/paused run.*CLI recovery/);
  await expect(page.locator("#yaml")).toHaveValue(keptDraft);
  await expect(page.locator("#revision-target")).toHaveText(pinnedTarget);
  expect(browserDrafts.every((draft) => draft.run?.runId === runId)).toBe(true);
  expect(browserOverrides).toHaveLength(5);
  expect(
    browserOverrides.filter(
      (request) => request.edit.reason === "Stale browser decision must never commit",
    ),
  ).toHaveLength(1);
  expect((await app.status(alternate.runId)).run.status).toBe("ready");

  const final = await app.status(runId);
  expect(final.run.status).toBe("paused");
  expect(final.run.cursorStepId).toBe("review");
  expect(final.run.revisionId).toBe(initial.run.revisionId);
  expect(final.progress).toEqual({ completed: 1, total: 2 });
  expect(await app.request({ op: "reports", runId })).toEqual(reports);
  const history = await app.request({ op: "events", runId, after: 0, limit: 1000 });
  expect(history.hasMore).toBe(false);
  const manual = history.events.filter((event) => event.type === "manual_override");
  expect(manual.map((event) => event.data)).toEqual([
    { action: "jump", from: "work", to: "review", reason: "Review is the compatible next stage" },
    {
      action: "skip",
      stepId: "review",
      outcome: "complete",
      reason: "Bypass review through its declared outcome",
    },
    {
      action: "skip",
      stepId: "finish",
      outcome: "complete",
      reason: "Bypass task primitive without accepting its task",
    },
    {
      action: "mark_task_complete",
      taskId: otherTask.taskId,
      reason: "Accept only the explicitly selected other task",
    },
    {
      action: "jump",
      from: "pick",
      to: "review",
      reason: "Concurrent operator deliberately selects review",
    },
  ]);
  expect(
    history.events.filter((event) => event.type === "task_completed").map((event) => event.data),
  ).toEqual([{ taskId: otherTask.taskId, manual: true }]);
  app.durableEvents(
    runId,
    manual.map((event) => event.eventId),
  );
  app.audit((store) => {
    expect(store.listEvents(runId)).toEqual(history.events);
    expect(store.getRun(runId)).toEqual(final.run);
    expect(store.listTasks(runId)).toEqual(final.tasks);
    expect(
      store
        .listAttempts(runId)
        .map((attempt) => store.getReport(attempt.attemptId))
        .filter(Boolean),
    ).toEqual(reports);
    expect(store.getRun(alternate.runId).status).toBe("ready");
  });
});
