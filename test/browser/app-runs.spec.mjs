// New React app (/ui/): pairing, Runs, Run details and Map against the offline fake daemon.

import { shot, WORKFLOW, watchPolicy } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

test.use({ scenario: "gate" });

test("pair, follow a run from ready to completed, read history and the map", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const mutations = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/ui/api") || request.method() !== "POST") return;
    const body = request.postDataJSON();
    if (["start", "pause", "stop", "resume", "override"].includes(body.op)) mutations.push(body);
  });

  // Pairing: malformed and superseded codes are refused at the form and never kept in it.
  const first = await app.request({ op: "browser-access" });
  const second = await app.request({ op: "browser-access" });
  await page.goto(`${app.url}/ui/`);
  const code = page.getByLabel("Pairing code");
  await expect(code).toBeFocused();
  await shot(page, "01-pairing");
  await code.fill("not-a-code");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("doesn't look like a pairing code");
  await code.fill(first.code);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("That code didn't work");
  await expect(code).toHaveValue("");
  await expect(code).toBeFocused();
  await expect(page.locator("body")).not.toContainText(first.code);
  await code.fill(second.code);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Runs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No runs yet" })).toBeVisible();
  await shot(page, "02-runs-empty");

  // A run created elsewhere appears without reloading.
  const { runId } = await app.seed({ workflowText: WORKFLOW });
  const link = page.getByRole("main").getByRole("link", { name: "Implement and review" });
  await expect(link).toBeVisible();
  await expect(page.getByRole("row", { name: /Ready/ })).toContainText(runId);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`#/runs/${runId}$`));
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toContainText("Ready to start");
  await expect(heading).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(
    `Implement and review · ${runId}`,
  );
  const controls = page.getByRole("region", { name: "Run controls" });
  await expect(controls).toContainText("unrestricted permissions");
  await expect(controls).toContainText("dangerously-bypass-approvals-and-sandbox");
  await expect(controls).toContainText("default-unrestricted-tools");
  const plan = page.getByRole("region", { name: "What will run" });
  await expect(plan).toContainText("Work");
  await expect(plan).toContainText("blocked → pause for you");
  // Task text is inert text, never markup.
  await expect(plan).toContainText("<img src=x onerror=alert(1)> task");
  await expect(page.locator("main img")).toHaveCount(0);
  await shot(page, "03-run-ready");

  // Map is a separate tab with browser history.
  await page.getByRole("link", { name: "Map", exact: true }).click();
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.locator("svg.map g.node")).toHaveCount(5);
  await expect(page.locator("svg.map")).toContainText("start");
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#/runs/${runId}$`));
  await expect(plan).toBeVisible();

  const ready = await app.status(runId);
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(heading).toContainText("Paused — Work needs your decision");
  expect(mutations).toEqual([{ op: "start", runId, expectedEventId: ready.expectedEventId }]);
  await expect(page.getByRole("link", { name: /Waiting for you\s*1/ })).toBeVisible();
  await expect(page.locator(".lede").first()).toContainText(
    "Work reported “blocked”: Fake agent result",
  );
  const detail = page.getByRole("region", { name: "Work", exact: true });
  await expect(detail).toContainText("Fake agent result");
  await expect(detail).toContainText("Paused — the workflow pauses on “blocked”");
  await expect(detail).toContainText("Codex · offline-model");

  // Raw events open on demand, without private runtime paths.
  await detail.getByRole("button", { name: /Technical details/ }).click();
  const raw = detail.getByLabel("Event evidence");
  await expect(raw).toContainText("invocation_started");
  await expect(raw).toContainText("(private path, not shown)");
  await expect(raw).not.toContainText("/logs/");
  await expect(raw).not.toContainText(app.root);
  await shot(page, "04-run-paused");

  // Keyboard: arrow keys move between choices, Tab enters the chosen choice's form.
  const choices = page.getByRole("group", { name: "What should happen next?" });
  await choices.getByRole("radio").first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(choices.getByRole("radio", { name: /Decide Work's result yourself/ })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Work's result", { exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("ArrowUp");
  const resume = choices.getByRole("radio", { name: /Resume — run Work again/ });
  await expect(resume).toBeChecked();
  await expect(choices).toContainText("Agents keep unrestricted permissions");
  const reason = page.getByLabel(/^Reason/);
  await page.keyboard.press("Tab");
  await expect(reason).toBeFocused();
  await page.getByRole("button", { name: "Resume run", exact: true }).click();
  await expect(reason).toBeFocused();
  expect(await reason.evaluate((input) => input.validationMessage)).toContain("Add a reason");
  expect(mutations).toHaveLength(1);

  const paused = await app.status(runId);
  await reason.fill("Requirement clarified");
  await page.getByRole("button", { name: "Resume run", exact: true }).click();
  await expect(heading).toContainText("Completed — All tasks done");
  expect(mutations[1]).toEqual({
    op: "resume",
    runId,
    expectedEventId: paused.expectedEventId,
    reason: "Requirement clarified",
  });
  const history = page.getByRole("region", { name: "What happened" });
  const task1 = history.getByRole("button", { name: /^Task 1:/ });
  await expect(task1).toHaveAttribute("aria-expanded", "false");
  await task1.click();
  await history.getByRole("button", { name: /Resumed/ }).click();
  await expect(page.getByRole("region", { name: "Resumed", exact: true })).toContainText(
    "Requirement clarified",
  );
  await expect(history.getByRole("button", { name: /^Task 1:/ })).toBeVisible();
  await expect(history.getByRole("button", { name: /^Task 2: second browser task/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Waiting for you\s*[1-9]/ })).toHaveCount(0);
  await shot(page, "05-run-completed");

  // Selecting an earlier step shows its result; arrow keys walk the history.
  const steps = history.locator("button.hist");
  await steps.first().click();
  await expect(steps.first()).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("ArrowDown");
  await expect(steps.nth(1)).toBeFocused();
  await expect(steps.nth(1)).toHaveAttribute("aria-current", "true");

  await page.getByRole("link", { name: "Map", exact: true }).click();
  const work = page.locator('svg.map g.node[data-step="work"]');
  await expect(work).toContainText("×3");
  await expect(page.locator("svg.map g.edge.walked")).not.toHaveCount(0);
  await work.click();
  await expect(page.getByRole("region", { name: "Work", exact: true })).toContainText(
    "Ran 3 times in this run.",
  );
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('svg.map g.node[data-step="review"]')).toBeFocused();
  await shot(page, "06-run-map");
  await page.getByRole("button", { name: "Show latest result in history" }).click();
  await expect(page).toHaveURL(new RegExp(`#/runs/${runId}$`));
  await expect(page.getByRole("region", { name: "Review", exact: true })).toContainText(
    "Fake agent result",
  );

  await page.getByRole("link", { name: "Runs", exact: true }).first().click();
  await page.getByRole("button", { name: /^Finished/ }).click();
  await expect(page.getByRole("row", { name: /Completed/ })).toContainText(runId);
  await page.getByRole("button", { name: /^Needs attention/ }).click();
  await expect(page.getByText("No runs match")).toBeVisible();
  await page.getByRole("link", { name: "Workflows", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Implement and review" })).toBeVisible();
  await policy();
});
