import { noSideScroll, pairApp, shot, WORKFLOW, watchPolicy } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

test.use({ scenario: "gate" });

async function importText(page, app, text) {
  await page
    .getByLabel("Workflow YAML file")
    .setInputFiles({ name: "graph.yaml", mimeType: "text/yaml", buffer: Buffer.from(text) });
  await page.getByLabel("Workflow folder").fill(app.root);
  await page.getByRole("button", { name: "Open draft" }).click();
}

test("fourth-outcome self loops and returns to the first column fit inside the graph canvas", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  await pairApp(page, app, "#/workflows/import");
  const text = WORKFLOW.replace("start: pick", "limits: {max_step_executions: 100}\nstart: work")
    .replaceAll("outcomes: [complete, blocked]", "outcomes: [complete, blocked, third, fourth]")
    .replaceAll(
      "blocked: {pause: true}",
      "blocked: {pause: true}\n      third: {goto: done}\n      fourth: {goto: work}",
    );
  await importText(page, app, text);
  const graph = page.getByRole("region", { name: "Workflow graph", exact: true });
  const checker = page.getByRole("complementary", { name: "Checker", exact: true });
  await expect(checker).toContainText("All good");
  await expect(graph.locator('[data-edge="work:3:work"]')).toHaveClass(/loop/);
  await expect(graph.locator('[data-edge="review:3:work"]')).toHaveClass(/loop/);
  const clippedEdges = () =>
    graph.locator("[data-edge]").evaluateAll((edges) =>
      edges.flatMap((edge) => {
        const box = edge.getBBox();
        const svg = edge.ownerSVGElement;
        const halfStroke = Number.parseFloat(getComputedStyle(edge).strokeWidth) / 2;
        return box.x - halfStroke < 0 ||
          box.y - halfStroke < 0 ||
          box.x + box.width + halfStroke > svg.width.baseVal.value ||
          box.y + box.height + halfStroke > svg.height.baseVal.value
          ? [edge.dataset.edge]
          : [];
      }),
    );
  await expect.poll(clippedEdges).toEqual([]);
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await expect.poll(clippedEdges).toEqual([]);
  await shot(page, "g07-graph-fourth-outcome-returns");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Tidy up" }).press("Enter");
  await expect.poll(clippedEdges).toEqual([]);
  await graph.focus();
  await expect(graph).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await noSideScroll(page);
  await shot(page, "g08-graph-fourth-outcome-returns-phone");
  expect(app.children).toEqual([]);
  await policy();
});

