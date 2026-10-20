import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { AgentAdapter } from "../adapters/agent-adapter.js";
import { WorkflowDatabase } from "../store/database.js";
import { ScriptedAgentAdapter } from "../test-support/scripted-agent.js";
import { workflowText } from "../test-support/workflows.js";
import { type BrowserRunStatus, ManagementService } from "./management-service.js";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(t: TestContext, adapter: AgentAdapter, release: () => void) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-management-service-"));
  const database = new WorkflowDatabase(":memory:");
  const management = new ManagementService(
    database,
    path.join(root, "logs"),
    new Map([["codex", adapter]]),
  );
  t.after(async () => {
    release();
    await management.shutdown();
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  const coordinator = management.service.coordinator;
  const expected = (runId: string) => management.store.latestEventId(runId);
  const paused = async (runId: string) => {
    const deadline = Date.now() + 10000;
    while (coordinator.run(runId).status !== "paused") {
      if (Date.now() >= deadline) throw new Error("run did not pause");
      await delay(10);
    }
  };
  return { root, management, coordinator, expected, paused };
}

describe("management admission and inspection", { timeout: 20000 }, () => {
  it("discloses all selected agent modes before execution and updates them with the selected revision", async (t) => {
    const adapter = new ScriptedAgentAdapter([]);
    const f = fixture(t, adapter, () => {});
    const expected = [
      { stepId: "codex", harness: "codex", mode: "dangerously-bypass-approvals-and-sandbox" },
      { stepId: "claude", harness: "claude", mode: "bypassPermissions" },
      { stepId: "omp", harness: "omp", mode: "yolo" },
      { stepId: "opencode", harness: "opencode", mode: "session-allow-all" },
      { stepId: "pi", harness: "pi", mode: "default-unrestricted-tools" },
    ];
    const command = `start: before
steps:
  before:
    kind: command
    argv: [echo, fixture]
    on:
      complete: {goto: done}
      failed: {pause: true}
  done: {kind: end}
`;
    const runId = f.management.service.createRun({
      workflowDir: f.root,
      workflowText: workflowText(
        command +
          expected
            .map(
              ({ stepId, harness }) => `  ${stepId}:
    kind: agent
    harness: ${harness}
    session: fresh
    prompt: Never launched
    outcomes: [complete]
    on:
      complete: {goto: done}
`,
            )
            .join(""),
      ),
    });
    const status = () => f.management.handle({ op: "status", runId }) as Promise<BrowserRunStatus>;
    const ready = await status();
    assert.equal(ready.current?.kind, "command");
    assert.deepEqual(ready.configuredPermissions, expected);
    assert.equal(ready.activeAttempt, null);
    assert.deepEqual(
      f.management.store.listEvents(runId).filter((e) => e.type === "invocation_started"),
      [],
    );
    f.management.service.reviseWorkflow(runId, {
      workflowText: workflowText(command),
      reason: "select command-only revision",
    });
    assert.deepEqual((await status()).configuredPermissions, []);
    assert.deepEqual(f.management.store.listAttempts(runId), []);
  });

  it("pauses synchronously at shutdown admission before the current attempt can settle", async (t) => {
    const release = deferred();
    const processSettled = deferred();
    const scripted = new ScriptedAgentAdapter([{ mode: "report", outcome: "complete" }]);
    const adapter: AgentAdapter = {
      id: "codex",
      capabilities: scripted.capabilities,
      start(input) {
        const handle = scripted.start(input);
        return {
          ...handle,
          completed: handle.completed.then(async (result) => {
            processSettled.resolve();
            await release.promise;
            return result;
          }),
        };
      },
    };
    const f = fixture(t, adapter, release.resolve);
    const runId = f.management.service.createRun({
      workflowDir: f.root,
      workflowText: workflowText(`start: work
steps:
  work:
    kind: agent
    harness: codex
    session: fresh
    prompt: Offline fixture
    outcomes: [complete]
    on:
      complete: {goto: next}
  next:
    kind: command
    argv: ["${process.execPath}", "-e", "require('node:fs').writeFileSync('effects', 'x')"]
    on:
      complete: {goto: done}
      failed: {pause: true}
  done: {kind: end}
`),
    });
    await f.management.handle({ op: "start", runId, expectedEventId: f.expected(runId) });
    await processSettled.promise;
    f.management.requestShutdown();
    assert.equal(f.coordinator.run(runId).status, "pausing");
    release.resolve();
    // Reproduce settlement before deferred daemon teardown has called shutdown().
    await f.paused(runId);
    assert.equal(f.coordinator.run(runId).cursorStepId, "next");
    assert.equal(existsSync(path.join(f.root, "effects")), false);
  });

  it("reports current task model settings while paused and uses them on resume", async (t) => {
    const release = deferred();
    const resumed = deferred();
    const models: (string | undefined)[] = [];
    const scripted = new ScriptedAgentAdapter([
      { mode: "report", outcome: "complete" },
      { mode: "report", outcome: "complete" },
    ]);
    const adapter: AgentAdapter = {
      id: "codex",
      capabilities: scripted.capabilities,
      start(input) {
        models.push(input.model);
        const handle = scripted.start(input);
        if (models.length !== 2) return handle;
        resumed.resolve();
        return {
          ...handle,
          completed: handle.completed.then(async (result) => {
            await release.promise;
            return result;
          }),
        };
      },
    };
    const f = fixture(t, adapter, release.resolve);
    writeFileSync(path.join(f.root, "tasks.md"), "- [ ] first task\n");
    const runId = f.management.service.createRun({
      workflowDir: f.root,
      workflowText: workflowText(`tasks:
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
    model: base-model
    session: fresh
    prompt: Offline fixture
    outcomes: [complete]
    on:
      complete: {pause: true}
  done: {kind: end}
`),
    });
    const task = f.coordinator.tasks(runId)[0];
    assert.ok(task);
    const editModel = (model?: string) =>
      f.management.handle({
        op: "task-overrides",
        runId,
        taskId: task.taskId,
        expectedEventId: f.expected(runId),
        edit: {
          overrides: { steps: model === undefined ? {} : { work: { model } } },
          reason: "select task model",
        },
      });
    const status = async () =>
      (await f.management.handle({ op: "status", runId })) as {
        current: { model: string };
        activeAttempt: unknown;
      };
    await editModel("first-model");
    await f.management.handle({ op: "start", runId, expectedEventId: f.expected(runId) });
    await f.paused(runId);
    assert.equal((await status()).activeAttempt, null);
    assert.equal((await status()).current.model, "first-model");
    await editModel("second-model");
    assert.equal((await status()).current.model, "second-model");
    await editModel();
    assert.equal((await status()).current.model, "base-model");
    await editModel("resumed-model");
    await f.management.handle({
      op: "resume",
      runId,
      expectedEventId: f.expected(runId),
      reason: "execute selected task settings",
    });
    await resumed.promise;
    assert.ok((await status()).activeAttempt);
    assert.equal((await status()).current.model, "resumed-model");
    assert.deepEqual(models, ["first-model", "resumed-model"]);
    release.resolve();
    await f.paused(runId);
  });
});
