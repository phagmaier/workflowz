import { pairApp, WORKFLOW } from "./app-helpers.mjs";
import { expect, test } from "./fixture.mjs";

test("an explicit example card replaces the prior choice while keeping setup inputs", async ({
  page,
  app,
}) => {
  await pairApp(page, app, "#/workflows/new");
  await page.getByLabel("Name", { exact: true }).fill("Keep my setup");
  await page.getByLabel("Project folder").fill(app.root);
  await page.getByRole("radio", { name: /Task loop/ }).check();
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await page.getByRole("link", { name: /Commands only/ }).click();
  await expect(page.getByRole("radio", { name: /Commands only/ })).toBeChecked();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Keep my setup");
  await expect(page.getByLabel("Project folder")).toHaveValue(app.root);
});

for (const imported of [false, true]) {
  test(`a delayed ${imported ? "import" : "new draft"} check preserves navigation and newer setup`, async ({
    page,
    app,
  }) => {
    await pairApp(page, app, imported ? "#/workflows/import" : "#/workflows/new/commands");
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    let sent;
    const pending = new Promise((resolve) => {
      sent = resolve;
    });
    await page.route("**/ui/api", async (route) => {
      if (route.request().postDataJSON()?.op === "draft") {
        sent();
        await held;
      }
      await route.continue();
    });
    if (imported) {
      await page.getByLabel("Workflow YAML file").setInputFiles({
        name: "offline.yaml",
        mimeType: "text/yaml",
        buffer: Buffer.from(WORKFLOW),
      });
      await page.getByLabel("Original workflow folder").fill(app.root);
    } else {
      await page.getByLabel("Name", { exact: true }).fill("Pending draft");
      await page.getByLabel("Project folder").fill(app.root);
    }
    await page
      .getByRole("button", { name: imported ? "Open draft" : "Create draft", exact: true })
      .click();
    await pending;
    await page.getByRole("link", { name: "Cancel", exact: true }).click();
    if (!imported) {
      await page.getByRole("link", { name: "＋ Create workflow", exact: true }).click();
      await page.getByLabel("Name", { exact: true }).fill("My next draft");
      await page.getByRole("link", { name: "Cancel", exact: true }).click();
    }
    const checked = page.waitForResponse(
      (response) =>
        response.url().endsWith("/ui/api") && response.request().postDataJSON()?.op === "draft",
    );
    release();
    await checked;
    await page.waitForTimeout(100);
    await expect(page.getByRole("region", { name: "Unsaved drafts in this tab" })).toBeVisible();
    await expect(page).toHaveURL(/#\/workflows$/);
    if (!imported) {
      await page.getByRole("link", { name: "＋ Create workflow", exact: true }).click();
      await expect(page.getByLabel("Name", { exact: true })).toHaveValue("My next draft");
    }
    expect(app.children).toEqual([]);
  });
}

test("a late unauthorized reply from an old session cannot end a fresh pairing", async ({
  page,
  app,
}) => {
  await pairApp(page, app, "#/workflows");
  await expect(
    page.getByRole("heading", { level: 1, name: "Workflows", exact: true }),
  ).toBeVisible();
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let oldRead;
  const pending = new Promise((resolve) => {
    oldRead = resolve;
  });
  let heldOne = false;
  let expired = false;
  await page.route("**/ui/api", async (route) => {
    const op = route.request().postDataJSON()?.op;
    if (op === "draft" && !heldOne) {
      heldOne = true;
      oldRead();
      await held;
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"error":"Browser session required"}',
      });
    } else if (op === "session" && !expired) {
      expired = true;
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"error":"Browser session required"}',
      });
    } else await route.continue();
  });
  await page.getByRole("link", { name: /Commands only/ }).click();
  await page.getByLabel("Name", { exact: true }).fill("Old session request");
  await page.getByLabel("Project folder").fill(app.root);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await pending;
  await expect(page.getByLabel("Pairing code")).toBeVisible();
  const issued = await app.request({ op: "browser-access" });
  await page.getByLabel("Pairing code").fill(issued.code);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByLabel("Pairing code")).toHaveCount(0);
  release();
  await expect(
    page.getByRole("heading", { level: 1, name: "New workflow", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/The draft couldn't be checked/)).toHaveCount(0);
  // Let the delayed read's rejection pass through the connection observer.
  await page.waitForTimeout(200);
  await expect(page.getByLabel("Pairing code")).toHaveCount(0);
});
