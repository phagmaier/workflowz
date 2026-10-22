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
