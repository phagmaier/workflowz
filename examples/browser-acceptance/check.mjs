// Adapt the labels, readiness signal and journeys to your application. Use disposable data.
import { randomUUID } from "node:crypto";
import { expect as baseExpect, chromium } from "@playwright/test";

const expect = baseExpect.configure({ timeout: 2000 });
const viewports = [
  { width: 1280, height: 900 },
  { width: 390, height: 900 },
];
const report = {
  status: "not_run",
  browser: "Chromium",
  results: [],
  limits: [
    "Only the configured item CRUD journey and viewport sizes are exercised.",
    "No Firefox/WebKit, authentication, concurrent edits, server restart or full accessibility/visual audit.",
    "Adapt this example to the application's real labels, readiness signal and acceptance criteria.",
  ],
};

async function checkViewport(browser, url, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(5000);
  const prefix = `wf-acceptance-${randomUUID()}`;
  const original = `${prefix} original`;
  const edited = `${prefix} edited`;
  const result = { ...viewport, status: "failed", checks: [], cleanup: "verified" };
  let currentCheck = "page and item list ready";
  let mutationAttempted = false;
  let deleted = false;
  const ready = () =>
    expect(page.getByRole("table", { name: "Items", exact: true })).toHaveAttribute(
      "aria-busy",
      "false",
    );
  const row = (name) =>
    page.getByRole("row").filter({ has: page.getByRole("cell", { name, exact: true }) });
  const ownedRows = () => page.getByRole("row").filter({ hasText: prefix });
  const check = async (label, action) => {
    currentCheck = label;
    await action();
    result.checks.push(label);
  };
  try {
    await page.goto(url);
    await check("page and item list ready", ready);
    const name = page.getByLabel("Item name", { exact: true });
    const description = page.getByLabel("Description", { exact: true });
    currentCheck = "created name retains typed input";
    await name.focus();
    await name.pressSequentially(original);
    await check("created name retains typed input", () => expect(name).toHaveValue(original));
    await page.keyboard.press("Tab");
    await check("Tab moves to description", () => expect(description).toBeFocused());
    await description.pressSequentially("Created using keyboard");
    await check("description retains typed input", () =>
      expect(description).toHaveValue("Created using keyboard"),
    );
    await check("editing another field preserves name", () => expect(name).toHaveValue(original));
    await page.keyboard.press("Tab");
    await check("Tab moves to Add item", () =>
      expect(page.getByRole("button", { name: "Add item", exact: true })).toBeFocused(),
    );
    mutationAttempted = true;
    currentCheck = "created record is visible";
    await page.keyboard.press("Enter");
    await check("created record is visible", () =>
      expect(row(original)).toContainText("Created using keyboard"),
    );
    currentCheck = "edited name retains typed input";
    await row(original).getByRole("button", { name: "Edit", exact: true }).press("Enter");
    await name.press("ControlOrMeta+A");
    await name.pressSequentially(edited);
    await check("edited name retains typed input", () => expect(name).toHaveValue(edited));
    await page.keyboard.press("Tab");
    await check("edit keyboard focus reaches description", () => expect(description).toBeFocused());
    await description.press("ControlOrMeta+A");
    await description.pressSequentially("Updated using keyboard");
    await check("edited description retains typed input", () =>
      expect(description).toHaveValue("Updated using keyboard"),
    );
    await check("cross-field edit preserves name", () => expect(name).toHaveValue(edited));
    currentCheck = "updated record is visible";
    await page.getByRole("button", { name: "Save item", exact: true }).press("Enter");
    await check("updated record is visible", () =>
      expect(row(edited)).toContainText("Updated using keyboard"),
    );
    currentCheck = "updated record survives page reload";
    await page.reload();
    await ready();
    await check("updated record survives page reload", () =>
      expect(row(edited)).toContainText("Updated using keyboard"),
    );
    currentCheck = "deleted record stays absent after reload";
    await row(edited).getByRole("button", { name: "Delete", exact: true }).press("Enter");
    await expect(row(edited)).toHaveCount(0);
    await page.reload();
    await ready();
    await check("deleted record stays absent after reload", () =>
      expect(ownedRows()).toHaveCount(0),
    );
    deleted = true;
    await check("page has no horizontal overflow", async () => {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
    result.status = "passed";
  } catch {
    result.failedCheck = currentCheck;
  } finally {
    if (mutationAttempted && !deleted) {
      // Only this invocation's unique prefix is eligible for cleanup. A failed cleanup is
      // an explicit verification limit; uncertain create/update actions are never replayed.
      try {
        await page.reload();
        await ready();
        for (let remaining = await ownedRows().count(); remaining > 0; remaining--) {
          await ownedRows()
            .first()
            .getByRole("button", { name: "Delete", exact: true })
            .press("Enter");
          await expect(ownedRows()).toHaveCount(remaining - 1);
        }
        await page.reload();
        await ready();
        await expect(ownedRows()).toHaveCount(0);
      } catch {
        result.cleanup = "unverified";
        result.ownedPrefix = prefix;
        result.status = "failed";
      }
    }
    await context.close();
  }
  return result;
}

async function main() {
  let url;
  try {
    url = new URL(process.argv[2]);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password
    )
      throw new Error("expected a credential-free local disposable target");
  } catch {
    console.error("Usage: node examples/browser-acceptance/check.mjs http://127.0.0.1:PORT/path/");
    return 2;
  }
  let browser;
  try {
    browser = await chromium.launch({ channel: "chromium" });
    for (const viewport of viewports) {
      const result = await checkViewport(browser, url.href, viewport);
      report.results.push(result);
      if (result.status !== "passed") break;
    }
    report.status =
      report.results.length === viewports.length &&
      report.results.every((result) => result.status === "passed")
        ? "passed"
        : "failed";
  } catch {
    report.status = "failed";
    report.failure =
      "Chromium/setup or browser cleanup failed; see the recipe's setup instructions. No successful verification is claimed.";
  } finally {
    try {
      await browser?.close();
    } catch {
      report.status = "failed";
      report.failure = "Browser cleanup is unverified; no successful verification is claimed.";
    }
  }
  console.log(JSON.stringify(report, null, 2));
  return report.status === "passed" ? 0 : 1;
}

process.exitCode = await main();
