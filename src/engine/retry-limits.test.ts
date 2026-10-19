import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { WorkflowDatabase } from "../store/database.js";
import { workflowText } from "../test-support/workflows.js";
import { RunCoordinator } from "./run-coordinator.js";

const RETRY = workflowText(`start: work
steps:
  work:
    kind: command
    argv: ["false"]
    on:
      complete: {goto: done}
      failed: {retry: {max_attempts: 2, backoff_seconds: 10}}
      system.retry_exhausted: {pause: true}
  done: {kind: end}
`);

function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-retry-limits-"));
  let time = Date.UTC(2026, 0, 1);
  const now = () => new Date(time).toISOString();
  let database = new WorkflowDatabase(path.join(root, "state.sqlite"));
  let coordinator = new RunCoordinator(database, { now });
  t.after(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  const create = (text = RETRY, tasks?: Parameters<RunCoordinator["createRun"]>[0]["tasks"]) => {
    const runId = coordinator.createRun({
      workflowText: text,
      workflowDir: root,
      ...(tasks ? { tasks } : {}),
    });
    coordinator.start(runId);
    return runId;
  };
  const attempt = (runId: string) => {
    const next = coordinator.advance(runId);
    assert.equal(next.kind, "attempt");
    return next.attemptId;
  };
  return {
    get database() {
      return database;
    },
    get coordinator() {
      return coordinator;
    },
    now,
    tick: (ms: number) => {
      time += ms;
    },
    create,
    attempt,
    reopen: () => {
      database.close();
      database = new WorkflowDatabase(path.join(root, "state.sqlite"));
      coordinator = new RunCoordinator(database, { now });
    },
  };
}

