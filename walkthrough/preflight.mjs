// Version/help and local catalog only. No prompt, session or inference request.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenCodeAdapter } from "../dist/adapters/opencode.js";
import { openCodeEnvironment } from "../dist/adapters/opencode-environment.js";
import { validateWorkflow } from "../dist/app/workflow-validation.js";

const model = "opencode/deepseek-v4.1-flash-free";
const lab = process.env.WF_LAB;
assert.ok(lab?.startsWith("/tmp/workflowz-owner-"), "Source the prepared environment.sh first");
assert.equal(
  readFileSync(path.join(lab, ".workflowz-owner-walkthrough"), "utf8"),
  "Workflowz owner walkthrough v1\n",
);
assert.equal(process.env.OPENCODE_CONFIG_DIR, path.join(lab, "opencode/config"));
assert.equal(process.env.OPENCODE_DB, path.join(lab, "opencode/opencode.db"));
assert.equal(process.env.OPENCODE_DISABLE_MODELS_FETCH, "1");
const source = fileURLToPath(new URL("./", import.meta.url));
for (const file of ["workflow.yaml", "opencode/config/opencode.json"]) {
  const original = file === "workflow.yaml" ? "workflow.yaml" : "opencode.json";
  assert.ok(
    readFileSync(path.join(lab, file), "utf8") ===
      readFileSync(path.join(source, original), "utf8"),
    `${file} differs from the reviewed template`,
  );
}
const checked = validateWorkflow({
  workflowText: readFileSync(path.join(lab, "workflow.yaml"), "utf8"),
  workflowDir: lab,
});
assert.ok(checked.valid, JSON.stringify(checked.diagnostics));
assert.deepEqual(
  checked.diagnostics.map(({ severity, code, path }) => ({ severity, code, path })),
  ["finish", "done"].map((id) => ({
    severity: "warning",
    code: "unreachable_step",
    path: ["steps", id],
  })),
  "Only finish/done warnings are expected: they require the owner's explicit jump",
);
const adapter = await createOpenCodeAdapter();
assert.ok(adapter.capabilities.supportsModelSelection, "Installed OpenCode cannot select a model");
console.log(`PASS: ${adapter.compatibility.version}; private API/model selection supported`);
// Match the environment selection used by the real adapter's two child boundaries.
const result = spawnSync("opencode", ["models", "--standalone"], {
  cwd: path.join(lab, "project"),
  env: openCodeEnvironment(process.env, {}),
  encoding: "utf8",
  timeout: 20_000,
  maxBuffer: 4 * 1024 * 1024,
});
// Never echo raw harness output/configuration or environment on failure.
assert.equal(
  result.status,
  0,
  "Local model catalog failed; provider availability is unestablished",
);
assert.ok(
  result.stdout.split(/\r?\n/).includes(model),
  `Exact model absent: ${model}. Stop; do not substitute another model.`,
);
console.log(
  `PASS: credential-free local catalog lists ${model}; workflow has 5 steps and only the 2 documented manual-path warnings`,
);
console.log(
  "PENDING: provider reachability, access/rate limits, tool execution and accepted live report. No provider invoked.",
);
