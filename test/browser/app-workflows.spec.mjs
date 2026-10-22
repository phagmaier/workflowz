// Workbench frame: the sidebar lists saved workflows and run groups, and the Workflows page
// imports a dropped file into a draft only after an explicit folder and Open draft.
import { noSideScroll, pairApp, shot, WORKFLOW, watchPolicy } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

test.use({ scenario: "gate" });

test("sidebar lists workflows and run groups; a dropped file waits for a folder and can be cancelled", async ({
  page,
  app,
}) => {
  const policy = await watchPolicy(page);
  const drafts = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/ui/api") && request.postDataJSON()?.op === "draft")
      drafts.push(request.postDataJSON());
  });
  const { revisionId } = await app.seed({ workflowText: WORKFLOW });
  await pairApp(page, app, "#/workflows");

  const side = page.getByRole("navigation", { name: "Main" });
  const main = page.getByRole("main");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Workflows");
  await expect(side.getByRole("link", { name: "Ready to start 1" })).toBeVisible();
  await expect(side.getByRole("link", { name: "Waiting for you 0" })).toBeVisible();
  const row = main.getByRole("row", { name: /Implement and review/ });
  await expect(row).toContainText(`Revision ${revisionId}`);
  await expect(row).toContainText("Ready");
  await expect(row).toContainText("1 run");
  await noSideScroll(page);
  await shot(page, "w1-workflows-desktop");

  // The open workflow is marked in the sidebar.
  const entry = side.getByRole("link", { name: "Implement and review" });
  await entry.click();
  await expect(page).toHaveURL(new RegExp(`#/workflows/${revisionId}$`));
  await expect(entry).toHaveAttribute("aria-current", "page");

  // Import opens the Workflows page with the file control focused.
  await side.getByRole("link", { name: "Import file…" }).click();
  await expect(page).toHaveURL(/#\/workflows\/import$/);
  await expect(page.getByLabel("Workflow YAML file")).toBeFocused();
  drafts.length = 0; // Opening the editor above checked its draft; imports must not.

  const zone = page.getByRole("region", { name: "Import a workflow file" });
  const dropped = await page.evaluateHandle((text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], "dropped.yaml", { type: "text/yaml" }));
    return transfer;
  }, WORKFLOW);
  await zone.dispatchEvent("drop", { dataTransfer: dropped });
  await expect(zone).toContainText("Chosen file: dropped.yaml");
  await expect(page.getByLabel("Workflow folder")).toBeFocused();
  await shot(page, "w2-import-chosen");

  // A relative folder is refused at the action; nothing is sent.
  await page.getByLabel("Workflow folder").fill("relative");
  await page.getByRole("button", { name: "Open draft" }).click();
  await expect(zone.getByRole("alert")).toContainText("starting with /");
  await expect(page.getByLabel("Workflow folder")).toBeFocused();

  await zone.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/#\/workflows$/);
  await expect(zone).not.toContainText("dropped.yaml");
  expect(drafts).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await noSideScroll(page);
  await shot(page, "w3-workflows-phone");
  await policy();
});

test("workflow reads retain retry focus, show stale rows on failure and refresh saved revisions", async ({
  page,
  app,
}) => {
  await app.seed({ workflowText: WORKFLOW });
  let fail = true;
  await page.route("**/ui/api", async (route) => {
    if (route.request().postDataJSON()?.op === "workflows" && fail)
      return route.fulfill({ status: 503, json: { error: "Temporary workflow read failure" } });
    return route.continue();
  });
  await pairApp(page, app, "#/workflows");
  const main = page.getByRole("main");
  await expect(main.getByRole("alert")).toContainText("Temporary workflow read failure");
  fail = false;
  await main.getByRole("button", { name: "Try again now" }).click();
  const row = main.getByRole("row", { name: /Implement and review/ });
  await expect(row).toBeVisible();
  const refresh = main.getByRole("button", { name: "Refresh workflows" });
  await expect(refresh).toBeFocused();
  fail = true;
  await refresh.click();
  await expect(main.getByRole("alert")).toContainText("may be out of date");
  await expect(row).toBeVisible();
  await expect(main.getByRole("button", { name: "Try again now" })).toBeFocused();
  await page.setViewportSize({ width: 320, height: 800 });
  await noSideScroll(page);
  await shot(page, "review-workflows-stale-320");
  fail = false;
  await app.request({
    op: "import",
    workflowText: WORKFLOW.replace("Implement and review", "A newly saved workflow"),
    workflowDir: app.root,
  });
  await main.getByRole("button", { name: "Try again now" }).click();
  await expect(main.getByRole("row", { name: /A newly saved workflow/ })).toBeVisible();
  await expect(refresh).toBeFocused();
  await noSideScroll(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", {
      name: "A newly saved workflow",
      exact: true,
    }),
  ).toBeVisible();
  await shot(page, "review-workflows-refreshed-1440");
  // Import navigation keeps this page mounted. Its table must follow the same saved list
  // as the sidebar when another workflow has been saved elsewhere.
  await app.request({
    op: "import",
    workflowText: WORKFLOW.replace("Implement and review", "Saved while browsing"),
    workflowDir: app.root,
  });
  await page.getByRole("link", { name: "Import file…", exact: true }).click();
  await expect(main.getByRole("row", { name: /Saved while browsing/ })).toBeVisible();
  await expect(page.getByLabel("Workflow YAML file")).toBeFocused();
  expect(app.children).toEqual([]);
});