describe("durable retry waits and run limits", () => {
  it("counts retries separately for each imported task", (t) => {
    const f = fixture(t);
    const text = RETRY.replace(
      "start: work",
      "tasks:\n  source: {kind: markdown_checklist, path: tasks.md}\nstart: pick",
    )
      .replace(
        "steps:\n",
        "steps:\n  pick:\n    kind: task.next\n    on:\n      task_ready: {goto: work}\n      exhausted: {goto: done}\n  finish:\n    kind: task.complete\n    on:\n      complete: {goto: pick}\n",
      )
      .replace("complete: {goto: done}", "complete: {goto: finish}");
    const runId = f.create(text, [
      { sourceOrder: 0, sourceIdentity: "first", title: "first" },
      { sourceOrder: 1, sourceIdentity: "second", title: "second" },
    ]);
    for (let i = 0; i < 2; i++) {
      f.coordinator.settle(f.attempt(runId), { kind: "outcome", outcome: "failed" });
      assert.equal(f.coordinator.advance(runId).kind, "waiting");
      f.tick(10000);
      f.coordinator.settle(f.attempt(runId), { kind: "outcome", outcome: "complete" });
    }
    assert.equal(f.coordinator.advance(runId).kind, "completed");
    const state = f.coordinator.inspect(runId);
    assert.equal(state.attempts.length, 4);
    assert.equal(new Set(state.attempts.map((a) => a.taskId)).size, 2);
    assert.equal(state.tasks.filter((t) => t.state === "completed").length, 2);
  });

  it("persists backoff and counts across interruption, explicit continuation and revision", (t) => {
    const f = fixture(t);
    const runId = f.create();
    f.coordinator.settle(f.attempt(runId), { kind: "outcome", outcome: "failed" });
    const due = new Date(Date.parse(f.now()) + 10000).toISOString();
    assert.equal(f.coordinator.run(runId).retryNotBefore, due);
    assert.deepEqual(f.coordinator.advance(runId), { kind: "waiting", until: due, delayMs: 10000 });
    assert.equal(f.coordinator.inspect(runId).attempts.length, 1);
    f.reopen();
    f.coordinator.reconcileAfterRestart(runId, "unknown");
    assert.equal(f.coordinator.run(runId).status, "interrupted");
    assert.equal(f.coordinator.run(runId).retryNotBefore, due);
    const recovery = f.coordinator.recovery(runId);
    assert.equal(recovery.attempt, null);
    f.coordinator.decideRecovery(runId, {
      expectedEventId: recovery.expectedEventId,
      attemptId: null,
      action: "continue",
      reason: "continue committed retry after inspecting effects",
    });
    f.coordinator.reviseWorkflow(runId, {
      workflowText: RETRY.replace("name: test", "name: revised"),
      reason: "revise remaining definition",
    });
    f.coordinator.resume(runId, "explicit continuation");
    f.tick(9999);
    assert.equal(f.coordinator.advance(runId).kind, "waiting");
    f.tick(1);
    const second = f.attempt(runId);
    assert.equal(f.coordinator.run(runId).retryNotBefore, null);
    f.coordinator.settle(second, { kind: "outcome", outcome: "failed" });
    const state = f.coordinator.inspect(runId);
    assert.equal(state.attempts.length, 2);
    assert.equal(state.transitions.at(-1)?.outcome, "system.retry_exhausted");
    assert.equal(state.run.status, "paused");
    assert.equal(state.run.retryNotBefore, null);
  });

  it("preserves a paused retry deadline and cancels it through an explicit cursor override", (t) => {
    const f = fixture(t);
    const runId = f.create();
    f.coordinator.settle(f.attempt(runId), { kind: "outcome", outcome: "failed" });
    const due = f.coordinator.run(runId).retryNotBefore;
    f.coordinator.requestPause(runId);
    f.coordinator.resume(runId);
    assert.equal(f.coordinator.run(runId).retryNotBefore, due);
    assert.equal(f.coordinator.advance(runId).kind, "waiting");
    f.coordinator.requestPause(runId);
    f.coordinator.jumpTo(runId, "done", "explicitly abandon retry");
    assert.equal(f.coordinator.run(runId).retryNotBefore, null);
    f.coordinator.resume(runId);
    assert.equal(f.coordinator.advance(runId).kind, "completed");
  });

  it("rolls back retry scheduling, settlement and counters if the transition audit fails", (t) => {
    const f = fixture(t);
    const runId = f.create();
    const attempt = f.attempt(runId);
    const before = f.coordinator.inspect(runId);
    f.database
      .prepare(
        "CREATE TRIGGER fail_retry BEFORE INSERT ON events WHEN NEW.type = 'transition_committed' BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
      )
      .run();
    assert.throws(
      () => f.coordinator.settle(attempt, { kind: "outcome", outcome: "failed" }),
      /test audit failure/,
    );
    assert.deepEqual(f.coordinator.inspect(runId), before);
  });

  it("checks durable step and wall limits before another retry can be admitted", (t) => {
    const f = fixture(t);
    const runId = f.create(
      RETRY.replace("start: work", "limits: {max_step_executions: 1}\nstart: work"),
    );
    f.coordinator.settle(f.attempt(runId), { kind: "outcome", outcome: "failed" });
    f.reopen();
    assert.equal(f.coordinator.advance(runId).kind, "not_running");
    assert.equal(
      f.coordinator.inspect(runId).attention.at(-1)?.category,
      "limit_max_step_executions",
    );
    const wall = f.create(
      RETRY.replace("start: work", "limits: {max_wall_time_seconds: 2}\nstart: work"),
    );
    f.coordinator.settle(f.attempt(wall), { kind: "outcome", outcome: "failed" });
    const waiting = f.coordinator.advance(wall);
    assert.equal(waiting.kind, "waiting");
    assert.equal(waiting.delayMs, 2000);
    f.tick(2000);
    assert.equal(f.coordinator.advance(wall).kind, "not_running");
    assert.equal(f.coordinator.inspect(wall).attempts.length, 1);
    assert.equal(f.coordinator.inspect(wall).attention.at(-1)?.category, "limit_max_wall_time");
  });
});
