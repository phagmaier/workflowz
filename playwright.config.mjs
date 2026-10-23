import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  testMatch: "*.spec.mjs",
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  outputDir: process.env.WF_BROWSER_OUTPUT,
  use: {
    browserName: "chromium",
    channel: "chromium",
    viewport: { width: 1280, height: 900 },
    actionTimeout: 10_000,
    navigationTimeout: 10_000,
    // Pairing codes/cookies are authority. Do not persist traces or browser profiles.
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
