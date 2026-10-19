// Offline actual-surface smoke: real owner crashes, commands, wf reports and SQLite reopen.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { RunCoordinator } from "../dist/engine/run-coordinator.js";
import { RunService } from "../dist/runner/run-service.js";
import { InstanceLockError, WorkflowDatabase } from "../dist/store/database.js";
import { REPO_ROOT } from "../dist/test-support/paths.js";
import { startRecoveryFixture } from "../dist/test-support/recovery.js";

for (const scenario of ["command", "correction", "between", "correction-intent"]) {
  const root = mkdtempSync(path.join(REPO_ROOT, ".tmp-recovery-smoke-"));
  let fixture;
  let database;
  try {
    fixture = await startRecoveryFixture(root, scenario);
    assert.throws(() => new WorkflowDatabase(fixture.file), InstanceLockError);
    const reader = new WorkflowDatabase(fixture.file, { readOnly: true });
    const before = new RunCoordinator(reader).inspect(fixture.runId);
    reader.close();
    await fixture.crash();
    database = new WorkflowDatabase(fixture.file);
    const service = new RunService(database, {
      agents: new Map(),
      logDir: path.join(root, "logs"),
    });
    const state = service.coordinator.inspect(fixture.runId);
    assert.equal(state.run.status, "interrupted");
    assert.deepEqual(await service.drive(fixture.runId), {
      kind: "not_running",
      status: "interrupted",
    });
    assert.equal(state.attempts.length, 1);
    const expectedState =
      scenario === "between" ? null : scenario === "correction-intent" ? "unknown" : "alive";
    assert.equal(state.attempts[0].recoveryState, expectedState);
    assert.deepEqual(state.transitions, before.transitions);
    assert.deepEqual(
      state.events.filter((e) => e.type === "report_accepted"),
      before.events.filter((e) => e.type === "report_accepted"),
    );
    if (scenario !== "between")
      assert.throws(() =>
        service.coordinator.resume(fixture.runId, "unsettled process is not a safe resume"),
      );
    const request = () => {
      const recovery = service.recovery(fixture.runId);
      return {
        expectedEventId: recovery.expectedEventId,
        attemptId: recovery.attempt?.attemptId ?? null,
        reason: "Smoke operator reviewed uncertain effects and explicitly chose recovery",
      };
    };
    if (scenario === "command" || scenario === "correction") {
      await service.terminateRecovery(fixture.runId, request());
      assert.equal(service.recovery(fixture.runId).attempt.recoveryState, "gone");
    } else if (scenario === "correction-intent") {
      // The fixture stopped before spawn. Only its operator knows this; durable intent cannot prove it.
      await fixture.cleanup();
      service.confirmExternalCleanup(fixture.runId, {
        ...request(),
        confirmedNoSurvivingOperation: true,
      });
      assert.equal(service.recovery(fixture.runId).attempt.recoveryState, "unknown");
      assert.equal(service.recovery(fixture.runId).resolution.observation, "unknown");
    }
    const action =
      scenario === "command"
        ? "retry"
        : scenario === "between"
          ? "continue"
          : scenario === "correction"
            ? "skip"
            : "end";
    service.decideRecovery(fixture.runId, {
      ...request(),
      action,
      ...(action === "skip" ? { outcome: "complete" } : {}),
    });
    if (action !== "end") {
      assert.equal(service.recovery(fixture.runId).run.status, "paused");
      service.coordinator.resume(
        fixture.runId,
        "Smoke operator explicitly authorizes selected continuation",
      );
      assert.deepEqual(await service.drive(fixture.runId), { kind: "completed" });
    } else assert.equal(service.recovery(fixture.runId).run.status, "stopped");
    if (scenario === "command" || scenario === "between")
      assert.equal(
        readFileSync(path.join(root, "effects"), "utf8"),
        scenario === "command" ? "effect\neffect\n" : "effect\n",
      );
    if (scenario === "correction") {
      assert.equal(service.coordinator.inspect(fixture.runId).attempts[0].status, "interrupted");
      assert.equal(service.coordinator.inspect(fixture.runId).transitions[0].attemptId, null);
    }
    const final = service.coordinator.inspect(fixture.runId);
    database.close();
    database = undefined;
    database = new WorkflowDatabase(fixture.file);
    assert.deepEqual(new RunCoordinator(database).inspect(fixture.runId), final);
    console.log(
      `${scenario}: SIGKILL recovery without replay; explicit ${action}; durable process decision and reopen verified`,
    );
  } finally {
    database?.close();
    if (fixture) await fixture.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
}
console.log("Owned smoke projects, processes, sessions, leases and databases removed.");
