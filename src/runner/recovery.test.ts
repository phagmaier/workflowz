import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { observeProcessGroup, signalOwnedGroup } from "../adapters/process-identity.js";
import { RunCoordinator } from "../engine/run-coordinator.js";
import { InstanceLockError, WorkflowDatabase } from "../store/database.js";
import {
  type RecoveryScenario,
  startRecoveryFixture,
  untilRecovery,
} from "../test-support/recovery.js";
import { workflowText } from "../test-support/workflows.js";
import { RunService } from "./run-service.js";

const END = workflowText("start: done\nsteps:\n  done:\n    kind: end\n");
const AGENT = workflowText(`start: work
steps:
  work:
    kind: agent
    harness: codex
    session: fresh
    prompt: Offline fixture
    outcomes: [complete]
    on:
      complete: { goto: done }
  done:
    kind: end
`);

async function fixture(t: TestContext, scenario: RecoveryScenario) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-recovery-"));
  const running = await startRecoveryFixture(root, scenario);
  t.after(async () => {
    await running.cleanup();
    rmSync(root, { recursive: true, force: true });
  });
  return { ...running, root };
}
const openService = (database: WorkflowDatabase, root: string) =>
  new RunService(database, { agents: new Map(), logDir: path.join(root, "logs") });

function inspectFile(file: string, runId: string) {
  const database = new WorkflowDatabase(file, { readOnly: true });
  try {
    return new RunCoordinator(database).inspect(runId);
  } finally {
    database.close();
  }
}

