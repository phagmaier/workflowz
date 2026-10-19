import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { observeProcessGroup, signalOwnedGroup } from "../adapters/process-identity.js";
import { WorkflowDatabase } from "../store/database.js";
import {
  type RecoveryFixture,
  type RecoveryScenario,
  startRecoveryFixture,
  untilRecovery,
} from "../test-support/recovery.js";
import { workflowText } from "../test-support/workflows.js";
import { RunService } from "./run-service.js";

const FLOW = workflowText(`start: work
steps:
  work:
    kind: command
    argv: ${JSON.stringify([process.execPath, "-e", "require('node:fs').appendFileSync('effects', 'effect\\n')"])}
    on:
      complete: { goto: done }
      failed: { pause: true }
  done:
    kind: end
`);

function request(service: RunService, runId: string) {
  const state = service.recovery(runId);
  return {
    expectedEventId: state.expectedEventId,
    attemptId: state.attempt?.attemptId ?? null,
    reason: "Operator reviewed uncertain effects and verified external cleanup",
  };
}

function unknown(t: TestContext, text = FLOW) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-decisions-"));
  writeFileSync(path.join(root, "tasks.md"), "- [ ] task\n");
  const database = new WorkflowDatabase(":memory:");
  t.after(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  const service = new RunService(database, { agents: new Map(), logDir: path.join(root, "logs") });
  const runId = service.createRun({ workflowText: text, workflowDir: root });
  service.coordinator.start(runId);
  const next = service.coordinator.advance(runId);
  assert.equal(next.kind, "attempt");
  service.reconcile(runId);
  return { service, runId, root, database };
}

function confirm(service: RunService, runId: string) {
  service.confirmExternalCleanup(runId, {
    ...request(service, runId),
    confirmedNoSurvivingOperation: true,
  });
}

