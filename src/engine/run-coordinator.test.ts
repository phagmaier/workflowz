import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { WorkflowDatabase } from "../store/database.js";
import { workflowText } from "../test-support/workflows.js";
import {
  type AdvanceResult,
  AttemptNotActiveError,
  RunCoordinator,
  RunStateError,
  type Settlement,
  UndeclaredOutcomeError,
  UnknownAttemptError,
  WorkflowInvalidError,
} from "./run-coordinator.js";

const temporaryDirectories: string[] = [];
after(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Deterministic clock and ids, so a test's state and event log are reproducible. */
function harness(
  options: { maxEngineStepsPerAdvance?: number; failClockAfter?: { calls: number } } = {},
) {
  let tick = 0;
  const clock = () => {
    if (options.failClockAfter) {
      if (options.failClockAfter.calls <= 0) {
        throw new Error("injected write failure");
      }
      options.failClockAfter.calls -= 1;
    }
    tick += 1;
    return new Date(Date.UTC(2026, 0, 1) + tick * 1000).toISOString();
  };
  // Random suffixes keep ids unique across coordinators that share one database file.
  return { clock, newId: (prefix: string) => `${prefix}_${randomUUID()}` };
}

function open(file = ":memory:", options: Parameters<typeof harness>[0] = {}) {
  const database = new WorkflowDatabase(file);
  const parts = harness(options);
  const coordinator = new RunCoordinator(database, {
    now: parts.clock,
    newId: parts.newId,
    ...(options.maxEngineStepsPerAdvance === undefined
      ? {}
      : { maxEngineStepsPerAdvance: options.maxEngineStepsPerAdvance }),
  });
  return { database, coordinator };
}

/** Task loop used by most tests: pick a task, build it, check it, finish it, repeat until exhausted. */
const TASK_LOOP = workflowText(`tasks:
  source:
    kind: markdown_checklist
    path: todo.md
start: pick
steps:
  pick:
    kind: task.next
    on:
      task_ready: { goto: build }
      exhausted: { goto: done }
  build:
    kind: agent
    harness: codex
    session: fresh
    prompt: "Do {{task.text}}"
    outcomes: [complete, blocked]
    on:
      complete: { goto: check }
      blocked: { pause: true }
  check:
    kind: command
    argv: [echo, ok]
    on:
      complete: { goto: finish }
      failed: { pause: true }
  finish:
    kind: task.complete
    on:
      complete: { goto: pick }
  done:
    kind: end
    label: all done
`);

const TWO_TASKS = [
  { sourceOrder: 0, sourceIdentity: "todo.md:3", title: "first" },
  { sourceOrder: 1, sourceIdentity: "todo.md:4", title: "second" },
];

/** Advances and settles attempts until the run stops, returning how many attempts ran. */
function runToStop(
  coordinator: RunCoordinator,
  runId: string,
  settle: (attemptId: string, stepId: string) => Settlement,
): { attempts: number; final: AdvanceResult } {
  let attempts = 0;
  for (;;) {
    const result = coordinator.advance(runId);
    if (result.kind === "attempt") {
      attempts += 1;
      coordinator.settle(result.attemptId, settle(result.attemptId, result.stepId));
      continue;
    }
    return { attempts, final: result };
  }
}

const ALWAYS_COMPLETE = (): Settlement => ({ kind: "outcome", outcome: "complete" });

describe("RunCoordinator: simulated task loop", () => {
  it("runs from task to task and ends the run, committing one transition per attempt", () => {
    const { database, coordinator } = open();
    const runId = coordinator.createRun({
      workflowText: TASK_LOOP,
      workflowDir: os.tmpdir(),
      tasks: TWO_TASKS,
    });
    coordinator.start(runId);

    const { attempts, final } = runToStop(coordinator, runId, ALWAYS_COMPLETE);
    assert.deepEqual(final, { kind: "completed" });
    assert.equal(attempts, 4, "build and check, for each of two tasks");

    const state = coordinator.inspect(runId);
    assert.equal(state.run.status, "completed");
    assert.equal(state.run.activeTaskId, null);
    assert.deepEqual(
      state.tasks.map((task) => task.state),
      ["completed", "completed"],
    );
    assert.equal(state.activeAttempt, undefined);
    assert.equal(state.attention.length, 0);

    const attemptTransitions = state.transitions.filter(
      (transition) => transition.attemptId !== null,
    );
    assert.equal(
      attemptTransitions.length,
      attempts,
      "exactly one transition per finalized attempt",
    );
    assert.equal(new Set(attemptTransitions.map((t) => t.attemptId)).size, attempts);
    assert.equal(
      state.transitions.length,
      2 * 4 + 1,
      "engine steps and attempts, plus the final exhausted pick",
    );

    const types = state.events.map((event) => event.type);
    assert.equal(types.filter((type) => type === "task_activated").length, 2);
    assert.equal(types.filter((type) => type === "task_completed").length, 2);
    assert.equal(types.at(-1), "run_completed");
    database.close();
  });

  it("returns the same attempt, and no second one, while an attempt is still active", () => {
    const { database, coordinator } = open();
    const runId = coordinator.createRun({
      workflowText: TASK_LOOP,
      workflowDir: os.tmpdir(),
      tasks: TWO_TASKS,
    });
    coordinator.start(runId);

    const first = coordinator.advance(runId);
    assert.equal(first.kind, "attempt");
    const again = coordinator.advance(runId);
    assert.deepEqual(again, {
      kind: "in_progress",
      attemptId: first.kind === "attempt" ? first.attemptId : "",
      stepId: "build",
    });
    database.close();
  });
});

describe("RunCoordinator: persistence", () => {
  it("resumes the same run after the database is closed and reopened", () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), "wf-run-")), "state.sqlite");
    temporaryDirectories.push(path.dirname(file));

    const first = open(file);
    const runId = first.coordinator.createRun({
      workflowText: TASK_LOOP,
      workflowDir: os.tmpdir(),
      tasks: TWO_TASKS,
    });
    first.coordinator.start(runId);
    const attempt = first.coordinator.advance(runId);
    assert.equal(attempt.kind, "attempt");
    if (attempt.kind !== "attempt") return;
    first.coordinator.settle(attempt.attemptId, { kind: "outcome", outcome: "complete" });
    const before = first.coordinator.inspect(runId);
    first.database.close();

    const second = open(file);
    const after = second.coordinator.inspect(runId);
    assert.deepEqual(after.run, before.run);
    assert.deepEqual(after.tasks, before.tasks);
    assert.equal(after.transitions.length, before.transitions.length);
    assert.equal(after.events.length, before.events.length);

    const { final } = runToStop(second.coordinator, runId, ALWAYS_COMPLETE);
    assert.deepEqual(final, { kind: "completed" });
    assert.equal(second.coordinator.inspect(runId).run.status, "completed");
    second.database.close();
  });
});

