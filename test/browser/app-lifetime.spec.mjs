// New app: browser loss, disconnection and session end never affect daemon-owned execution.
import { pairApp, shot, watchPolicy } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

test.use({ scenario: "lifetime" });

const FLOW = `version: 1
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
`;

test("disconnection, an ended session and closing the page leave the run going", async ({
  page,
  context,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { runId } = await app.seed({ workflowText: FLOW });
  await pairApp(page, app, `#/runs/${runId}`);
  const heading = page.getByRole("heading", { level: 1 });
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(heading).toContainText("Running — Work");
  const pause = page.getByRole("button", { name: "Pause after this step", exact: true });
  await expect(pause).toBeEnabled();
  await expect(page.getByRole("region", { name: "Work", exact: true })).toContainText("Running.");
  const running = await app.until(runId, (s) => s.activeAttempt?.pid && s.latestReport);
  const attemptId = running.activeAttempt.attemptId;
  process.kill(running.activeAttempt.pid, 0);
  await page.getByText("Accepted report", { exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Work", exact: true }).locator("pre.raw"),
  ).toContainText(attemptId);
  // Reload keeps the hash and cookie while the already-reported child is still settling.
  await page.reload();
  await expect(heading).toContainText("Running — Work");
  const afterReload = await app.status(runId);
  expect(afterReload.activeAttempt.attemptId).toBe(attemptId);
  expect(afterReload.activeAttempt.pid).toBe(running.activeAttempt.pid);
  process.kill(afterReload.activeAttempt.pid, 0);

  // Lost connection: reads fail, actions are disabled, and the page recovers by itself.
  await page.route("**/ui/api", (route) => route.abort());
  await expect(
    page.getByRole("alert").filter({ hasText: "Lost connection to the daemon." }),
  ).toBeVisible();
  await expect(pause).toBeDisabled();
  await expect(heading).toContainText("Running — Work");
  await page.unroute("**/ui/api");
  await expect(page.getByText("Lost connection to the daemon.")).toHaveCount(0);
  await expect(pause).toBeEnabled();

  // Another pairing replaces this browser's session; the page says so and asks to pair again.
  const issued = await app.request({ op: "browser-access" });
  const paired = await fetch(`${app.url}/ui/pair`, {
    method: "POST",
    headers: { origin: app.url, "content-type": "application/json", "x-workflowz-ui": "1" },
    body: JSON.stringify({ code: issued.code }),
  });
  expect(paired.status).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "Your browser session ended" }),
  ).toBeVisible();
  expect((await app.status(runId)).run.status).toBe("running");
  await policy();

  await page.close();
  const unattended = await app.status(runId);
  expect(context.pages()).toEqual([]);
  expect(unattended.run.status).toBe("running");
  expect(unattended.activeAttempt.attemptId).toBe(running.activeAttempt.attemptId);
  await app.release();
  await app.until(runId, (s) => s.run.status === "completed");

  const again = await context.newPage();
  await pairApp(again, app, `#/runs/${runId}`);
  await expect(again.getByRole("heading", { level: 1 })).toContainText("Completed");
  const reports = await app.request({ op: "reports", runId });
  expect(reports.map((r) => r.attemptId)).toEqual([attemptId]);
  app.audit((store) => {
    const attempts = store.listAttempts(runId);
    expect(attempts.map((a) => a.attemptId)).toEqual([attemptId]);
    expect(attempts[0].status).toBe("succeeded");
    expect(store.getReport(attemptId)).toEqual(reports[0]);
    expect(store.getRun(runId).status).toBe("completed");
    expect(store.listEvents(runId).filter((e) => e.type === "attempt_started")).toHaveLength(1);
    expect(store.listTransitions(runId).filter((t) => t.attemptId === attemptId)).toHaveLength(1);
  });
});

// Interrupted and pausing runs cannot be produced offline on demand. Only the status *read* is
// rewritten here, to check their presentation; no control response is ever synthesized.
test("interrupted, pausing and load-error states explain what is known and what to do", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { runId } = await app.seed({ workflowText: FLOW });
  let rewrite = null;
  let failRuns = true;
  await page.route("**/ui/api", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.op === "runs" && failRuns)
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: '{"error":"disk unavailable"}',
      });
    if (body?.op !== "status" || !rewrite) return route.continue();
    const response = await route.fetch();
    return route.fulfill({ response, json: rewrite(await response.json()) });
  });
  await pairApp(page, app);
  await expect(page.getByRole("heading", { name: "Runs couldn't be loaded" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("disk unavailable");
  await shot(page, "s1-runs-error");
  failRuns = false;
  await page.getByRole("button", { name: "Try again now" }).click();
  await expect(page.getByRole("link", { name: "Browser lifetime" })).toBeVisible();

  rewrite = (status) => ({
    ...status,
    run: { ...status.run, status: "interrupted", startTime: status.run.createdAt },
    activeAttempt: {
      attemptId: "attempt_example",
      startedAt: status.run.createdAt,
      recoveryState: "gone",
    },
    attention: [
      {
        itemId: 1,
        severity: "blocking",
        category: "recovery_required",
        message: "the daemon restarted while work was active",
      },
    ],
  });
  await page.goto(`${app.url}/ui/#/runs/${runId}`);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toContainText("Interrupted — needs a recovery decision");
  const recovery = page.getByRole("region", { name: "Recovery" });
  await expect(recovery).toContainText(`wf run recovery ${runId}`);
  await expect(recovery).toContainText("Its process is confirmed gone.");
  await expect(recovery).toContainText("the daemon restarted while work was active");
  await expect(page.getByRole("button", { name: /Start|Resume/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Runs\s*1 needs attention/ })).toHaveCount(0);
  await shot(page, "s2-interrupted");

  rewrite = (status) => ({ ...status, run: { ...status.run, status: "pausing" } });
  await expect(heading).toContainText("Pausing after Work finishes");
  await expect(page.getByRole("region", { name: "Run controls" })).toContainText(
    "Waiting for Work to finish",
  );
  await expect(page.getByRole("button", { name: "Stop run now…" })).toBeVisible();
  await shot(page, "s3-pausing");
  await policy();
});
