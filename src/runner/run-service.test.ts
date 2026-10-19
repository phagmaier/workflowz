import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { WorkflowDatabase } from "../store/database.js";
import { type AgentScript, ScriptedAgentAdapter } from "../test-support/scripted-agent.js";
import { workflowText } from "../test-support/workflows.js";
import { RunService } from "./run-service.js";

const directories: string[] = [];
after(() => {
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** A fresh project directory, a log file for agent start/end markers, and a run service. */
function fixture(
  plan: readonly AgentScript[],
  options: { databaseFile?: string; root?: string } = {},
) {
  const root = options.root ?? mkdtempSync(path.join(os.tmpdir(), "wf-run-"));
  if (options.root === undefined) {
    directories.push(root);
  }
  const logFile = path.join(root, "agent.log");
  const adapter = new ScriptedAgentAdapter(plan, { logFile });
  const database = new WorkflowDatabase(options.databaseFile ?? ":memory:");
  const service = new RunService(database, {
    agents: new Map([["codex", adapter]]),
    logDir: path.join(root, "logs"),
  });
  return { root, database, service, logFile };
}

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    assert.ok(Date.now() < deadline, "condition was not reached in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const TWO_TASKS = [
  { sourceOrder: 0, sourceIdentity: "todo.md:1", title: "first task" },
  { sourceOrder: 1, sourceIdentity: "todo.md:2", title: "second task" },
];

/**
 * The headless workflow the phase 3 gate runs: an agent, then command steps. `check` fails until
 * `fix` creates the marker file, so the branch taken depends on real filesystem state.
 */
const HEADLESS = workflowText(`tasks:
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
    prompt: "Implement {{task.text}}"
    outcomes: [complete, blocked]
    on:
      complete: { goto: announce }
      blocked: { pause: true }
  announce:
    kind: command
    argv: [sh, -c, "printf 'announced {{task.id}}'"]
    on:
      complete: { goto: check }
      failed: { pause: true }
  check:
    kind: command
    argv: [sh, -c, "test -f marker.txt"]
    on:
      complete: { goto: record }
      failed: { goto: fix }
  fix:
    kind: command
    argv: [sh, -c, "touch marker.txt"]
    on:
      complete: { goto: check }
      failed: { pause: true }
  record:
    kind: command
    argv: [sh, -c, "printf '%s' '{{steps.announce.stdout}}' > seen.txt"]
    on:
      complete: { goto: finish }
      failed: { pause: true }
  finish:
    kind: task.complete
    on:
      complete: { goto: pick }
  done:
    kind: end
    label: all tasks done
`);

/** Single-step workflow used by most failure-mode tests: one agent step, routed by its outcome. */
function oneAgent(onOutcome: string): string {
  return workflowText(`start: build
steps:
  build:
    kind: agent
    harness: codex
    session: fresh
    prompt: go
    outcomes: [complete, blocked]
    on:
      complete: { goto: done }
      blocked: { pause: true }
      ${onOutcome}
  done:
    kind: end
`);
}

describe("RunService: headless workflow (phase 3 gate)", () => {
  it("follows deterministic branches through agent and command steps, one attempt at a time", async () => {
    const { root, database, service } = fixture([
      { mode: "report", outcome: "complete" },
      { mode: "report", outcome: "complete" },
    ]);
    const runId = service.coordinator.createRun({
      workflowText: HEADLESS,
      workflowDir: root,
      tasks: TWO_TASKS,
    });
    service.coordinator.start(runId);

    assert.deepEqual(await service.drive(runId), { kind: "completed" });

    const state = service.coordinator.inspect(runId);
    assert.equal(state.run.status, "completed");
    assert.deepEqual(
      state.tasks.map((task) => task.state),
      ["completed", "completed"],
    );

    const attemptTransitions = state.transitions
      .filter((transition) => transition.attemptId !== null)
      .map((transition) => [transition.fromStepId, transition.outcome, transition.toStepId]);
    assert.deepEqual(attemptTransitions, [
      ["build", "complete", "announce"],
      ["announce", "complete", "check"],
      ["check", "failed", "fix"],
      ["fix", "complete", "check"],
      ["check", "complete", "record"],
      ["record", "complete", "finish"],
      ["build", "complete", "announce"],
      ["announce", "complete", "check"],
      ["check", "complete", "record"],
      ["record", "complete", "finish"],
    ]);
    assert.equal(
      state.attempts.length,
      attemptTransitions.length,
      "one transition per finalized attempt",
    );

    // Commands run for real: the marker was created, and the last record used announce's stdout.
    assert.equal(existsSync(path.join(root, "marker.txt")), true);
    assert.equal(
      readFileSync(path.join(root, "seen.txt"), "utf8"),
      `announced ${state.tasks[1]?.taskId}`,
    );
    database.close();
  });

  it("never starts an attempt while another is unsettled, as shown by the event order", async () => {
    const { root, database, service } = fixture([]);
    const runId = service.coordinator.createRun({
      workflowText: HEADLESS,
      workflowDir: root,
      tasks: TWO_TASKS,
    });
    service.coordinator.start(runId);
    await service.drive(runId);

    const starts = service.coordinator
      .inspect(runId)
      .events.filter(
        (event) => event.type === "attempt_started" || event.type === "attempt_settled",
      );
    const kinds = starts.map((event) => event.type);
    for (let index = 0; index < kinds.length; index += 2) {
      assert.deepEqual(kinds.slice(index, index + 2), ["attempt_started", "attempt_settled"]);
      assert.equal(starts[index]?.attemptId, starts[index + 1]?.attemptId);
    }
    database.close();
  });
});

describe("RunService: pause and stop", () => {
  it("pause-after-current lets the running attempt finish, routes it, and starts nothing new", async () => {
    const { root, database, service, logFile } = fixture([{ mode: "delay", extra: "200" }]);
    const runId = service.coordinator.createRun({
      workflowText: HEADLESS,
      workflowDir: root,
      tasks: TWO_TASKS,
    });
    service.coordinator.start(runId);

    const driving = service.drive(runId);
    await until(() => service.coordinator.activeAttempt(runId) !== undefined);
    service.requestPause(runId);
    assert.equal(service.coordinator.inspect(runId).run.status, "pausing");

    assert.deepEqual(await driving, { kind: "not_running", status: "paused" });
    const state = service.coordinator.inspect(runId);
    assert.equal(state.run.cursorStepId, "announce", "the routed outcome moved the cursor");
    assert.equal(state.attempts.length, 1, "no second attempt started");
    assert.equal(state.attempts[0]?.status, "succeeded");
    assert.equal(state.attention.at(-1)?.category, "user_pause");
    assert.equal(state.attention.at(-1)?.severity, "info");
    assert.equal(
      readFileSync(logFile, "utf8")
        .split("\n")
        .filter((line) => line.startsWith("start")).length,
      1,
    );
    database.close();
  });

  it("stop-now terminates the agent's whole process tree and records the stop", async () => {
    const pidFile = path.join(mkdtempSync(path.join(os.tmpdir(), "wf-pid-")), "child.pid");
    directories.push(path.dirname(pidFile));
    const { root, database, service } = fixture([{ mode: "hang-with-child", extra: pidFile }]);
    const runId = service.coordinator.createRun({
      workflowText: HEADLESS,
      workflowDir: root,
      tasks: TWO_TASKS,
    });
    service.coordinator.start(runId);

    const driving = service.drive(runId);
    await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "");
    const childPid = Number(readFileSync(pidFile, "utf8"));
    await service.stop(runId, "test stop");

    assert.deepEqual(await driving, { kind: "stopped" });
    assert.throws(
      () => process.kill(childPid, 0),
      (error: NodeJS.ErrnoException) => error.code === "ESRCH",
    );
    const state = service.coordinator.inspect(runId);
    assert.equal(state.run.status, "stopped");
    assert.equal(state.attempts.length, 1, "no attempt starts after a stop");
    assert.equal(state.attempts[0]?.status, "interrupted");
    assert.equal(
      state.transitions.filter((t) => t.attemptId !== null).length,
      0,
      "a stopped attempt routes nothing",
    );
    database.close();
  });

  it("stop-now also ends a running command", async () => {
    const text = workflowText(`start: sleepy
steps:
  sleepy:
    kind: command
    argv: [sleep, "30"]
    on:
      complete: { goto: done }
      failed: { pause: true }
  done:
    kind: end
`);
    const { root, database, service } = fixture([]);
    const runId = service.coordinator.createRun({ workflowText: text, workflowDir: root });
    service.coordinator.start(runId);
    const driving = service.drive(runId);
    await until(() => service.coordinator.activeAttempt(runId) !== undefined);
    await service.stop(runId);
    assert.deepEqual(await driving, { kind: "stopped" });
    assert.equal(service.coordinator.inspect(runId).run.status, "stopped");
    database.close();
  });
});

describe("RunService: restart, recovery, and overrides", () => {
  it("resumes a paused run from its cursor in a new process, after reopening the database", async () => {
    const databaseFile = path.join(
      mkdtempSync(path.join(os.tmpdir(), "wf-restart-")),
      "state.sqlite",
    );
    const root = mkdtempSync(path.join(os.tmpdir(), "wf-restart-root-"));
    directories.push(path.dirname(databaseFile), root);

    const first = fixture([{ mode: "delay", extra: "150" }], { databaseFile, root });
    const runId = first.service.coordinator.createRun({
      workflowText: HEADLESS,
      workflowDir: root,
      tasks: TWO_TASKS,
    });
    first.service.coordinator.start(runId);
    const driving = first.service.drive(runId);
    await until(() => first.service.coordinator.activeAttempt(runId) !== undefined);
    first.service.requestPause(runId);
    await driving;
    first.database.close();

    const second = fixture([], { databaseFile, root });
    assert.equal(second.service.coordinator.inspect(runId).run.status, "paused");
    second.service.coordinator.resume(runId, "restarted for the test");
    assert.deepEqual(await second.service.drive(runId), { kind: "completed" });
    const state = second.service.coordinator.inspect(runId);
    const sequences = state.attempts.map((attempt) => attempt.sequenceNo);
    assert.deepEqual(
      sequences,
      [...sequences].sort((a, b) => a - b),
      "attempt numbering continues across restarts",
    );
    assert.equal(state.run.status, "completed");
    second.database.close();
  });

  it("marks an attempt left active by a dead process as interrupted, and never replays it on its own", async () => {
    const { root, database, service } = fixture([{ mode: "report", outcome: "complete" }]);
    const runId = service.coordinator.createRun({
      workflowText: HEADLESS,
      workflowDir: root,
      tasks: TWO_TASKS,
    });
    service.coordinator.start(runId);
    // Simulate a crash between dispatch and settlement: the attempt is recorded, nothing runs it.
    assert.equal(service.coordinator.advance(runId).kind, "attempt");

    assert.equal(service.reconcile(runId), true);
    let state = service.coordinator.inspect(runId);
    assert.equal(state.run.status, "interrupted");
    assert.equal(state.attempts[0]?.status, "interrupted");
    assert.equal(state.attention.at(-1)?.category, "uncertain_attempt");
    assert.deepEqual(await service.drive(runId), { kind: "not_running", status: "interrupted" });

    service.coordinator.resume(runId, "operator reviewed the log");
    assert.deepEqual(await service.drive(runId), { kind: "completed" });
    state = service.coordinator.inspect(runId);
    assert.equal(
      state.attempts.length,
      1 + state.transitions.filter((t) => t.attemptId !== null).length,
    );
    database.close();
  });

  it("a failed agent step pauses the run with a blocking item and does not start another turn", async () => {
    const { root, database, service } = fixture([{ mode: "crash" }]);
    const runId = service.coordinator.createRun({ workflowText: oneAgent(""), workflowDir: root });
    service.coordinator.start(runId);
    assert.deepEqual(await service.drive(runId), { kind: "not_running", status: "paused" });
    const state = service.coordinator.inspect(runId);
    assert.equal(state.attempts.length, 1, "a crash is not corrected by another turn");
    assert.equal(state.attempts[0]?.errorCode, "system.process_error");
    assert.equal(state.attention[0]?.severity, "blocking");
    database.close();
  });

  it("an undeclared outcome in the report is a report error, and routes like any other engine error", async () => {
    const { root, database, service } = fixture([{ mode: "report", outcome: "bogus" }]);
    const runId = service.coordinator.createRun({ workflowText: oneAgent(""), workflowDir: root });
    service.coordinator.start(runId);
    assert.deepEqual(await service.drive(runId), { kind: "not_running", status: "paused" });
    assert.equal(service.coordinator.inspect(runId).transitions[0]?.outcome, "system.report_error");
    database.close();
  });

  it("a clean exit without a report is a report error", async () => {
    const { root, database, service } = fixture([{ mode: "silent" }]);
    const runId = service.coordinator.createRun({ workflowText: oneAgent(""), workflowDir: root });
    service.coordinator.start(runId);
    await service.drive(runId);
    assert.equal(service.coordinator.inspect(runId).transitions[0]?.outcome, "system.report_error");
    database.close();
  });

  it("a missing command binary is a spawn error that a workflow can route", async () => {
    const text = workflowText(`start: run
steps:
  run:
    kind: command
    argv: [workflowz-no-such-binary]
    on:
      complete: { goto: done }
      failed: { pause: true }
      system.spawn_error: { goto: done }
  done:
    kind: end
`);
    const { root, database, service } = fixture([]);
    const runId = service.coordinator.createRun({ workflowText: text, workflowDir: root });
    service.coordinator.start(runId);
    assert.deepEqual(await service.drive(runId), { kind: "completed" });
    assert.equal(service.coordinator.inspect(runId).transitions[0]?.outcome, "system.spawn_error");
    database.close();
  });

  it("a command that exceeds its timeout routes system.timeout", async () => {
    const text = workflowText(`start: slow
steps:
  slow:
    kind: command
    argv: [sleep, "30"]
    timeout_seconds: 1
    on:
      complete: { goto: done }
      failed: { pause: true }
      system.timeout: { goto: done }
  done:
    kind: end
`);
    const { root, database, service } = fixture([]);
    const runId = service.coordinator.createRun({ workflowText: text, workflowDir: root });
    service.coordinator.start(runId);
    assert.deepEqual(await service.drive(runId), { kind: "completed" });
    assert.equal(service.coordinator.inspect(runId).transitions[0]?.outcome, "system.timeout");
    database.close();
  });

  it("a working directory that does not exist is a spawn error, and no process starts", async () => {
    const text = workflowText(`start: run
steps:
  run:
    kind: command
    argv: [touch, made.txt]
    cwd: nowhere
    on:
      complete: { goto: done }
      failed: { pause: true }
  done:
    kind: end
`);
    const { root, database, service } = fixture([]);
    const runId = service.coordinator.createRun({ workflowText: text, workflowDir: root });
    service.coordinator.start(runId);
    assert.deepEqual(await service.drive(runId), { kind: "not_running", status: "paused" });
    assert.equal(service.coordinator.inspect(runId).transitions[0]?.outcome, "system.spawn_error");
    database.close();
  });

  it("an interpolation with no value fails before any process starts", async () => {
    const marker = "never-created.txt";
    const text = workflowText(`start: announce
steps:
  announce:
    kind: command
    argv: [sh, -c, "printf '%s' '{{steps.never.stdout}}'; touch ${marker}"]
    on:
      complete: { goto: done }
      failed: { pause: true }
  never:
    kind: command
    argv: ["true"]
    on:
      complete: { goto: done }
      failed: { pause: true }
  done:
    kind: end
`);
    const { root, database, service } = fixture([]);
    const runId = service.coordinator.createRun({ workflowText: text, workflowDir: root });
    service.coordinator.start(runId);
    assert.deepEqual(await service.drive(runId), { kind: "not_running", status: "paused" });
    assert.equal(
      service.coordinator.inspect(runId).transitions[0]?.outcome,
      "system.internal_error",
    );
    assert.equal(
      existsSync(path.join(root, marker)),
      false,
      "no process ran with a broken argument",
    );
    database.close();
  });

  it("manual overrides: skip, jump, and mark a task complete, each recorded with a reason", async () => {
    const { root, database, service } = fixture([{ mode: "report", outcome: "blocked" }]);
    const runId = service.coordinator.createRun({
      workflowText: HEADLESS,
      workflowDir: root,
      tasks: TWO_TASKS,
    });
    service.coordinator.start(runId);
    await service.drive(runId);
    assert.equal(
      service.coordinator.inspect(runId).run.status,
      "paused",
      "the blocked outcome paused the run",
    );

    assert.throws(
      () => service.coordinator.skipCurrentStep(runId, "complete", "  "),
      /needs a reason/,
    );
    assert.throws(() => service.coordinator.jumpTo(runId, "nowhere", "typo check"), /no such step/);

    service.coordinator.skipCurrentStep(runId, "complete", "reviewed by hand");
    assert.equal(service.coordinator.inspect(runId).run.cursorStepId, "announce");
    service.coordinator.jumpTo(runId, "record", "skip straight to recording");
    service.coordinator.markTaskComplete(
      runId,
      service.coordinator.tasks(runId)[1]?.taskId ?? "",
      "already done elsewhere",
    );

    const overrides = service.coordinator
      .inspect(runId)
      .events.filter((event) => event.type === "manual_override");
    assert.deepEqual(
      overrides.map((event) => event.data["action"]),
      ["skip", "jump", "mark_task_complete"],
    );
    assert.equal(service.coordinator.tasks(runId)[1]?.state, "completed");
    database.close();
  });
});
