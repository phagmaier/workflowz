// Headless offline acceptance smoke, independent of node:test. Always removes its own artifacts.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { RunCoordinator } from "../dist/engine/run-coordinator.js";
import { RunService } from "../dist/runner/run-service.js";
import { WorkflowDatabase } from "../dist/store/database.js";
import { ScriptedAgentAdapter } from "../dist/test-support/scripted-agent.js";

const flow = `version: 1
name: Reporting smoke
project:
  root: .
start: agent
steps:
  agent:
    kind: agent
    harness: codex
    session: fresh
    prompt: Offline fake reporting smoke
    outcomes: [complete]
    on:
      complete: { goto: marker }
  marker:
    kind: command
    argv: [touch, settled.marker]
    on:
      complete: { goto: done }
      failed: { pause: true }
  done:
    kind: end
`;
for (const [name, plan, expected] of [
  ["accepted", [{ mode: "report-then-delay", extra: "200" }], "completed"],
  ["correction-success", [{ mode: "silent" }, { mode: "report" }], "completed"],
  ["correction-failure", [{ mode: "silent" }, { mode: "silent" }], "paused"],
]) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-report-smoke-"));
  const database = new WorkflowDatabase(path.join(root, "state.sqlite"));
  const logFile = path.join(root, "agent.log");
  try {
    const service = new RunService(database, {
      agents: new Map([["codex", new ScriptedAgentAdapter(plan, { logFile })]]),
      logDir: path.join(root, "logs"),
    });
    const runId = service.coordinator.createRun({ workflowText: flow, workflowDir: root });
    service.coordinator.start(runId);
    const driving = service.drive(runId);
    if (name === "accepted") {
      const deadline = Date.now() + 5000;
      while (!service.coordinator.inspect(runId).events.some((e) => e.type === "report_accepted")) {
        assert.ok(Date.now() < deadline);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(service.coordinator.inspect(runId).transitions.length, 0);
      assert.equal(existsSync(path.join(root, "settled.marker")), false);
      console.log("accepted: durable report observed while process active; cursor unchanged");
    }
    await driving;
    const state = service.coordinator.inspect(runId);
    const reports = state.events.filter((e) => e.type === "report_accepted").length;
    const corrections = state.events.filter((e) => e.type === "correction_requested").length;
    assert.equal(state.run.status, expected);
    assert.equal(reports, expected === "completed" ? 1 : 0);
    assert.equal(corrections, name === "accepted" ? 0 : 1);
    assert.equal(existsSync(path.join(root, "settled.marker")), expected === "completed");
    const notes = readFileSync(logFile, "utf8");
    if (reports) assert.match(notes, /ack 0/);
    const observer = new WorkflowDatabase(path.join(root, "state.sqlite"), { readOnly: true });
    try {
      assert.equal(new RunCoordinator(observer).inspect(runId).run.status, expected);
    } finally {
      observer.close();
    }
    console.log(
      `${name}: status=${expected}, accepted_reports=${reports}, corrections=${corrections}, agent_outcome=${state.transitions[0]?.outcome}; SQLite reopen verified`,
    );
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
}
console.log("Temporary databases, sessions, logs and project files removed.");
