// Shared helpers for the new React app specs (/ui/).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect } from "./fixture.mjs";

export const WORKFLOW = `version: 1
name: Implement and review
project:
  root: .
  instructions: [instructions.md]
tasks:
  source: {kind: markdown_checklist, path: tasks.md}
start: pick
steps:
  pick:
    kind: task.next
    on:
      task_ready: {goto: work}
      exhausted: {goto: done}
  work:
    kind: agent
    harness: codex
    model: offline-model
    session: fresh
    prompt: Work on {{task.text}}
    outcomes: [complete, blocked]
    on:
      complete: {goto: review}
      blocked: {pause: true}
  review:
    kind: agent
    harness: pi
    model: offline-review-model
    session: fresh
    prompt: Review {{task.text}}
    outcomes: [complete, blocked]
    on:
      complete: {goto: finish}
      blocked: {pause: true}
  finish:
    kind: task.complete
    on:
      complete: {goto: pick}
  done: {kind: end, label: All tasks done}
`;

/** Records CSP violations, which the browser reports without failing a request. */
export async function watchPolicy(page) {
  const violations = [];
  page.on("console", (message) => {
    if (/Content.Security.Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  await page.addInitScript(() => {
    window.__violations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__violations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return async () => {
    const inPage = await page.evaluate(() => window.__violations).catch(() => []);
    expect([...violations, ...inPage]).toEqual([]);
  };
}

export async function pairApp(page, app, hash = "") {
  const issued = await app.request({ op: "browser-access" });
  await page.goto(`${app.url}/ui/${hash}`);
  await expect(page.getByRole("heading", { level: 1, name: "Connect this browser" })).toBeVisible();
  await page.getByLabel("Pairing code").fill(issued.code);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByLabel("Pairing code")).toHaveCount(0);
}

/** Optional screenshots for visual review: set WF_SHOTS to a directory. Never contains codes. */
export async function shot(page, name) {
  if (!process.env.WF_SHOTS) return;
  mkdirSync(process.env.WF_SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(process.env.WF_SHOTS, `${name}.png`), fullPage: true });
}

export async function noSideScroll(page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}