describe("RunCoordinator: rejected and duplicate settlements", () => {
  it("rejects an undeclared outcome before any state changes", () => {
    const { database, coordinator } = open();
    const runId = coordinator.createRun({
      workflowText: TASK_LOOP,
      workflowDir: os.tmpdir(),
      tasks: TWO_TASKS,
    });
    coordinator.start(runId);
    const attempt = coordinator.advance(runId);
    assert.equal(attempt.kind, "attempt");
    if (attempt.kind !== "attempt") return;

    const eventsBefore = coordinator.inspect(runId).events.length;
    assert.throws(
      () => coordinator.settle(attempt.attemptId, { kind: "outcome", outcome: "not_declared" }),
      UndeclaredOutcomeError,
    );
    assert.throws(
      () => coordinator.settle(attempt.attemptId, { kind: "outcome", outcome: "system.timeout" }),
      UndeclaredOutcomeError,
    );

    const state = coordinator.inspect(runId);
    assert.equal(state.events.length, eventsBefore);
    assert.equal(state.activeAttempt?.status, "starting");
    assert.equal(state.run.cursorStepId, "build");
    database.close();
  });

  it("commits only one transition per attempt; a second settlement is refused", () => {
    const { database, coordinator } = open();
    const runId = coordinator.createRun({
      workflowText: TASK_LOOP,
      workflowDir: os.tmpdir(),
      tasks: TWO_TASKS,
    });
    coordinator.start(runId);
    const attempt = coordinator.advance(runId);
    if (attempt.kind !== "attempt") throw new Error("expected an attempt");

    coordinator.settle(attempt.attemptId, { kind: "outcome", outcome: "complete" });
    assert.throws(
      () => coordinator.settle(attempt.attemptId, { kind: "outcome", outcome: "blocked" }),
      AttemptNotActiveError,
    );
    const state = coordinator.inspect(runId);
    const transitions = state.transitions.filter((t) => t.attemptId === attempt.attemptId);
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0]?.outcome, "complete");
    assert.equal(
      transitions[0]?.revisionId,
      state.run.revisionId,
      "transitions name their revision",
    );
    const settled = state.events.filter(
      (event) => event.type === "attempt_settled" && event.attemptId === attempt.attemptId,
    );
    assert.equal(settled.length, 1, "a refused duplicate appends no second event");
    database.close();
  });

  it("refuses to settle an attempt that does not exist", () => {
    const { database, coordinator } = open();
    assert.throws(
      () => coordinator.settle("nope", { kind: "outcome", outcome: "complete" }),
      UnknownAttemptError,
    );
    database.close();
  });
});

