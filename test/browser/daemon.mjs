// A separate foreground owner, with a complete fake-only harness registry.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { BUILT_IN_HARNESSES } from "../../dist/adapters/harness-registry.js";
import { startDaemon } from "../../dist/app/daemon.js";
import { readDaemonAccess } from "../../dist/app/state-directory.js";
import { ScriptedAgentAdapter } from "../../dist/test-support/scripted-agent.js";

const [directory, scenario, gate] = process.argv.slice(2);
const plans = {
  gate: { codex: ["blocked", "complete", "complete"], pi: ["complete", "complete"] },
  intervention: { codex: ["blocked"] },
  lifetime: { codex: ["complete"] },
  "owner-walkthrough": { opencode: ["complete"] },
};
if (!plans[scenario]) throw new Error("unknown offline browser scenario");

const send = (message) => {
  if (process.connected) process.send(message);
};
const agents = new Map();
for (const [id] of BUILT_IN_HARNESSES) {
  const outcomes = plans[scenario][id] ?? [];
  const scripts = outcomes.map((outcome) => ({
    mode: scenario === "lifetime" ? "report-wait-for-file" : "report",
    outcome,
    ...(scenario === "lifetime" ? { extra: gate } : {}),
  }));
  const adapter = new ScriptedAgentAdapter(scripts, {
    logFile: path.join(directory, "fake-agent.log"),
  });
  let remaining = scripts.length;
  const launch = (input, correction) => {
    // ScriptedAgentAdapter intentionally has a default plan; this boundary must not.
    if (correction || remaining-- <= 0) throw new Error(`unexpected offline ${id} invocation`);
    if (scenario === "owner-walkthrough") {
      assert.equal(id, "opencode");
      assert.equal(input.model, "opencode/deepseek-v4.1-flash-free");
      assert.equal(input.reasoningEffort, undefined);
      // Simulate only the requested file edit; the supervised fake process supplies the report.
      writeFileSync(path.join(input.cwd, "greeting.txt"), "Hello from Workflowz and OpenCode.\n");
    }
    const handle = adapter.start(input);
    send({ type: "child", harness: id, pid: handle.pid, processIdentity: handle.processIdentity });
    return handle;
  };
  agents.set(id, {
    id,
    capabilities: adapter.capabilities,
    start: (input) => launch(input, false),
    resumeForReportCorrection: (input) => launch(input, true),
  });
}

let owner;
let closing;
const close = () => {
  closing ??= (async () => {
    await owner?.close();
    if (process.connected) process.disconnect();
  })();
  return closing;
};
process.on("message", (message) => {
  if (message?.type === "close") void close().catch(fail);
});
process.on("SIGTERM", () => void close().catch(fail));
process.on("SIGINT", () => void close().catch(fail));
process.on("disconnect", () => void close().catch(fail));
function fail(error) {
  // Never send discovery tokens, pairing codes, environment, or raw request bodies.
  send({
    type: "failure",
    message: String(error?.message ?? error).replace(/[a-f0-9]{64}/gi, "[secret]"),
  });
  process.exitCode = 1;
  if (process.connected) process.disconnect();
}
try {
  owner = await startDaemon(directory, agents);
  const { port } = readDaemonAccess(directory);
  send({ type: "ready", port, pid: process.pid });
  await owner.closed;
} catch (error) {
  fail(error);
}
