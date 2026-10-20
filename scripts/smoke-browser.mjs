// No installer or provider execution here: missing provisioned Chromium fails explicitly.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const output = mkdtempSync(path.join(os.tmpdir(), "wf-browser-output-"));
try {
  const child = spawn(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, WF_BROWSER_OUTPUT: output } },
  );
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  process.exitCode = code;
} finally {
  rmSync(output, { recursive: true, force: true });
}