describe("explicit headless recovery decisions", () => {
  it("resolves every legacy uncertain operation rather than only the newest attempt", (t) => {
    const { service, runId, database } = unknown(t);
    const first = service.recovery(runId).attempt;
    assert.ok(first);
    // Older databases can contain multiple historical interruptions backfilled by migration 7.
    database
      .prepare(`INSERT INTO attempts
      (attempt_id, run_id, step_id, revision_id, sequence_no, status, started_at, error_code, recovery_state)
      SELECT 'later-interruption', run_id, step_id, revision_id, sequence_no + 1, status, '9999',
        error_code, recovery_state FROM attempts WHERE attempt_id = ?`)
      .run(first.attemptId);
    assert.equal(service.recovery(runId).attempt?.attemptId, first.attemptId);
    confirm(service, runId);
    assert.equal(service.recovery(runId).attempt?.attemptId, "later-interruption");
    assert.throws(() =>
      service.decideRecovery(runId, { ...request(service, runId), action: "retry" }),
    );
    confirm(service, runId);
    assert.equal(service.recovery(runId).processResolved, true);
    assert.deepEqual(
      service.coordinator.inspect(runId).attempts.map((attempt) => attempt.recoveryState),
      ["unknown", "unknown"],
    );
    service.decideRecovery(runId, { ...request(service, runId), action: "end" });
    assert.equal(service.recovery(runId).run.status, "stopped");
  });

  it("keeps unknown evidence distinct from operator confirmation and launches only after explicit retry/resume/drive", async (t) => {
    const { service, runId, root } = unknown(t);
    const before = service.coordinator.inspect(runId);
    const other = service.createRun({ workflowText: FLOW, workflowDir: root });
    assert.throws(() => service.coordinator.start(other));
    assert.throws(() => service.coordinator.skipCurrentStep(runId, "complete", "bypass attempt"));
    assert.throws(() => service.coordinator.jumpTo(runId, "done", "bypass attempt"));
    assert.throws(() => service.coordinator.markTaskComplete(runId, "missing", "bypass attempt"));
    assert.throws(() =>
      service.decideRecovery(runId, { ...request(service, runId), action: "end" }),
    );
    confirm(service, runId);
    const confirmed = service.recovery(runId);
    assert.equal(confirmed.processResolved, true);
    assert.equal(confirmed.attempt?.recoveryState, "unknown");
    assert.equal(confirmed.resolution?.observation, "unknown");
    assert.equal(confirmed.run.status, "interrupted");
    assert.deepEqual(service.coordinator.inspect(runId).transitions, before.transitions);
    assert.throws(() =>
      service.decideRecovery(runId, { ...request(service, runId), action: "continue" }),
    );
    service.coordinator.jumpTo(runId, "done", "Earlier manual cursor selection");
    service.decideRecovery(runId, { ...request(service, runId), action: "retry" });
    assert.equal(service.recovery(runId).run.status, "paused");
    assert.equal(service.recovery(runId).run.cursorStepId, "work");
    assert.deepEqual(await service.drive(runId), { kind: "not_running", status: "paused" });
    service.coordinator.resume(runId, "Retry may repeat external side effects");
    assert.deepEqual(await service.drive(runId), { kind: "completed" });
    assert.equal(readFileSync(path.join(root, "effects"), "utf8"), "effect\n");
    const final = service.coordinator.inspect(runId);
    assert.equal(final.attempts[0]?.status, "interrupted");
    assert.equal(final.attempts[1]?.status, "succeeded");
    assert.equal(final.transitions[0]?.attemptId, final.attempts[1]?.attemptId);
  });

  it("continues a new between-step interruption without borrowing a resolved historical attempt", async (t) => {
    const { service, runId, root } = unknown(t);
    const interrupted = service.recovery(runId).attempt;
    confirm(service, runId);
    service.decideRecovery(runId, { ...request(service, runId), action: "retry" });
    const revisionId = service.reviseWorkflow(runId, {
      workflowText: FLOW.replaceAll("work", "revised"),
      cursorStepId: "revised",
      reason: "Choose a revised stage after inspecting uncertain effects",
    });
    service.coordinator.resume(runId, "Continue the selected revision");
    service.reconcile(runId); // Crash boundary before a new attempt is prepared.
    const recovery = service.recovery(runId);
    assert.equal(recovery.attempt, null);
    assert.equal(recovery.run.cursorStepId, "revised");
    assert.equal(recovery.run.revisionId, revisionId);
    service.decideRecovery(runId, { ...request(service, runId), action: "continue" });
    service.coordinator.resume(runId, "Explicitly continue the committed revised cursor");
    assert.deepEqual(await service.drive(runId), { kind: "completed" });
    const final = service.coordinator.inspect(runId);
    assert.equal(final.attempts[0]?.attemptId, interrupted?.attemptId);
    assert.equal(final.attempts[0]?.status, "interrupted");
    assert.equal(final.attempts[1]?.revisionId, revisionId);
    assert.equal(final.attempts[1]?.stepId, "revised");
    assert.equal(readFileSync(path.join(root, "effects"), "utf8"), "effect\n");
  });

  it("rejects missing acknowledgment, blank reasons, wrong attempts, stale and duplicate decisions without state changes", (t) => {
    const { service, runId } = unknown(t);
    const expected = service.coordinator.inspect(runId);
    const original = request(service, runId);
    const confirmation = { ...original, confirmedNoSurvivingOperation: true as const };
    assert.throws(() => service.confirmExternalCleanup(runId, { ...confirmation, reason: " " }));
    assert.throws(() =>
      service.confirmExternalCleanup(runId, {
        ...confirmation,
        confirmedNoSurvivingOperation: false as true,
      }),
    );
    assert.throws(() =>
      service.confirmExternalCleanup(runId, { ...confirmation, attemptId: "other" }),
    );
    assert.throws(() =>
      service.confirmExternalCleanup(runId, {
        ...confirmation,
        expectedEventId: original.expectedEventId - 1,
      }),
    );
    assert.deepEqual(service.coordinator.inspect(runId), expected);
    confirm(service, runId);
    assert.throws(() => service.confirmExternalCleanup(runId, confirmation));
    assert.throws(() => service.decideRecovery(runId, { ...original, action: "retry" }));
    const decision = { ...request(service, runId), action: "retry" as const };
    service.decideRecovery(runId, decision);
    const final = service.coordinator.inspect(runId);
    assert.throws(() => service.decideRecovery(runId, decision));
    assert.deepEqual(service.coordinator.inspect(runId), final);
  });

  for (const action of ["skip", "jump", "end"] as const) {
    it(`records ${action} without inventing an execution result`, async (t) => {
      const { service, runId } = unknown(t);
      confirm(service, runId);
      const base = request(service, runId);
      if (action === "skip")
        service.decideRecovery(runId, { ...base, action, outcome: "complete" });
      else if (action === "jump")
        service.decideRecovery(runId, { ...base, action, stepId: "done" });
      else service.decideRecovery(runId, { ...base, action });
      const state = service.coordinator.inspect(runId);
      assert.equal(state.attempts[0]?.status, "interrupted");
      assert.equal(state.run.status, action === "end" ? "stopped" : "paused");
      assert.equal(
        state.events.find((event) => event.type === "recovery_decided")?.data["action"],
        action,
      );
      assert.equal(
        state.events.some((event) => event.type === "invocation_started"),
        false,
      );
      if (action === "skip") {
        assert.equal(state.transitions[0]?.attemptId, null);
        assert.equal(state.transitions[0]?.outcome, "complete");
      } else assert.deepEqual(state.transitions, []);
      if (action !== "end") {
        service.coordinator.resume(runId, "Operator explicitly selected next step");
        assert.deepEqual(await service.drive(runId), { kind: "completed" });
        assert.equal(service.coordinator.inspect(runId).attempts.length, 1);
      }
    });
  }

  it("rejects undeclared skip outcomes and incompatible jump cursors atomically", (t) => {
    const { service, runId } = unknown(
      t,
      FLOW.replace(
        "  done:\n",
        "  finish_task:\n    kind: task.complete\n    on:\n      complete: { goto: done }\n  done:\n",
      ).replace(
        "start: work",
        "tasks:\n  source:\n    kind: markdown_checklist\n    path: tasks.md\nstart: work",
      ),
    );
    confirm(service, runId);
    const before = service.coordinator.inspect(runId);
    assert.throws(() =>
      service.decideRecovery(runId, {
        ...request(service, runId),
        action: "skip",
        outcome: "undeclared",
      }),
    );
    assert.throws(() =>
      service.decideRecovery(runId, {
        ...request(service, runId),
        action: "jump",
        stepId: "missing",
      }),
    );
    assert.throws(() =>
      service.decideRecovery(runId, {
        ...request(service, runId),
        action: "jump",
        stepId: "finish_task",
      }),
    );
    assert.deepEqual(service.coordinator.inspect(runId), before);
  });

  for (const type of ["recovery_cleanup_confirmed", "recovery_decided"] as const) {
    it(`rolls back canonical recovery changes if ${type} cannot commit`, (t) => {
      const { service, runId, database } = unknown(t);
      if (type === "recovery_decided") confirm(service, runId);
      const before = service.coordinator.inspect(runId);
      const recovery = service.recovery(runId);
      database
        .prepare(`CREATE TRIGGER reject_recovery BEFORE INSERT ON events
        WHEN NEW.type = '${type}' BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END`)
        .run();
      assert.throws(() => {
        if (type === "recovery_cleanup_confirmed") confirm(service, runId);
        else
          service.decideRecovery(runId, {
            ...request(service, runId),
            action: "skip",
            outcome: "complete",
          });
      });
      assert.deepEqual(service.coordinator.inspect(runId), before);
      assert.deepEqual(service.recovery(runId), recovery);
    });
  }
});

