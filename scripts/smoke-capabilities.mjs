// Independent offline service exercise: the real Claude adapter runs only the synthetic CLI.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClaudeAdapter } from "../dist/adapters/claude.js";
import { RunService } from "../dist/runner/run-service.js";
import { WorkflowDatabase } from "../dist/store/database.js";

const root = mkdtempSync(path.join(os.tmpdir(), "wf-capability-smoke-"));
const cli = fileURLToPath(new URL("../test/fixtures/fake-claude.mjs", import.meta.url));
const flow = (model, resume) => `version: 1
name: capability smoke
project: { root: . }
start: work
steps:
  work:
    kind: agent
    harness: claude
    session: fresh
    prompt: report through wf
    outcomes: [complete]
${model ? "    model: example-model\n" : ""}    on: { complete: { goto: ${resume ? "followup" : "done"} } }
${
  resume
    ? `  followup:
    kind: agent
    harness: claude
    session: resume
    prompt: continue
    outcomes: [complete]
    on: { complete: { goto: done } }
`
    : ""
}  done: { kind: end }
`;
try {
  for (const [name, probe, mode, model, resume, expected, launches] of [
    ["required", { omit: ["--verbose"] }, "report", false, false, "incompatible", 0],
    ["model", { omit: ["--model"] }, "report", true, false, "system.spawn_error", 0],
    ["fresh", { omit: ["--model"] }, "report", false, false, "complete", 1],
    ["correction", {}, "silent", false, false, "system.report_error", 1],
    ["resume", {}, "report", false, true, "system.resume_unavailable", 1],
  ]) {
    const config = path.join(root, `${name}.json`);
    writeFileSync(
      config,
      JSON.stringify({ plan: [{ mode }], options: { probe, supportsResume: false } }),
    );
    const create = () =>
      createClaudeAdapter({
        binary: process.execPath,
        prefixArgs: [cli, config],
        environment: { PATH: process.env.PATH, HOME: root, CLAUDE_CONFIG_DIR: root },
      });
    if (name === "required") await assert.rejects(create(), /incompatible.*--verbose/);
    else {
      const adapter = await create();
      assert.equal(adapter.capabilities.supportsResume, false);
      assert.equal(adapter.resumeForReportCorrection, undefined);
      const dbPath = path.join(root, `${name}.sqlite`);
      const database = new WorkflowDatabase(dbPath);
      let runId;
      try {
        const service = new RunService(database, {
          agents: new Map([["claude", adapter]]),
          logDir: path.join(root, `${name}-logs`),
        });
        runId = service.createRun({ workflowText: flow(model, resume), workflowDir: root });
        service.coordinator.start(runId);
        await service.drive(runId);
        const state = service.coordinator.inspect(runId);
        assert.equal(state.transitions.at(-1)?.outcome, expected);
        assert.equal(state.events.filter((e) => e.type === "invocation_started").length, launches);
        assert.equal(state.events.filter((e) => e.type === "correction_requested").length, 0);
        if (model) assert.match(JSON.stringify(state), /does not support model selection/);
        if (resume) assert.match(JSON.stringify(state), /does not support exact session resume/);
      } finally {
        database.close();
      }
      const reopened = new WorkflowDatabase(dbPath);
      try {
        const service = new RunService(reopened, {
          agents: new Map([["claude", adapter]]),
          logDir: path.join(root, `${name}-logs`),
        });
        assert.equal(service.coordinator.inspect(runId).transitions.at(-1)?.outcome, expected);
      } finally {
        reopened.close();
      }
    }
    assert.equal(JSON.parse(readFileSync(config, "utf8")).index ?? 0, launches);
    console.log(`${name}: ${expected}; ${launches} invocation(s), no correction/fresh fallback`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
