// Offline process fixture only. Production daemon never loads fixture adapters or plugins.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { startDaemon } from "../../dist/app/daemon.js";
import { readDaemonAccess } from "../../dist/app/state-directory.js";
import { ScriptedAgentAdapter } from "../../dist/test-support/scripted-agent.js";

const [directory, mode] = process.argv.slice(2);
const plan =
  mode === "correction"
    ? [{ mode: "silent" }, { mode: "report", outcome: "complete" }]
    : [{ mode: "report-then-hang", outcome: "complete" }];
const adapter = new ScriptedAgentAdapter(plan);
const start = adapter.start.bind(adapter);
adapter.start = (input) => {
  const access = readDaemonAccess(directory);
  // Test actual cross-channel authority without recording either token.
  void Promise.all([
    fetch(`http://127.0.0.1:${access.port}/api/v1`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.reportAccess.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ op: "ping" }),
    }),
    fetch(input.reportAccess.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${access.token}`, "content-type": "application/json" },
      body: JSON.stringify({ outcome: "complete", summary: "wrong authority" }),
    }),
  ]).then((responses) => {
    writeFileSync(
      path.join(directory, "authority-result"),
      JSON.stringify(responses.map((response) => response.status)),
      { mode: 0o600 },
    );
  });
  return start(input);
};
const owner = await startDaemon(directory, new Map([["codex", adapter]]));
const shutdown = () => {
  void owner.close().catch(() => {});
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.send?.({ ready: true });
await owner.closed;
process.off("SIGINT", shutdown);
process.off("SIGTERM", shutdown);
process.disconnect?.();
