// The same authored command is exercised against broken/fixed disposable targets.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { parse, stringify } from "yaml";
import { startAcceptanceTarget } from "../fixtures/browser-acceptance.mjs";
import { pairApp, watchPolicy } from "./app-helpers.mjs";
import { test as base, expect } from "./fixture.mjs";

const test = base.extend({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture dependency argument.
  target: async ({}, use) => {
    const target = await startAcceptanceTarget();
    try {
      await use(target);
    } finally {
      await target.close();
    }
  },
});
const sample = new URL("../../examples/browser-acceptance.yaml", import.meta.url);
const checker = fileURLToPath(
  new URL("../../examples/browser-acceptance/check.mjs", import.meta.url),
);

async function apiAndPageChecks(url) {
  expect((await fetch(url)).status).toBe(200);
  const api = `${url}api/items`;
  const created = await fetch(api, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "API probe", description: "API CRUD works" }),
  });
  expect(created.status).toBe(200);
  const item = await created.json();
  expect(await (await fetch(api)).json()).toContainEqual(item);
  const edited = { ...item, name: "API edited" };
  expect(
    (
      await fetch(`${api}/${item.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(edited),
      })
    ).status,
  ).toBe(200);
  expect(await (await fetch(api)).json()).toContainEqual(edited);
  expect((await fetch(`${api}/${item.id}`, { method: "DELETE" })).status).toBe(200);
  expect(await (await fetch(api)).json()).toEqual([]);
}

for (const [mode, status, outcome] of [
  ["broken", "paused", "failed"],
  ["fixed", "completed", "complete"],
]) {
  test(`${mode}: API/page checks pass and the authored browser command ${outcome === "failed" ? "catches erased input" : "verifies real CRUD"}`, async ({
    page,
    app,
    target,
  }) => {
    const policy = await watchPolicy(page);
    const url = `${target.url}/${mode}/`;
    await apiAndPageChecks(url);
    const workflow = parse(readFileSync(sample, "utf8"));
    workflow.project.root = app.root;
    workflow.steps.browser_acceptance.argv[1] = checker;
    workflow.steps.browser_acceptance.argv[2] = url;
    // The runner fixture has a private HOME. Reuse only the provisioned pinned binary,
    // with a new browser context; no personal profile or global config is imported.
    workflow.steps.browser_acceptance.env = {
      PLAYWRIGHT_BROWSERS_PATH:
        process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.resolve(chromium.executablePath(), "../../.."),
    };
    const { runId } = await app.seed({ workflowText: stringify(workflow) });
    expect(target.records[mode].size).toBe(0);
    await pairApp(page, app, `#/runs/${runId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ready to start");
    await page.getByRole("button", { name: "Start run", exact: true }).press("Enter");
    await expect
      .poll(
        async () => {
          const state = await app.status(runId);
          return [state.run.status, Boolean(state.activeAttempt)];
        },
        { timeout: 30_000 },
      )
      .toEqual([status, false]);
    const step = page.getByRole("region", { name: "Browser acceptance", exact: true });
    await expect(step.getByRole("tab", { name: "Output", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(step).toContainText(`"status": "${outcome === "complete" ? "passed" : "failed"}"`);
    await expect(step).toContainText('"cleanup": "verified"');
    await expect(step).toContainText("No Firefox/WebKit");
    if (mode === "broken") {
      await expect(step).toContainText('"failedCheck": "edited name retains typed input"');
      await expect(step).toContainText("Exit code 1");
    } else {
      await expect(step).toContainText('"width": 1280');
      await expect(step).toContainText('"width": 390');
      await expect(step).toContainText("updated record survives page reload");
      await expect(step).toContainText("deleted record stays absent after reload");
      await expect(step).toContainText("Exit code 0");
    }
    expect(target.records[mode].size).toBe(0);
    const { events } = await app.request({ op: "events", runId, after: 0, limit: 1000 });
    expect(events.filter((event) => event.type === "attempt_started")).toHaveLength(1);
    const routed = events.find(
      (event) => event.type === "transition_committed" && event.data.from === "browser_acceptance",
    );
    expect(routed.data.outcome).toBe(outcome);
    expect(routed.data.decision).toBe(outcome === "complete" ? "goto" : "pause");
    expect(await app.request({ op: "reports", runId })).toEqual([]);
    expect(app.children).toHaveLength(0);
    await policy();
  });
}
