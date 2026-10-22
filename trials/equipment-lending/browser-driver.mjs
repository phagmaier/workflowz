// Evaluator browser console. No management RPCs, cookie persistence, traces or raw request logging.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { chromium, expect } from "@playwright/test";

const state = process.argv[2];
if (!state || !path.isAbsolute(state)) throw new Error("absolute disposable state path required");
const browser = await chromium.launch({ channel: "chromium", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const issued = execFileSync(path.resolve("bin/wf"), ["--state-dir", state, "--json", "ui"], {
  encoding: "utf8",
});
// CLI JSON is held only in memory. Never print the one-use pairing code.
const access = JSON.parse(issued);
const address = access.url;
await page.goto(address);
await page.getByLabel("Pairing code").fill(access.code);
await page.getByRole("button", { name: "Connect", exact: true }).click();
await expect(page.getByLabel("Pairing code")).toHaveCount(0);
const evidence = path.resolve("trials/equipment-lending/evidence");
mkdirSync(evidence, { recursive: true });
const shot = async (name) => {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("invalid screenshot name");
  await expect(page.getByLabel("Pairing code")).toHaveCount(0);
  await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });
  return `evidence/${name}.png`;
};
console.log(JSON.stringify({ ready: true, heading: await page.locator("h1").innerText() }));
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  try {
    const { code } = JSON.parse(line);
    const result = await new AsyncFunction("page", "context", "browser", "expect", "shot", code)(
      page,
      context,
      browser,
      expect,
      shot,
    );
    console.log(JSON.stringify({ ok: true, result }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: String(error).slice(0, 1400) }));
  }
}
await browser.close();
