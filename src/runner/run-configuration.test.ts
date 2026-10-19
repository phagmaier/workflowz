import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it, type TestContext } from "node:test";
import type { AgentInput } from "../adapters/agent-adapter.js";
import { WorkflowDatabase } from "../store/database.js";
import { ScriptedAgentAdapter } from "../test-support/scripted-agent.js";
import { RunService } from "./run-service.js";

const FLOW = `version: 1
name: Task configuration
project:
  root: .
  instructions: [guidance.md]
tasks:
  source: { kind: markdown_checklist, path: tasks.md }
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
    model: base-model
    reasoning_effort: high
    session: fresh
    prompt: 'Base {{task.text}}'
    outcomes: [complete, blocked]
    on:
      complete: { goto: check }
      blocked: { pause: true }
  check:
    kind: command
    argv: [echo, checked]
    on:
      complete: { goto: finish }
      failed: { pause: true }
  finish:
    kind: task.complete
    on:
      complete: { goto: pick }
  done:
    kind: end
`;
const MARKDOWN =
  "# Nested work\n- [x] prechecked\n- [ ] one\n  original body\n  - [ ] two\n- [ ] manual\n";
function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-config-runner-"));
  const file = path.join(root, "state.sqlite");
  const database = new WorkflowDatabase(file);
  t.after(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(path.join(root, "tasks.md"), MARKDOWN);
  writeFileSync(path.join(root, "guidance.md"), "original guidance");
  const agent = new ScriptedAgentAdapter([{ mode: "report", outcome: "blocked" }]);
  const inputs: AgentInput[] = [];
  const service = new RunService(database, {
    agents: new Map([
      [
        "codex",
        {
          id: "codex",
          start: (input: AgentInput) => {
            inputs.push(input);
            return agent.start(input);
          },
          resumeForReportCorrection: agent.resumeForReportCorrection,
        },
      ],
    ]),
    logDir: path.join(root, "logs"),
  });
  const runId = service.createRun({ workflowText: FLOW, workflowDir: root });
  return { root, file, database, service, runId, inputs };
}

it("imports, pauses, edits task parameters, revises, skips, completes manually and loops through real reports", async (t) => {
  const f = fixture(t);
  const c = f.service.coordinator;
  const tasks = c.tasks(f.runId);
  const first = tasks[0]?.taskId;
  const manual = tasks[2]?.taskId;
  assert.ok(first && manual);
  const firstEdit = {
    steps: {
      work: { model: "first-model", prompt: "First {{task.text}}" },
      check: { skip: { outcome: "complete" } },
    },
  };
  f.service.setTaskOverrides(f.runId, first, {
    overrides: firstEdit,
    reason: "initial task choice",
  });
  c.start(f.runId);
  assert.deepEqual(await f.service.drive(f.runId), { kind: "not_running", status: "paused" });
  const original = c.inspect(f.runId);
  const firstAttempt = original.attempts[0];
  assert.ok(firstAttempt);
  const originalInput = c.attemptInput(firstAttempt.attemptId);
  assert.ok(originalInput);
  assert.equal(originalInput.model, "first-model");
  assert.equal(originalInput.harness, "codex");
  assert.equal(originalInput.reasoningEffort, "high");
  assert.match(originalInput.prompt, /First one/);
  assert.equal(originalInput.context.task?.body, "  original body");
  c.markTaskComplete(f.runId, manual, "already implemented outside this run");
  const secondEdit = {
    steps: {
      work: { model: "second-model", prompt: "Follow up {{task.text}}" },
      check: { skip: { outcome: "complete" } },
    },
  };
  f.service.setTaskOverrides(f.runId, first, {
    overrides: secondEdit,
    reason: "continue this task differently",
  });
  const revisedId = f.service.reviseWorkflow(f.runId, {
    workflowText: FLOW.replace("Base {{task.text}}", "Revised {{task.text}}"),
    reason: "remaining task instructions",
  });
  assert.notEqual(revisedId, firstAttempt.revisionId);
  writeFileSync(path.join(f.root, "tasks.md"), "- [ ] changed externally\n");
  writeFileSync(path.join(f.root, "guidance.md"), "updated guidance");
  c.resume(f.runId);
  assert.deepEqual(await f.service.drive(f.runId), { kind: "completed" });
  const state = c.inspect(f.runId);
  assert.deepEqual(
    state.tasks.map((row) => row.taskId),
    tasks.map((row) => row.taskId),
  );
  assert.deepEqual(
    state.tasks.map((row) => row.state),
    ["completed", "completed", "completed"],
  );
  assert.equal(state.taskImport?.markdown, MARKDOWN);
  assert.equal(
    readFileSync(path.join(f.root, "tasks.md"), "utf8"),
    "- [ ] changed externally\n",
    "runner never writes Markdown",
  );
  assert.equal(state.events.filter((e) => e.type === "step_skipped").length, 1);
  assert.equal(state.attempts.filter((a) => a.stepId === "check").length, 1);
  assert.equal(state.attempts.filter((a) => a.taskId === manual).length, 0);
  assert.equal(f.inputs.length, 3);
  assert.deepEqual(
    f.inputs.map((input) => input.model),
    ["first-model", "second-model", "base-model"],
  );
  assert.match(f.inputs[1]?.prompt ?? "", /Follow up one/);
  assert.match(f.inputs[2]?.prompt ?? "", /Revised two/);
  assert.deepEqual(c.attemptInput(firstAttempt.attemptId), originalInput);
  assert.deepEqual(state.attempts[0]?.taskOverrides, firstEdit);
  assert.deepEqual(state.attempts[1]?.taskOverrides, secondEdit);
  assert.deepEqual(state.attempts[2]?.taskOverrides, { steps: {} });
  for (const attempt of state.attempts.slice(1)) assert.equal(attempt.revisionId, revisedId);
  assert.equal(
    state.events.find((event) => event.type === "workflow_revised")?.revisionId,
    revisedId,
  );
  assert.equal(state.events.filter((e) => e.type === "report_accepted").length, 3);
  assert.equal(state.events.filter((e) => e.type === "correction_requested").length, 0);
  const observer = new WorkflowDatabase(f.file);
  try {
    const reopened = new RunService(observer, {
      agents: new Map(),
      logDir: path.join(f.root, "logs"),
    });
    assert.deepEqual(reopened.coordinator.inspect(f.runId), state);
    assert.deepEqual(reopened.coordinator.attemptInput(firstAttempt.attemptId), originalInput);
    assert.deepEqual(reopened.coordinator.taskOverrides(f.runId, first), secondEdit);
  } finally {
    observer.close();
  }
});

it("a changed revision requiring resume fails before launch instead of opening a fresh session", async (t) => {
  const f = fixture(t);
  const c = f.service.coordinator;
  c.start(f.runId);
  await f.service.drive(f.runId);
  assert.equal(f.inputs.length, 1);
  f.service.reviseWorkflow(f.runId, {
    workflowText: FLOW.replace("session: fresh", "session: resume"),
    reason: "explicit resume policy",
  });
  c.resume(f.runId);
  await f.service.drive(f.runId);
  const state = c.inspect(f.runId);
  assert.equal(state.run.status, "paused");
  assert.equal(state.attempts.at(-1)?.errorCode, "system.resume_unavailable");
  assert.equal(state.transitions.at(-1)?.outcome, "system.resume_unavailable");
  assert.equal(f.inputs.length, 1, "no fallback launch");
  assert.equal(state.events.filter((e) => e.type === "correction_requested").length, 0);
});
