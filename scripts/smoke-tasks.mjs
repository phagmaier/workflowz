// Offline acceptance smoke for immutable Markdown import and selected context. Removes all artifacts.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { RunService } from "../dist/runner/run-service.js";
import { WorkflowDatabase } from "../dist/store/database.js";
import { ScriptedAgentAdapter } from "../dist/test-support/scripted-agent.js";

const root = mkdtempSync(path.join(os.tmpdir(), "wf-tasks-smoke-"));
const database = new WorkflowDatabase(path.join(root, "state.sqlite"));
const source =
  "# Work\n- [x] already done\n- [ ] first task\n  task details\n    - [ ] nested task\n";
try {
  writeFileSync(path.join(root, "tasks.md"), source);
  writeFileSync(path.join(root, "instructions.md"), "Follow the configured workflow.");
  const flow = `version: 1
name: Task import smoke
project:
  root: .
  instructions: [instructions.md]
tasks:
  source:
    kind: markdown_checklist
    path: tasks.md
start: pick
steps:
  pick:
    kind: task.next
    on:
      task_ready: { goto: work }
      exhausted: { goto: done }
  work:
    kind: agent
    harness: codex
    session: fresh
    prompt: "Implement {{task.text}}"
    outcomes: [complete]
    on:
      complete: { goto: finish }
  finish:
    kind: task.complete
    on:
      complete: { goto: pick }
  done:
    kind: end
`;
  const service = new RunService(database, {
    agents: new Map([["codex", new ScriptedAgentAdapter([])]]),
    logDir: path.join(root, "logs"),
  });
  const input = { workflowText: flow, workflowDir: root };
  assert.equal(service.previewTasks(input)?.runnableCount, 2);
  const runId = service.createRun(input);
  service.coordinator.start(runId);
  await service.drive(runId);
  const state = service.coordinator.inspect(runId);
  assert.equal(state.run.status, "completed");
  assert.deepEqual(
    state.tasks.map((task) => task.state),
    ["completed", "completed"],
  );
  assert.equal(state.attempts.length, 2);
  assert.equal(readFileSync(path.join(root, "tasks.md"), "utf8"), source);
  assert.equal(
    service.coordinator.attemptInput(state.attempts[0].attemptId)?.context.task?.body,
    "  task details",
  );
  console.log(
    "Task preview: 3 total, 1 prechecked, 2 runnable. Fake workflow completed both in source order through real wf reports; original Markdown unchanged; input context persisted.",
  );
} finally {
  database.close();
  rmSync(root, { recursive: true, force: true });
}
console.log("Temporary database, sessions, logs and project files removed.");