describe("RunCoordinator: atomic writes", () => {
  it("rolls back a settlement whose later write fails, leaving the attempt and cursor unchanged", () => {
    const failure = { calls: Number.POSITIVE_INFINITY };
    const { database, coordinator } = open(":memory:", { failClockAfter: failure });
    const runId = coordinator.createRun({
      workflowText: TASK_LOOP,
      workflowDir: os.tmpdir(),
      tasks: TWO_TASKS,
    });
    coordinator.start(runId);
    const attempt = coordinator.advance(runId);
    if (attempt.kind !== "attempt") throw new Error("expected an attempt");

    // The settlement writes the attempt status and its event first, then fails on the transition row.
    failure.calls = 2;
    assert.throws(
      () => coordinator.settle(attempt.attemptId, { kind: "outcome", outcome: "complete" }),
      /injected write failure/,
    );
    failure.calls = Number.POSITIVE_INFINITY;

    const state = coordinator.inspect(runId);
    assert.equal(state.activeAttempt?.status, "starting", "attempt status write was rolled back");
    assert.equal(
      state.events.some((event) => event.type === "attempt_settled"),
      false,
    );
    assert.equal(state.transitions.filter((t) => t.attemptId === attempt.attemptId).length, 0);
    assert.equal(state.run.cursorStepId, "build");
    database.close();
  });
});

