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
    await fixture.cleanup(); // Explicit smoke-owner decision; runtime recovery sends no signals.
    service.reconcile(fixture.runId);
    if (scenario === "command" || scenario === "between") {
      assert.equal(readFileSync(path.join(root, "effects"), "utf8"), "effect\n");
      service.coordinator.resume(
        fixture.runId,
        "smoke operator explicitly authorizes continuation",
      );
      assert.deepEqual(await service.drive(fixture.runId), { kind: "completed" });
      assert.equal(
        readFileSync(path.join(root, "effects"), "utf8"),
        scenario === "command" ? "effect\neffect\n" : "effect\n",
      );
    }
    const final = service.coordinator.inspect(fixture.runId);
    database.close();
    database = undefined;
    database = new WorkflowDatabase(fixture.file);
    assert.deepEqual(new RunCoordinator(database).inspect(fixture.runId), final);
    console.log(
      `${scenario}: competing writer refused; SIGKILL recovery interrupted without replay; process=${expectedState ?? "settled"}; durable reopen verified`,
    );
  } finally {
    database?.close();
    if (fixture) await fixture.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
}
console.log("Owned smoke projects, processes, sessions, leases and databases removed.");