describe("startup owner and process reconciliation", () => {
  for (const scenario of ["command", "agent", "correction"] as const) {
    it(`reconciles a SIGKILL during ${scenario} without signalling, routing a report or replaying work`, async (t) => {
      const f = await fixture(t, scenario);
      assert.throws(() => new WorkflowDatabase(f.file), InstanceLockError);
      const before = inspectFile(f.file, f.runId);
      const original = before.attempts[0];
      assert.ok(original?.processIdentity);
      assert.equal(original.pid, original.processIdentity.pid);
      assert.equal(original.pgid, original.processIdentity.pgid);
      assert.equal(
        before.events.filter((e) => e.type === "invocation_started").length,
        scenario === "correction" ? 2 : 1,
      );
      const reports = before.events.filter((e) => e.type === "report_accepted");
      assert.equal(reports.length, scenario === "command" ? 0 : 1);
      await f.crash();
      const database = new WorkflowDatabase(f.file);
      try {
        const service = openService(database, f.root);
        const state = service.coordinator.inspect(f.runId);
        assert.equal(state.run.status, "interrupted");
        assert.equal(state.attempts[0]?.status, "interrupted");
        assert.equal(state.attempts[0]?.recoveryState, "alive");
        assert.equal(state.attention.at(-1)?.category, "uncertain_attempt");
        assert.deepEqual(
          state.events.filter((e) => e.type === "report_accepted"),
          reports,
        );
        assert.equal(state.transitions.length, 0);
        assert.equal(observeProcessGroup(original.processIdentity), "alive");
        assert.throws(() => service.coordinator.resume(f.runId, "reviewed effects"));
        const other = service.createRun({ workflowText: END, workflowDir: f.root });
        assert.throws(() => service.coordinator.start(other));
        assert.deepEqual(await service.drive(f.runId), {
          kind: "not_running",
          status: "interrupted",
        });
        assert.equal(service.coordinator.inspect(f.runId).attempts.length, 1);
        assert.equal(service.reconcile(f.runId), false, "unchanged observation is idempotent");
        // This is an explicit test-owner cleanup decision, not automatic recovery behaviour.
        signalOwnedGroup(original.processIdentity.pid, original.processIdentity, "SIGKILL");
        await untilRecovery(() => observeProcessGroup(original.processIdentity) === "gone");
        assert.equal(service.reconcile(f.runId), true);
        assert.equal(service.coordinator.inspect(f.runId).attempts[0]?.recoveryState, "gone");
        assert.equal(service.coordinator.inspect(f.runId).run.status, "interrupted");
        assert.throws(
          () => service.coordinator.resume(f.runId),
          "interrupted effects need explicit acknowledgment",
        );
        if (scenario === "command") {
          assert.equal(readFileSync(path.join(f.root, "effects"), "utf8"), "effect\n");
          service.coordinator.resume(f.runId, "explicitly retry the interrupted command");
          assert.deepEqual(await service.drive(f.runId), { kind: "completed" });
          assert.equal(readFileSync(path.join(f.root, "effects"), "utf8"), "effect\neffect\n");
        }
      } finally {
        database.close();
      }
      const durable = inspectFile(f.file, f.runId);
      assert.equal(durable.run.status, scenario === "command" ? "completed" : "interrupted");
      assert.equal(durable.attempts[0]?.recoveryState, "gone");
      assert.deepEqual(
        durable.events.filter((e) => e.type === "report_accepted"),
        reports,
      );
    });
  }

  it("never signals a PID with a mismatched or malformed recorded start identity", async (t) => {
    const f = await fixture(t, "command");
    const original = inspectFile(f.file, f.runId).attempts[0];
    assert.ok(original?.processIdentity);
    const identity = original.processIdentity;
    await f.crash();
    const database = new WorkflowDatabase(f.file);
    try {
      database
        .prepare("UPDATE attempts SET process_identity = ? WHERE attempt_id = ?")
        .run(
          JSON.stringify({ ...identity, startTicks: String(BigInt(identity.startTicks) + 1n) }),
          original.attemptId,
        );
      const service = openService(database, f.root);
      assert.equal(service.coordinator.inspect(f.runId).attempts[0]?.recoveryState, "mismatch");
      assert.equal(observeProcessGroup(identity), "alive");
      assert.throws(() => service.coordinator.resume(f.runId, "cannot authorize this PID"));
      database
        .prepare("UPDATE attempts SET process_identity = ? WHERE attempt_id = ?")
        .run('{"pid":"untrusted"}', original.attemptId);
      service.reconcile(f.runId);
      assert.equal(service.coordinator.inspect(f.runId).attempts[0]?.recoveryState, "unknown");
      assert.equal(observeProcessGroup(identity), "alive");
      assert.throws(() =>
        service.coordinator.recordStop(f.runId, "not proof of process settlement"),
      );
    } finally {
      if (observeProcessGroup(identity) === "alive")
        signalOwnedGroup(identity.pid, identity, "SIGKILL");
      await untilRecovery(() => observeProcessGroup(identity) === "gone");
      database.close();
    }
  });

  it("does not mistake the settled original identity for an unrecorded correction process", async (t) => {
    const f = await fixture(t, "correction-intent");
    const before = inspectFile(f.file, f.runId);
    assert.equal(before.attempts[0]?.correctionCount, 1);
    assert.equal(before.attempts[0]?.pid, null);
    assert.equal(before.attempts[0]?.processIdentity, null);
    assert.equal(before.events.filter((e) => e.type === "invocation_settled").length, 1);
    await f.crash();
    const database = new WorkflowDatabase(f.file);
    try {
      const service = openService(database, f.root);
      const state = service.coordinator.inspect(f.runId);
      assert.equal(state.run.status, "interrupted");
      assert.equal(state.attempts[0]?.recoveryState, "unknown");
      assert.equal(service.coordinator.reportFor(state.attempts[0]?.attemptId ?? ""), undefined);
      assert.throws(() =>
        service.coordinator.resume(f.runId, "original absence is not correction absence"),
      );
      assert.deepEqual(await service.drive(f.runId), {
        kind: "not_running",
        status: "interrupted",
      });
      assert.equal(
        service.coordinator.inspect(f.runId).events.filter((e) => e.type === "invocation_started")
          .length,
        1,
      );
    } finally {
      database.close();
    }
  });

  it("pauses between committed steps and does not replay the completed side effect", async (t) => {
    const f = await fixture(t, "between");
    const before = inspectFile(f.file, f.runId);
    assert.equal(before.run.status, "running");
    assert.equal(before.run.cursorStepId, "done");
    assert.equal(before.attempts[0]?.status, "succeeded");
    await f.crash();
    const database = new WorkflowDatabase(f.file);
    try {
      const service = openService(database, f.root);
      assert.deepEqual(await service.drive(f.runId), {
        kind: "not_running",
        status: "interrupted",
      });
      assert.equal(
        service.coordinator.inspect(f.runId).attention.at(-1)?.category,
        "interrupted_run",
      );
      service.coordinator.resume(f.runId, "continue after reviewing the committed step");
      assert.deepEqual(await service.drive(f.runId), { kind: "completed" });
      const after = service.coordinator.inspect(f.runId);
      assert.deepEqual(after.attempts, before.attempts);
      assert.deepEqual(after.transitions, before.transitions);
      assert.equal(readFileSync(path.join(f.root, "effects"), "utf8"), "effect\n");
    } finally {
      database.close();
    }
  });

  it("rolls interruption state and attention back if its audit event cannot be committed", () => {
    const database = new WorkflowDatabase(":memory:");
    try {
      const coordinator = new RunCoordinator(database);
      const runId = coordinator.createRun({ workflowText: AGENT, workflowDir: os.tmpdir() });
      coordinator.start(runId);
      coordinator.advance(runId);
      const before = coordinator.inspect(runId);
      database
        .prepare(`CREATE TRIGGER reject_interruption BEFORE INSERT ON events
        WHEN NEW.type = 'run_interrupted' BEGIN SELECT RAISE(ABORT, 'fixture interruption failure'); END`)
        .run();
      assert.throws(() => coordinator.reconcileAfterRestart(runId, "gone"));
      assert.deepEqual(coordinator.inspect(runId), before);
      database.prepare("DROP TRIGGER reject_interruption").run();
      coordinator.reconcileAfterRestart(runId, "gone");
      assert.equal(coordinator.inspect(runId).run.status, "interrupted");
      assert.equal(coordinator.inspect(runId).attempts[0]?.recoveryState, "gone");
    } finally {
      database.close();
    }
  });
});