test("graph authors branches, loops and new steps; checker fixes navigate and views share edits", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  await pairApp(page, app, "#/workflows/import");
  await importText(page, app, WORKFLOW);
  await expect(page).toHaveURL(/\/map$/);
  const graph = page.getByRole("region", { name: "Workflow graph", exact: true });
  const checker = page.getByRole("complementary", { name: "Checker", exact: true });
  const panel = page.getByRole("region", { name: "Selected step", exact: true });
  await expect(graph.locator("[data-node]")).toHaveCount(5);
  await expect(graph.locator('[data-edge="finish:0:pick"]')).toHaveClass(/loop/);
  await expect(graph.locator('[data-edge="pick:1:done"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Tidy up" }).click();
  await shot(page, "g01-graph-branches-loop");

  // Warning fix goes to the actual loop limit control, then returns to the same draft.
  await checker.getByRole("button", { name: /Fix: .*repeat forever/ }).click();
  await expect(page.getByRole("heading", { name: "Safety limits", exact: true })).toBeFocused();
  await page.getByLabel("Maximum step executions", { exact: false }).fill("100");
  await page.getByRole("link", { name: "Graph", exact: true }).click();
  await expect(checker).toContainText("All good");

  // All graph controls work without a pointer; selecting an outcome focuses its destination.
  const blocked = graph.getByRole("button", { name: /Work: blocked →/ });
  await blocked.press("Enter");
  const destination = panel.getByLabel("When the outcome is blocked, then");
  await expect(destination).toBeFocused();
  await destination.selectOption("goto:review");
  await expect(graph.locator('[data-edge="work:1:review"]')).toHaveCount(1);
  await destination.selectOption("goto:work");
  await expect(graph.locator('[data-edge="work:1:work"]')).toHaveClass(/loop/);
  await expect(checker).toContainText("All good");

  // An added outcome is visible on the node immediately, even while invalid.
  await panel.getByLabel("New outcome name").fill("needs information");
  await panel.getByRole("button", { name: "Add outcome", exact: true }).click();
  await expect(
    graph.getByRole("button", { name: /Work: needs_information → Choose destination/ }),
  ).toBeVisible();
  await expect(checker).toContainText("choose what happens after “needs_information”");
  await panel.getByRole("button", { name: "Close settings" }).click();
  await checker.getByRole("button", { name: /Fix: Work: choose.*needs_information/ }).click();
  await expect(panel.getByLabel("When the outcome is needs_information, then")).toBeFocused();
  await panel.getByLabel("When the outcome is needs_information, then").selectOption("goto:done");
  await expect(checker).toContainText("All good");

  // Deletion preserves references so missing destinations remain visible and repairable.
  await graph.getByRole("button", { name: "Configure Review", exact: true }).click();
  await panel.getByRole("button", { name: "Delete", exact: true }).click();
  await panel.getByRole("button", { name: "Delete step", exact: true }).click();
  await expect(
    graph.getByRole("button", { name: /Work: complete → Missing: Review/ }),
  ).toBeVisible();
  await shot(page, "g06-graph-missing-destination");
  await checker.getByRole("button", { name: /Fix: Work:.*doesn't exist/ }).click();
  await expect(panel.getByLabel("When the outcome is complete, then")).toBeFocused();
  await panel.getByLabel("When the outcome is complete, then").selectOption("goto:finish");
  await expect(checker).toContainText("All good");
  await shot(page, "g02-graph-settings");

  // Creating a step selects it; blank prompts remain editable while the daemon rejects them.
  await page.getByRole("button", { name: "＋ Add step", exact: true }).click();
  await page.getByLabel("New step name").fill("Investigate");
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Investigate");
  await expect(panel.getByRole("heading", { level: 2 })).toBeFocused();
  await checker.getByRole("button", { name: /Fix: Investigate: write a prompt/ }).click();
  await expect(panel.getByLabel("Prompt text")).toBeFocused();
  await panel.getByLabel("Prompt text").fill("Investigate the issue");
  await panel.getByLabel("When the outcome is complete, then").selectOption("goto:done");
  await graph.getByRole("button", { name: /Work: blocked →/ }).click();
  await panel.getByLabel("When the outcome is blocked, then").selectOption("goto:investigate");
  await expect(checker).toContainText("All good");

  await page.getByRole("link", { name: "Form", exact: true }).click();
  await expect(panel.getByLabel("When the outcome is blocked, then")).toHaveValue(
    "goto:investigate",
  );
  await page.getByRole("link", { name: "YAML", exact: true }).click();
  await expect(page.locator("pre.yaml")).toContainText("goto: investigate");
  await expect(page.locator("pre.yaml")).toContainText("Investigate the issue");
  await page.getByRole("link", { name: "Graph", exact: true }).click();
  await noSideScroll(page);
  expect(app.children).toEqual([]);
  await policy();
});

test("long graph labels wrap, narrow screens scroll locally, and invalid imports stay repairable", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  await pairApp(page, app, "#/workflows/import");
  const invalid = "# keep this while repairing\nsteps: [\n";
  await importText(page, app, invalid);
  const yaml = page.getByLabel("Workflow YAML", { exact: true });
  await expect(yaml).toHaveValue(invalid);
  const checker = page.getByRole("complementary", { name: "Checker", exact: true });
  await checker.getByRole("button", { name: /^Fix:/ }).first().click();
  await expect(yaml).toBeFocused();
  const longId = `review_${"very_long_".repeat(5)}step`;
  const longOutcome = `needs_${"more_".repeat(9)}context`;
  const text = WORKFLOW.replaceAll("review", longId).replaceAll("blocked", longOutcome);
  await yaml.fill(text);
  await page.getByRole("button", { name: "Return to visual editor" }).click();
  await page.getByRole("link", { name: "Graph", exact: true }).click();
  await page.getByRole("button", { name: "Tidy up" }).click();
  await shot(page, "g03-graph-long-labels");
  const graph = page.getByRole("region", { name: "Workflow graph", exact: true });
  const overflow = await graph
    .locator("[data-node]")
    .evaluateAll((nodes) => nodes.some((node) => node.scrollWidth > node.clientWidth));
  expect(overflow).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await graph.getByRole("button", { name: "Configure Work", exact: true }).press("Enter");
  const panel = page.getByRole("region", { name: "Selected step", exact: true });
  await expect(panel.getByRole("heading", { level: 2 })).toBeFocused();
  await noSideScroll(page);
  await shot(page, "g04-graph-phone-settings");
  await panel.getByRole("button", { name: "Close settings" }).press("Enter");
  await expect(graph.getByRole("button", { name: "Configure Work", exact: true })).toBeFocused();
  await graph.focus();
  await page.keyboard.press("ArrowRight");
  await noSideScroll(page);
  await shot(page, "g05-graph-phone");
  expect(app.children).toEqual([]);
  await policy();
});

test("parsed imports with missing destinations stay visual; failed and late checks keep graph input and focus", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  await pairApp(page, app, "#/workflows/import");
  await importText(page, app, WORKFLOW.replace("goto: review", "goto: missing"));
  await expect(page).toHaveURL(/\/map$/);
  const checker = page.getByRole("complementary", { name: "Checker", exact: true });
  const graph = page.getByRole("region", { name: "Workflow graph", exact: true });
  const panel = page.getByRole("region", { name: "Selected step", exact: true });
  await checker.getByRole("button", { name: /Fix: Work:.*doesn't exist/ }).click();
  const destination = panel.getByLabel("When the outcome is complete, then");
  await expect(destination).toBeFocused();
  await destination.selectOption("goto:review");
  await expect(checker).not.toContainText("doesn't exist");

  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op === "draft" && first) {
      first = false;
      await held;
    }
    await route.continue();
  });
  const prompt = panel.getByLabel("Prompt text");
  const sent = page.waitForRequest((r) => r.postDataJSON()?.op === "draft");
  await prompt.fill("Earlier graph prompt");
  await sent;
  await expect(checker).toContainText("Checking latest changes");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await prompt.fill("Newest graph prompt");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  const response = page.waitForResponse(
    (r) => r.request().postDataJSON()?.model?.steps?.work?.prompt === "Earlier graph prompt",
  );
  release();
  await response;
  await expect(prompt).toHaveValue("Newest graph prompt");
  await expect(prompt).toBeFocused();
  await page.unroute("**/ui/api");
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op === "draft") await route.abort("connectionreset");
    else await route.continue();
  });
  await prompt.fill("Keep this through a failed check");
  await expect(checker).toContainText("Not checked");
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveValue("Keep this through a failed check");
  await expect(graph.getByRole("button", { name: /Work: complete → Go to Review/ })).toBeVisible();
  await page.unroute("**/ui/api");
  await checker.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await page.getByRole("link", { name: "YAML", exact: true }).click();
  await expect(page.locator("pre.yaml")).toContainText("Keep this through a failed check");
  expect(app.children).toEqual([]);
  await policy();
});