async function crashed(t: TestContext, scenario: RecoveryScenario) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-recovery-actions-"));
  const fixture = await startRecoveryFixture(root, scenario);
  await fixture.crash();
  const database = new WorkflowDatabase(fixture.file);
  const service = new RunService(database, { agents: new Map(), logDir: path.join(root, "logs") });
  t.after(async () => {
    database.close();
    await fixture.cleanup();
    rmSync(root, { recursive: true, force: true });
  });
  return { fixture, root, database, service, runId: fixture.runId };
}

describe("recovery decisions across real process boundaries", () => {
  it("terminates a surviving correction, preserves its report and frozen input, and skips only by manual decision", async (t) => {
    const { service, runId, database } = await crashed(t, "correction");
    const before = service.coordinator.inspect(runId);
    const input = database.prepare("SELECT input_json FROM attempt_inputs").get();
    const state = service.recovery(runId);
    assert.ok(state.report);
    assert.equal(state.logPaths.length, 2);
    assert.throws(() => confirm(service, runId));
    await service.terminateRecovery(runId, request(service, runId));
    assert.equal(service.recovery(runId).attempt?.recoveryState, "gone");
    assert.equal(service.recovery(runId).run.status, "interrupted");
    assert.deepEqual(service.recovery(runId).report, state.report);
    assert.deepEqual(database.prepare("SELECT input_json FROM attempt_inputs").get(), input);
    service.decideRecovery(runId, {
      ...request(service, runId),
      action: "skip",
      outcome: "complete",
    });
    service.coordinator.resume(runId, "Skip despite unknown external effects");
    assert.deepEqual(await service.drive(runId), { kind: "completed" });
    const final = service.coordinator.inspect(runId);
    assert.equal(final.attempts[0]?.status, "interrupted");
    assert.equal(final.attempts[0]?.correctionCount, 1);
    assert.equal(final.transitions[0]?.attemptId, null);
    assert.equal(
      final.events.filter((event) => event.type === "invocation_started").length,
      before.events.filter((event) => event.type === "invocation_started").length,
    );
  });

  it("refuses mismatched identities without signalling the live group", async (t) => {
    const { service, runId, database } = await crashed(t, "command");
    const original = service.recovery(runId).attempt;
    assert.ok(original?.processIdentity);
    const identity = original.processIdentity;
    try {
      database
        .prepare("UPDATE attempts SET process_identity = ? WHERE attempt_id = ?")
        .run(
          JSON.stringify({ ...identity, startTicks: String(BigInt(identity.startTicks) + 1n) }),
          original.attemptId,
        );
      service.reconcile(runId);
      await assert.rejects(service.terminateRecovery(runId, request(service, runId)));
      assert.equal(observeProcessGroup(identity), "alive");
      assert.equal(service.recovery(runId).processResolved, false);
    } finally {
      signalOwnedGroup(identity.pid, identity, "SIGKILL");
      await untilRecovery(() => observeProcessGroup(identity) === "gone");
      database
        .prepare("UPDATE attempts SET process_identity = ? WHERE attempt_id = ?")
        .run(JSON.stringify(identity), original.attemptId);
    }
  });

  it("rejects overlapping recovery and execution across facades, including direct coordinator controls", async (t) => {
    const { service, runId, database, root } = await crashed(t, "stubborn");
    const peer = new RunService(database, { agents: new Map(), logDir: path.join(root, "logs") });
    const pending = service.terminateRecovery(runId, request(service, runId));
    const other = peer.createRun({ workflowText: FLOW, workflowDir: root });
    await assert.rejects(peer.drive(other));
    await assert.rejects(peer.terminateRecovery(runId, request(peer, runId)));
    assert.throws(() => peer.reconcile(runId));
    assert.throws(() => confirm(peer, runId));
    assert.throws(() => peer.coordinator.start(other));
    assert.throws(() => peer.coordinator.resume(runId, "cannot overlap termination"));
    await pending;
    assert.equal(service.recovery(runId).processResolved, true);
    assert.equal(readFileSync(path.join(root, "effects"), "utf8"), "effect\n");
  });

  it("requires continue rather than retry between committed steps", async (t) => {
    const { service, runId, root } = await crashed(t, "between");
    const before = service.coordinator.inspect(runId);
    assert.equal(service.recovery(runId).attempt, null);
    assert.throws(() =>
      service.decideRecovery(runId, { ...request(service, runId), action: "retry" }),
    );
    service.decideRecovery(runId, { ...request(service, runId), action: "continue" });
    service.coordinator.resume(runId, "Continue committed cursor");
    assert.deepEqual(await service.drive(runId), { kind: "completed" });
    assert.deepEqual(service.coordinator.inspect(runId).transitions, before.transitions);
    assert.equal(readFileSync(path.join(root, "effects"), "utf8"), "effect\n");
  });
  it("persists an unidentified correction cleanup decision without relabelling it as observed absence", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wf-unidentified-reopen-"));
    const fixture = await startRecoveryFixture(root, "correction-intent");
    await fixture.crash();
    let database = new WorkflowDatabase(fixture.file);
    try {
      let service = new RunService(database, {
        agents: new Map(),
        logDir: path.join(root, "logs"),
      });
      const original = service.recovery(fixture.runId);
      confirm(service, fixture.runId);
      database.close();
      database = new WorkflowDatabase(fixture.file);
      service = new RunService(database, { agents: new Map(), logDir: path.join(root, "logs") });
      const reopened = service.recovery(fixture.runId);
      assert.equal(reopened.attempt?.recoveryState, "unknown");
      assert.equal(reopened.resolution?.observation, "unknown");
      assert.equal(reopened.processResolved, true);
      assert.equal(reopened.attempt?.correctionCount, 1);
      assert.equal(reopened.attempt?.sessionId, original.attempt?.sessionId);
      assert.equal(reopened.run.status, "interrupted");
      assert.deepEqual(service.coordinator.inspect(fixture.runId).transitions, []);
      service.decideRecovery(fixture.runId, { ...request(service, fixture.runId), action: "end" });
      assert.equal(service.recovery(fixture.runId).run.status, "stopped");
      assert.equal(service.recovery(fixture.runId).attempt?.status, "interrupted");
    } finally {
      database.close();
      await fixture.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  });

  for (const boundary of ["termination-request", "termination-finish"] as const) {
    it(`does not replay recovery signalling after SIGKILL at ${boundary}`, async () => {
      const root = mkdtempSync(path.join(os.tmpdir(), "wf-termination-crash-"));
      const fixture = await startRecoveryFixture(root, "command");
      let database: WorkflowDatabase | undefined;
      let recoveryOwner: RecoveryFixture | undefined;
      try {
        await fixture.crash();
        recoveryOwner = await startRecoveryFixture(root, boundary);
        await recoveryOwner.crash();
        database = new WorkflowDatabase(fixture.file);
        const service = new RunService(database, {
          agents: new Map(),
          logDir: path.join(root, "logs"),
        });
        const state = service.recovery(fixture.runId);
        assert.equal(state.run.status, "interrupted");
        assert.equal(
          state.attempt?.recoveryState,
          boundary === "termination-request" ? "alive" : "gone",
        );
        assert.equal(state.attempt?.status, "interrupted");
        const events = service.coordinator.inspect(fixture.runId).events;
        assert.equal(
          events.filter((event) => event.type === "recovery_termination_requested").length,
          1,
        );
        assert.equal(
          events.filter((event) => event.type === "recovery_termination_finished").length,
          0,
        );
        assert.equal(events.filter((event) => event.type === "invocation_started").length, 1);
        assert.deepEqual(await service.drive(fixture.runId), {
          kind: "not_running",
          status: "interrupted",
        });
        if (boundary === "termination-request")
          await service.terminateRecovery(fixture.runId, request(service, fixture.runId));
        service.decideRecovery(fixture.runId, {
          ...request(service, fixture.runId),
          action: "end",
        });
        assert.equal(readFileSync(path.join(root, "effects"), "utf8"), "effect\n");
      } finally {
        database?.close();
        await recoveryOwner?.cleanup();
        await fixture.cleanup();
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
  for (const type of ["recovery_termination_requested", "recovery_termination_finished"] as const) {
    it(`retains a barrier when the ${type} audit fails`, async (t) => {
      const { service, runId, database } = await crashed(t, "command");
      const identity = service.recovery(runId).attempt?.processIdentity;
      assert.ok(identity);
      const before = service.coordinator.inspect(runId);
      database
        .prepare(`CREATE TRIGGER reject_termination BEFORE INSERT ON events
        WHEN NEW.type = '${type}' BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END`)
        .run();
      await assert.rejects(service.terminateRecovery(runId, request(service, runId)));
      assert.equal(service.recovery(runId).processResolved, false);
      assert.equal(service.recovery(runId).attempt?.recoveryState, "alive");
      assert.equal(
        observeProcessGroup(identity),
        type === "recovery_termination_requested" ? "alive" : "gone",
      );
      if (type === "recovery_termination_requested")
        assert.deepEqual(service.coordinator.inspect(runId), before);
      database.prepare("DROP TRIGGER reject_termination").run();
      if (type === "recovery_termination_requested")
        await service.terminateRecovery(runId, request(service, runId));
      else service.reconcile(runId);
      assert.equal(service.recovery(runId).processResolved, true);
      assert.equal(service.recovery(runId).run.status, "interrupted");
    });
  }
});
