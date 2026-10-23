import { parse } from "yaml";
import { noSideScroll, pairApp, shot, WORKFLOW, watchPolicy } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

test.use({ scenario: "gate" });

const SIMPLE = `version: 1
name: Form authoring
project: {root: .}
start: work
steps:
  work:
    kind: agent
    harness: codex
    session: fresh
    prompt: Work on the project
    outcomes: [complete, blocked]
    on: {complete: {goto: done}, blocked: {pause: true}}
  done: {kind: end}
`;
const COMMAND = `version: 1
name: Command authoring
project: {root: .}
start: command
steps:
  command:
    kind: command
    argv: [node, --version]
    on: {complete: {goto: done}, failed: {pause: true}}
  done: {kind: end}
`;

test("Form shows steps and outcomes beside settings; checker fixes and keyboard navigation keep the same editor", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { revisionId } = await app.seed({
    workflowText: WORKFLOW.replace(
      "start: pick",
      "limits: {max_step_executions: 100}\nstart: pick",
    ),
  });
  await pairApp(page, app, `#/workflows/${revisionId}`);
  const steps = page.getByRole("region", { name: "Steps", exact: true });
  const form = page.getByRole("region", { name: "Selected step", exact: true });
  const checker = page.getByRole("complementary", { name: "Checker", exact: true });
  const work = steps.getByRole("button", { name: "Configure Work", exact: true });
  await expect(steps.getByRole("row")).toHaveCount(6);
  await work.focus();
  await work.press("Enter");
  await expect(work).toBeFocused();
  await expect(work).toHaveAttribute("aria-current", "true");
  await form.locator(".form-inspector-content").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await steps.getByRole("button", { name: "Configure Review", exact: true }).click();
  await expect(form.locator(".form-inspector-content")).toHaveJSProperty("scrollTop", 0);
  await work.press("Enter");
  await expect(form.locator(".form-inspector-content")).toHaveJSProperty("scrollTop", 0);
  const emptySpace = await page.evaluate(() => {
    const end = document.querySelector(".page").getBoundingClientRect().bottom + window.scrollY;
    return document.documentElement.scrollHeight - Math.max(end, window.innerHeight);
  });
  expect(emptySpace).toBeLessThanOrEqual(1);
  const tableBounds = await steps.boundingBox();
  const formBounds = await form.boundingBox();
  expect(formBounds.x).toBeGreaterThanOrEqual(tableBounds.x + tableBounds.width);
  await expect(checker).toContainText("All good");
  await shot(page, "f01-form-desktop");
  await steps.getByRole("button", { name: /Work: blocked →/ }).press("Enter");
  await expect(form.getByLabel("When the outcome is blocked, then")).toBeFocused();
  await form.getByLabel("Prompt text").fill("");
  await steps.getByRole("button", { name: "Configure Review", exact: true }).click();
  await checker.getByRole("button", { name: /Fix: Work: write a prompt/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/workflows/${revisionId}$`));
  await expect(form.getByLabel("Prompt text")).toBeFocused();
  await form.getByLabel("Prompt text").fill("Keep the repaired prompt");
  await expect(checker).toContainText("All good");
  await page.setViewportSize({ width: 390, height: 844 });
  await steps.getByRole("button", { name: "Configure Review", exact: true }).press("Enter");
  await expect(form.getByRole("heading", { level: 2 })).toBeFocused();
  await form.getByRole("button", { name: "Back to steps", exact: true }).press("Enter");
  await expect(steps.getByRole("button", { name: "Configure Review", exact: true })).toBeFocused();
  await noSideScroll(page);
  await shot(page, "f02-form-phone");
  expect(app.children).toEqual([]);
  await policy();
});

test("command lines preserve quoted arguments and unfinished input across views, failed checks, and saving", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const { revisionId } = await app.seed({ workflowText: COMMAND });
  await pairApp(page, app, `#/workflows/${revisionId}`);
  const form = page.getByRole("region", { name: "Selected step", exact: true });
  const checker = page.getByRole("complementary", { name: "Checker", exact: true });
  const command = form.getByLabel("Command", { exact: true });
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(command).toHaveValue("node --version");
  await command.fill("node 'unfinished argument");
  await expect(form).toContainText("Close the single quote");
  await expect(save).toBeDisabled();
  // The checker carries the parser's guidance, not the schema's type error, and the field says it once.
  await expect(checker).toContainText("Command · command: Close the single quote.");
  await expect(checker).not.toContainText("expected array");
  await expect(form.getByText("Close the single quote.")).toHaveCount(1);
  await expect(command).toHaveAccessibleDescription("Close the single quote.");
  await expect(command).toHaveClass(/mono/);
  await shot(page, "f03a-command-unfinished");
  await checker.getByRole("button", { name: /^Fix:/ }).click();
  await expect(command).toBeFocused();
  await page.getByRole("link", { name: "Graph", exact: true }).click();
  await page
    .getByRole("region", { name: "Workflow graph", exact: true })
    .getByRole("button", { name: "Configure Command", exact: true })
    .click();
  await expect(command).toHaveValue("node 'unfinished argument");
  await page.getByRole("link", { name: /^Form/ }).click();
  await expect(command).toHaveValue("node 'unfinished argument");
  await page.getByRole("button", { name: "Create run…", exact: true }).click();
  const panel = page.getByRole("region", { name: "Create a run" });
  await expect(panel.getByRole("button", { name: "Create run", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op === "draft") await route.abort("connectionreset");
    else await route.continue();
  });
  const exact = `node -e 'console.log("hello world")' 'argument with spaces' '' 'C:\\tools'`;
  await command.fill(exact);
  await expect(checker).toContainText("Not checked");
  await expect(command).toHaveValue(exact);
  await expect(command).toBeFocused();
  await expect(save).toBeDisabled();
  await page.unroute("**/ui/api");
  await checker.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(save).toBeEnabled();
  await shot(page, "f03-command-line");
  await save.click();
  await expect(page.getByText(/Saved as revision/)).toBeVisible();
  const saved = Number(page.url().match(/#\/workflows\/(\d+)/)[1]);
  const loaded = await page.evaluate(async (revisionId) => {
    const response = await fetch("/ui/api", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workflowz-ui": "1" },
      body: JSON.stringify({ op: "load", source: { revisionId } }),
    });
    if (!response.ok) throw new Error("Saved workflow could not be loaded");
    return response.json();
  }, saved);
  expect(parse(loaded.workflowText).steps.command.argv).toEqual([
    "node",
    "-e",
    'console.log("hello world")',
    "argument with spaces",
    "",
    "C:\\tools",
  ]);
  await command.fill("npm test && npm run build");
  await expect(form).toContainText("Shell operators need an explicit shell");
  await expect(save).toBeDisabled();
  await expect(checker).toContainText("Command · command: Shell operators need an explicit shell");
  await expect(checker).not.toContainText("expected array");
  await command.fill("sh -c 'npm test && npm run build'");
  await expect(save).toBeEnabled();
  expect(app.children).toEqual([]);
  await policy();
});

test("effort preferences persist for each harness, remember custom values, and affect only new or explicitly changed steps", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  page.on("dialog", (dialog) => void dialog.accept());
  const original = SIMPLE.replace(
    "session: fresh",
    "reasoning_effort: existing-custom\n    session: fresh",
  );
  const { revisionId } = await app.seed({ workflowText: original });
  await pairApp(page, app, `#/workflows/${revisionId}`);
  const form = page.getByRole("region", { name: "Selected step", exact: true });
  const effort = form.getByLabel("Reasoning effort", { exact: true });
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(effort).toHaveValue("existing-custom");
  await form.getByText("Effort defaults", { exact: true }).click();
  await form.getByLabel("Codex default effort", { exact: true }).fill("xhigh");
  await form.getByLabel("Claude Code default effort", { exact: true }).fill("high");
  await form.getByLabel("OpenCode default effort", { exact: true }).fill("custom-variant");
  await form.getByLabel("Pi default effort", { exact: true }).fill("medium");
  await form.getByLabel("oh-my-pi default effort", { exact: true }).fill("low");
  await expect(effort).toHaveValue("existing-custom");
  await expect(save).toBeDisabled();
  await shot(page, "f04-effort-defaults");
  await form.getByText("Effort defaults", { exact: true }).click();
  const addAgent = async (name) => {
    await page
      .getByRole("region", { name: "Steps", exact: true })
      .getByRole("button", { name: "＋ Add step", exact: true })
      .click();
    await page.getByLabel("New step name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Add step", exact: true }).click();
    await expect(form.getByRole("heading", { level: 2 })).toBeFocused();
  };
  await addAgent("Investigate");
  await expect(effort).toHaveValue("xhigh");
  await effort.fill("bespoke-effort");
  await form.getByLabel("Prompt text").fill("Investigate the project");
  await form.getByLabel("When the outcome is complete, then").selectOption("goto:done");
  await expect(save).toBeEnabled();
  await page.getByRole("link", { name: "Graph", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Editor views" })
    .getByRole("link", { name: /^Form/ })
    .click();
  await expect(effort).toHaveValue("bespoke-effort");
  await expect(form.locator('datalist[id$="-options"] option[value="bespoke-effort"]')).toHaveCount(
    1,
  );
  await page
    .getByRole("region", { name: "Steps", exact: true })
    .getByRole("button", { name: "Configure Work", exact: true })
    .click();
  await expect(effort).toHaveValue("existing-custom");
  await page.reload();
  await expect(effort).toHaveValue("existing-custom");
  await expect(form.locator('datalist[id$="-options"] option[value="bespoke-effort"]')).toHaveCount(
    1,
  );
  await form.getByText("Effort defaults", { exact: true }).click();
  await expect(form.getByLabel("Codex default effort", { exact: true })).toHaveValue("xhigh");
  await expect(form.getByLabel("OpenCode default effort", { exact: true })).toHaveValue(
    "custom-variant",
  );
  await form.getByText("Effort defaults", { exact: true }).click();
  await form.getByRole("button", { name: "Use my Codex default (xhigh)", exact: true }).click();
  await expect(effort).toHaveValue("xhigh");
  await expect(save).toBeEnabled();
  await addAgent("New after reload");
  await expect(effort).toHaveValue("xhigh");
  await page.goto(`${app.url}/ui/#/workflows/new/single`);
  await page.getByLabel("Name", { exact: true }).fill("Uses my default");
  await page.getByLabel("Project folder", { exact: true }).fill(app.root);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(effort).toHaveValue("xhigh");
  expect((await app.request({ op: "workflows" })).length).toBe(1);
  expect(app.children).toEqual([]);
  await policy();
});

test("long step names and outcomes wrap without page overflow on desktop, tablet, or phone", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const longName = `work_${"long_".repeat(10)}name`;
  const longOutcome = `needs_${"more_".repeat(10)}context`;
  const { revisionId } = await app.seed({
    workflowText: SIMPLE.replaceAll("work", longName).replaceAll("blocked", longOutcome),
  });
  await pairApp(page, app, `#/workflows/${revisionId}`);
  const steps = page.getByRole("region", { name: "Steps", exact: true });
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await noSideScroll(page);
    const overflow = await steps
      .getByRole("cell")
      .evaluateAll((cells) => cells.some((cell) => cell.scrollWidth > cell.clientWidth));
    expect(overflow).toBe(false);
    await shot(page, `f05-form-long-labels-${width}`);
  }
  expect(app.children).toEqual([]);
  await policy();
});

test("unavailable browser storage keeps effort input usable and reports preferences held only in the tab", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("Offline fixture storage is unavailable");
    };
    Storage.prototype.setItem = () => {
      throw new Error("Offline fixture storage is unavailable");
    };
  });
  const { revisionId } = await app.seed({ workflowText: SIMPLE });
  await pairApp(page, app, `#/workflows/${revisionId}`);
  const form = page.getByRole("region", { name: "Selected step", exact: true });
  await form.getByLabel("Reasoning effort", { exact: true }).fill("high");
  await form.getByText("Effort defaults", { exact: true }).click();
  await expect(form).toContainText("They are kept for this tab");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  expect(app.children).toEqual([]);
  await policy();
});