test("checker navigates first-step and project problems and reveals advanced fields", async ({
  page,
  app,
}) => {
  await pairApp(page, app, "#/workflows/import");
  await importText(page, app, WORKFLOW.replace("start: pick", "start: missing"));
  const checker = page.getByRole("complementary", { name: "Checker", exact: true });
  await checker.getByRole("button", { name: /Fix: The first step/ }).click();
  await expect(page.getByLabel("Runs first", { exact: true })).toBeFocused();
  await page.getByLabel("Runs first", { exact: true }).selectOption("pick");
  await page.getByRole("link", { name: "Project", exact: true }).click();
  await page.getByLabel("Project folder", { exact: true }).fill(`${app.root}/missing-folder`);
  await page.getByRole("link", { name: "Graph", exact: true }).click();
  await checker.getByRole("button", { name: /Fix: Project folder/ }).click();
  await expect(page.getByLabel("Project folder", { exact: true })).toBeFocused();
  await page.getByLabel("Project folder", { exact: true }).fill(app.root);
  await page.getByRole("link", { name: "Graph", exact: true }).click();
  await page.getByRole("button", { name: "Configure Work", exact: true }).click();
  const panel = page.getByRole("region", { name: "Selected step", exact: true });
  await panel.getByText("Advanced", { exact: false }).click();
  await panel.getByLabel("Time limit (seconds)", { exact: true }).fill("later");
  await panel.getByText("Advanced", { exact: false }).click();
  await checker.getByRole("button", { name: /Fix: Work.*time limit/ }).click();
  await expect(panel.getByLabel("Time limit (seconds)", { exact: true })).toBeFocused();
  await expect(panel.getByLabel("Time limit (seconds)", { exact: true })).toHaveValue("later");
  expect(app.children).toEqual([]);
});