describe("RunCoordinator: failures route through the workflow", () => {
  it("pauses with a blocking attention item when an attempt fails with a system error", () => {
    const { database, coordinator } = open();
    const runId = coordinator.createRun({
      workflowText: TASK_LOOP,
      workflowDir: os.tmpdir(),
      tasks: TWO_TASKS,
    });
    coordinator.start(runId);
    const attempt = coordinator.advance(runId);
    if (attempt.kind !== "attempt") throw new Error("expected an attempt");

    coordinator.settle(attempt.attemptId, { kind: "system", code: "system.spawn_error" });
    const state = coordinator.inspect(runId);
    assert.equal(state.run.status, "paused");
    assert.equal(state.attention.length, 1);
    assert.equal(state.attention[0]?.severity, "blocking");
    assert.match(state.attention[0]?.message ?? "", /system\.spawn_error/);
    assert.equal(coordinator.advance(runId).kind, "not_running");
    database.close();
  });

  it("pauses when a task.complete runs with no active task (a task state error)", () => {
    const { database, coordinator } = open();
    const text = TASK_LOOP.replace("start: pick", "start: finish");
    const runId = coordinator.createRun({
      workflowText: text,
      workflowDir: os.tmpdir(),
      tasks: TWO_TASKS,
    });
    coordinator.start(runId);
    assert.equal(coordinator.advance(runId).kind, "not_running");
    assert.equal(coordinator.inspect(runId).run.status, "paused");
    database.close();
  });

  it("retries a failing command up to max_attempts, then routes system.retry_exhausted", () => {
    const text = workflowText(`defaults:
  on:
    system.retry_exhausted: { goto: done }
start: build
steps:
  build:
    kind: command
    argv: [echo, x]
    on:
      complete: { goto: done }
      failed: { retry: { max_attempts: 2 } }
  done:
    kind: end
`);
    const { database, coordinator } = open();
    const runId = coordinator.createRun({ workflowText: text, workflowDir: os.tmpdir() });
    coordinator.start(runId);
    const { attempts, final } = runToStop(coordinator, runId, () => ({
      kind: "outcome",
      outcome: "failed",
    }));
    assert.equal(attempts, 2);
    assert.deepEqual(final, { kind: "completed" });
    database.close();
  });

  it("pauses rather than looping forever when only engine steps run", () => {
    const text = workflowText(`tasks:
  source:
    kind: markdown_checklist
    path: todo.md
start: pick
steps:
  pick:
    kind: task.next
    on:
      task_ready: { goto: pick }
      exhausted: { goto: pick }
`);
    const { database, coordinator } = open(":memory:", { maxEngineStepsPerAdvance: 50 });
    const runId = coordinator.createRun({ workflowText: text, workflowDir: os.tmpdir() });
    coordinator.start(runId);
    assert.equal(coordinator.advance(runId).kind, "not_running");
    const state = coordinator.inspect(runId);
    assert.equal(state.run.status, "paused");
    assert.equal(state.attention[0]?.category, "engine_loop");
    database.close();
  });
});

describe("RunCoordinator: limits", () => {
  it("pauses when the step-execution limit is reached", () => {
    const text = workflowText(`limits:
  max_step_executions: 3
start: a
steps:
  a:
    kind: command
    argv: [echo]
    on:
      complete: { goto: a }
      failed: { pause: true }
`);
    const { database, coordinator } = open();
    const runId = coordinator.createRun({ workflowText: text, workflowDir: os.tmpdir() });
    coordinator.start(runId);
    const { attempts, final } = runToStop(coordinator, runId, ALWAYS_COMPLETE);
    assert.equal(attempts, 3);
    assert.equal(final.kind, "not_running");
    const state = coordinator.inspect(runId);
    assert.equal(state.run.status, "paused");
    assert.equal(state.attention[0]?.category, "limit_max_step_executions");
    database.close();
  });

  it("pauses when the wall-clock limit is reached", () => {
    const text = workflowText(`limits:
  max_wall_time_seconds: 1
start: a
steps:
  a:
    kind: command
    argv: [echo]
    on:
      complete: { goto: a }
      failed: { pause: true }
`);
    const { database, coordinator } = open();
    const runId = coordinator.createRun({ workflowText: text, workflowDir: os.tmpdir() });
    coordinator.start(runId);
    // The test clock advances one second per call, so the one-second limit is reached quickly.
    const { final } = runToStop(coordinator, runId, ALWAYS_COMPLETE);
    assert.equal(final.kind, "not_running");
    assert.equal(coordinator.inspect(runId).attention[0]?.category, "limit_max_wall_time");
    database.close();
  });
});

describe("RunCoordinator: guards", () => {
  it("refuses to create a run from an invalid workflow", () => {
    const { database, coordinator } = open();
    assert.throws(
      () => coordinator.createRun({ workflowText: "version: 2\n", workflowDir: os.tmpdir() }),
      WorkflowInvalidError,
    );
    database.close();
  });

  it("refuses to start a run that is not ready", () => {
    const { database, coordinator } = open();
    const runId = coordinator.createRun({
      workflowText: TASK_LOOP,
      workflowDir: os.tmpdir(),
      tasks: TWO_TASKS,
    });
    coordinator.start(runId);
    assert.throws(() => coordinator.start(runId), RunStateError);
    database.close();
  });
});
