// Exact owner artifact, real commands, scripted agent only. Never calls an installed harness.
import { cpSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { noSideScroll, pairApp, shot, watchPolicy } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

test.use({ scenario: "owner-walkthrough" });
const material = fileURLToPath(new URL("../fixtures/owner-walkthrough/", import.meta.url));

test("owner walkthrough imports the reviewed model, pauses, and creates a receipt only after Apply then Resume", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  cpSync(path.join(material, "project"), path.join(app.root, "project"), { recursive: true });
  const projectFile = (name) => path.join(app.root, "project", name);
  const mutations = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/ui/api")) return;
    const body = request.postDataJSON();
    if (
      [
        "save",
        "create",
        "start",
        "override",
        "resume",
        "pause",
        "stop",
        "revise",
        "recover",
      ].includes(body?.op)
    )
      mutations.push(body.op);
  });
  await pairApp(page, app, "#/workflows/import");
  await page.getByLabel("Workflow YAML file").setInputFiles(path.join(material, "workflow.yaml"));
  await page.getByLabel("Workflow folder").fill(app.root);
  await page.getByRole("button", { name: "Open draft" }).click();
  const graph = page.getByRole("region", { name: "Workflow graph", exact: true });
  await expect(graph).toBeVisible();
  const checker = page.getByRole("complementary", { name: "Checker", exact: true });
  await expect(checker).toContainText("Finish");
  await expect(checker).toContainText("Done");
  await page.getByRole("link", { name: "Form", exact: true }).click();
  const form = page.getByRole("region", { name: "Form editor", exact: true });
  await form.getByRole("button", { name: "Configure Edit greeting", exact: true }).press("Enter");
  const settings = page.getByRole("region", { name: "Selected step", exact: true });
  await expect(settings.getByLabel("Agent", { exact: true })).toHaveValue("opencode");
  await expect(settings.getByLabel("Model", { exact: true })).toHaveValue(
    "opencode/deepseek-v4.1-flash-free",
  );
  expect(mutations).toEqual([]);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Saved as revision \d+\. No run was created\./)).toBeVisible();
  expect(await app.request({ op: "runs" })).toEqual([]);
  await page.getByRole("button", { name: "Create run…", exact: true }).click();
  await page
    .getByRole("region", { name: "Create a run" })
    .getByRole("button", { name: "Create run", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Ready to start");
  const runId = page.url().split("#/runs/")[1];
  expect((await app.status(runId)).activeAttempt).toBeNull();
  expect(app.children).toHaveLength(0);
  expect(readFileSync(projectFile("greeting.txt"), "utf8")).toBe("Hello from Workflowz.\n");
  await expect(page.getByRole("region", { name: "What will run" })).toContainText(
    "OpenCode · deepseek-v4.1-flash-free",
  );
  await shot(page, "owner-ready-desktop");
  await page.getByRole("link", { name: "Map", exact: true }).click();
  await expect(page.locator("svg.map g.node")).toHaveCount(5);
  await page.getByRole("link", { name: "History", exact: true }).click();
  expect(app.children).toHaveLength(0);
  await page.getByRole("button", { name: "Start run", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Paused");
  const paused = await app.until(
    runId,
    (state) => state.run.status === "paused" && state.activeAttempt === null,
  );
  expect(paused.run.cursorStepId).toBe("checkpoint");
  const history = page.getByRole("region", { name: "What happened" });
  await history.getByRole("button", { name: /Baseline.*complete/ }).click();
  await expect(page.getByRole("region", { name: "Baseline", exact: true })).toContainText(
    "BASELINE OK",
  );
  await history.getByRole("button", { name: /Edit greeting.*complete/ }).click();
  const agent = page.getByRole("region", { name: "Edit greeting", exact: true });
  await expect(agent.getByRole("tab", { name: "Report", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(agent).toContainText("Fake agent result");
  await agent.getByRole("tab", { name: "Output", exact: true }).press("Enter");
  await expect(agent.getByRole("tab", { name: "Output", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await history.getByRole("button", { name: /Checkpoint.*complete/ }).click();
  await expect(page.getByRole("region", { name: "Checkpoint", exact: true })).toContainText(
    "CHANGE OK",
  );
  expect(readFileSync(projectFile("greeting.txt"), "utf8")).toBe(
    "Hello from Workflowz and OpenCode.\n",
  );
  expect(readFileSync(projectFile("check.mjs"), "utf8")).toBe(
    readFileSync(path.join(material, "project/check.mjs"), "utf8"),
  );
  expect(existsSync(projectFile("receipt.txt"))).toBe(false);
  await page.getByRole("link", { name: "Map", exact: true }).click();
  await page.locator('svg.map [data-step="edit_greeting"]').click();
  await page.getByRole("button", { name: "Show latest result in history" }).click();
  await expect(page.locator("#detail-title")).toBeFocused();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await noSideScroll(page);
    await shot(page, `owner-paused-${width}`);
  }
  const choices = page.getByRole("group", { name: "What should happen next?" });
  await choices.getByRole("radio", { name: /^Continue from another step/ }).check();
  await page.getByLabel("Continue at", { exact: true }).selectOption("finish");
  const reason = page.getByLabel(/^Reason \(saved/);
  await reason.fill("Inspected greeting and accepted the change");
  await reason.press("Tab");
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Paused — next step is Finish",
  );
  await expect(reason).toBeFocused();
  expect((await app.status(runId)).activeAttempt).toBeNull();
  expect(existsSync(projectFile("receipt.txt"))).toBe(false);
  expect(mutations).toEqual(["save", "create", "start", "override"]);
  await page.getByRole("button", { name: "Resume run", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Completed");
  await history.getByRole("button", { name: /Finish.*complete/ }).click();
  await expect(page.getByRole("region", { name: "Finish", exact: true })).toContainText(
    "FINISH OK",
  );
  expect(readFileSync(projectFile("receipt.txt"), "utf8")).toBe(
    "Owner resumed; greeting verified.\n",
  );
  expect(app.children.filter((child) => child.harness === "opencode")).toHaveLength(1);
  expect(mutations).toEqual(["save", "create", "start", "override", "resume"]);
  const overview = page.getByRole("region", { name: "Run overview", exact: true });
  for (const width of [1280, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(overview.getByRole("link", { name: "View map", exact: true })).toBeInViewport();
    await noSideScroll(page);
    await shot(page, `owner-completed-${width}`);
  }
  // The summary gives a keyboard path directly into the run's map, then back to its results.
  await overview.getByRole("link", { name: "View map", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Run map", exact: true })).toBeFocused();
  await noSideScroll(page);
  await shot(page, "owner-completed-map-mobile");
  await page.keyboard.press("Tab");
  await expect(page.locator('svg.map [data-step="baseline"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('svg.map [data-step="edit_greeting"]')).toBeFocused();
  await overview.getByRole("link", { name: "View results", exact: true }).press("Enter");
  await expect(page.getByRole("region", { name: "Run results", exact: true })).toBeFocused();
  await expect(page.getByRole("region", { name: "Finish", exact: true })).toContainText(
    "FINISH OK",
  );
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#/runs/${runId}/map$`));
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`#/runs/${runId}$`));
  await overview.getByRole("link", { name: "View map", exact: true }).click();
  await page.locator('svg.map [data-step="finish"]').click();
  await page.getByRole("button", { name: "Show latest result in history" }).click();
  await expect(page.getByRole("region", { name: "Finish", exact: true })).toContainText(
    "FINISH OK",
  );
  const side = page.getByRole("navigation", { name: "Main", exact: true });
  await side.getByRole("link", { name: "Finished 1", exact: true }).press("Enter");
  const finished = page.getByRole("row", { name: /Completed/ });
  await expect(finished).toContainText(runId);
  for (const width of [1280, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await noSideScroll(page);
    await shot(page, `owner-finished-${width}`);
  }
  await page.locator("#runs-finished").focus();
  await page.keyboard.press("Tab"); // workflow name
  await page.keyboard.press("Tab"); // results
  const results = finished.getByRole("link", {
    name: `View results for run ${runId}`,
    exact: true,
  });
  await expect(results).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    finished.getByRole("link", { name: `View map for run ${runId}`, exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#/runs/${runId}/map$`));
  await expect(page.locator("svg.map g.node")).toHaveCount(5);
  await page.reload();
  await expect(page.locator("svg.map g.node")).toHaveCount(5);
  await page.goBack();
  await expect(page.locator("#runs-finished")).toBeFocused();
  await results.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#/runs/${runId}$`));
  await expect(page.getByRole("region", { name: "Finish", exact: true })).toContainText(
    "FINISH OK",
  );
  expect(mutations).toEqual(["save", "create", "start", "override", "resume"]);
  await policy();
  if (process.env.WF_OWNER_REVIEW === "1") {
    // Opt-in headed walkthrough: Resume in the Inspector lets the fixture tear down normally.
    await page.setViewportSize({ width: 1280, height: 900 });
    await side.getByRole("link", { name: "Finished 1", exact: true }).click();
    await expect(finished).toContainText(runId);
    console.log("OWNER-1 ready at Finished. Use the browser; Resume in Inspector to clean up.");
    await page.pause();
  }
});
