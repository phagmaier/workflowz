// Real adapter/bridge, synthetic local OpenCode server. No installed harness or provider.
import { readFileSync } from "node:fs";
import path from "node:path";
import { noSideScroll, pairApp, shot, watchPolicy } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

test.use({ scenario: "opencode-reset" });

const WORKFLOW = `version: 1
name: Technical failure attribution
project: {root: .}
start: foundation
steps:
  foundation:
    kind: agent
    harness: opencode
    model: fixture/offline
    session: fresh
    prompt: Exercise the offline transport
    timeout_seconds: 10
    outcomes: [complete, blocked]
    on:
      complete: {goto: done}
      blocked: {pause: true}
  done: {kind: end}
`;

test("a real bridge connection reset keeps its safe cause from settlement to the run heading and output", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { runId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, `#/runs/${runId}`);
  await page.getByRole("button", { name: "Start run", exact: true }).press("Enter");
  await app.until(runId, (state) => state.run.status === "paused" && !state.activeAttempt);
  const overview = page.getByRole("region", { name: "Run overview", exact: true });
  await expect(overview).toContainText("technical failure");
  await expect(overview).toContainText("ECONNRESET");
  await expect(overview).not.toContainText("reported");
  await expect(overview).not.toContainText("provider failed");
  const step = page.getByRole("region", { name: "Foundation", exact: true });
  await expect(step).toContainText("Technical failure");
  await expect(step).toContainText("No agent report was accepted");
  const output = step.getByRole("tab", { name: "Output", exact: true });
  await step.getByRole("tab", { name: "Report", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(output).toBeFocused();
  await expect(step.getByRole("tabpanel", { name: "Output", exact: true })).toContainText(
    "ECONNRESET",
  );
  await expect(step.getByRole("tabpanel", { name: "Output", exact: true })).toContainText(
    "Exit code 1",
  );
  for (const width of [1280, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await noSideScroll(page);
    await shot(page, `failure-reset-${width}`);
  }
  await page.getByRole("link", { name: "Map", exact: true }).click();
  await page.getByRole("button", { name: "Show latest result in history" }).click();
  await expect(page.locator("#detail-title")).toBeFocused();
  await expect(output).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(overview).toContainText("ECONNRESET");
  await expect(step).toContainText("Technical failure");
  const { events } = await app.request({ op: "events", runId, after: 0, limit: 1000 });
  expect(events.filter((event) => event.type === "attempt_started")).toHaveLength(1);
  expect(events.filter((event) => event.type === "invocation_started")).toHaveLength(1);
  const invocation = events.find((event) => event.type === "invocation_settled");
  expect(invocation.data.diagnostics.stderr).toContain("OpenCode bridge failed (ECONNRESET).");
  expect(invocation.data.exitCode).toBe(1);
  expect(await app.request({ op: "reports", runId })).toEqual([]);
  const capture = JSON.parse(readFileSync(path.join(app.root, "opencode-capture.json"), "utf8"));
  expect(capture.requests.filter((request) => request.path === "/api/session")).toHaveLength(1);
  expect(capture.requests.filter((request) => request.path.endsWith("/prompt"))).toHaveLength(1);
  expect(capture.requests.filter((request) => request.path.endsWith("/wait"))).toHaveLength(1);
  expect(app.children).toHaveLength(1);
  await policy();
});

test.describe("a report followed by an unsuccessful terminal execution", () => {
  test.use({ scenario: "opencode-report-error" });

  test("keeps the accepted report distinct from the technical result even at exit zero", async ({
    page,
    app,
  }) => {
    const policy = await watchPolicy(page);
    const { runId } = await app.seed({ workflowText: WORKFLOW });
    await pairApp(page, app, `#/runs/${runId}`);
    await page.getByRole("button", { name: "Start run", exact: true }).press("Enter");
    await app.until(runId, (state) => state.run.status === "paused" && !state.activeAttempt);
    const overview = page.getByRole("region", { name: "Run overview", exact: true });
    await expect(overview).toContainText("technical failure");
    await expect(overview).toContainText("harness did not confirm successful execution");
    await expect(overview).not.toContainText("provider failed");
    await expect(overview).not.toContainText("reported");
    const step = page.getByRole("region", { name: "Foundation", exact: true });
    await expect(step).toContainText("An agent report was accepted before the execution failed");
    await expect(step).toContainText("Fake agent result");
    await expect(step).not.toContainText("No agent report was accepted");
    await expect(step).not.toContainText("provider failed");
    await step.getByRole("tab", { name: "Output", exact: true }).click();
    await expect(step.getByRole("tabpanel", { name: "Output", exact: true })).toContainText(
      "Exit code 0",
    );
    await expect(step).toContainText("Technical failure");
    await noSideScroll(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, "failure-report-exit-zero");
    const { events } = await app.request({ op: "events", runId, after: 0, limit: 1000 });
    expect(events.filter((event) => event.type === "invocation_started")).toHaveLength(1);
    const settled = events.find((event) => event.type === "attempt_settled");
    expect(settled.data.outcome).toBe("system.process_error");
    expect(settled.data.detail).toBe("the harness did not confirm successful execution");
    expect(await app.request({ op: "reports", runId })).toHaveLength(1);
    await policy();
  });
});
