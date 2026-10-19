import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { AgentAdapter, AgentInput } from "../adapters/agent-adapter.js";
import { observeProcessGroup } from "../adapters/process-identity.js";
import { WorkflowDatabase } from "../store/database.js";
import { type AgentScript, ScriptedAgentAdapter } from "../test-support/scripted-agent.js";
import { workflowText } from "../test-support/workflows.js";
import { RunService } from "./run-service.js";

const AGENT = workflowText(`start: work
steps:
  work:
    kind: agent
    harness: codex
    session: fresh
    prompt: Offline limit fixture
    outcomes: [complete, again]
    on:
      complete: {goto: done}
      again: {retry: {max_attempts: 2, backoff_seconds: 1}}
      system.timeout: {goto: done}
      system.retry_exhausted: {pause: true}
  done: {kind: end}
`);

function fixture(
  t: TestContext,
  plan: readonly AgentScript[],
  adapter?: AgentAdapter,
  now?: () => string,
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-run-limits-"));
  const database = new WorkflowDatabase(path.join(root, "state.sqlite"));
  const service = new RunService(database, {
    ...(now ? { now } : {}),
    agents: new Map([["codex", adapter ?? new ScriptedAgentAdapter(plan)]]),
    logDir: path.join(root, "logs"),
  });
  let drive: Promise<unknown> | undefined;
  let runId = "";
  t.after(async () => {
    if (drive) {
      const status = service.coordinator.run(runId).status;
      if (status === "running" || status === "pausing") await service.stop(runId);
      await drive;
    }
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  const start = (text = AGENT) => {
    runId = service.createRun({ workflowText: text, workflowDir: root });
    service.coordinator.start(runId);
    drive = service.drive(runId);
    return { runId, drive };
  };
  return { root, database, service, start };
}

async function until(read: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!read()) {
    assert.ok(Date.now() < deadline, "fixture condition timed out");
    await delay(10);
  }
}

describe("run limits and stage retry execution", { timeout: 20000 }, () => {
  it("does not reserve or launch correction after the run budget is already spent", async (t) => {
    let time = Date.UTC(2026, 0, 1);
    let corrections = 0;
    const scripted = new ScriptedAgentAdapter([{ mode: "silent" }]);
    const adapter: AgentAdapter = {
      id: "codex",
      capabilities: scripted.capabilities,
      start(input) {
        const running = scripted.start(input);
        return {
          ...running,
          completed: running.completed.then((result) => {
            time += 2000;
            return result;
          }),
        };
      },
      resumeForReportCorrection() {
        corrections++;
        throw new Error("must not launch");
      },
    };
    const f = fixture(t, [], adapter, () => new Date(time).toISOString());
    const { runId, drive } = f.start(
      AGENT.replace("start: work", "limits: {max_wall_time_seconds: 1}\nstart: work"),
    );
    await drive;
    const state = f.service.coordinator.inspect(runId);
    assert.equal(corrections, 0);
    assert.equal(state.attempts[0]?.correctionCount, 0);
    assert.equal(state.attempts[0]?.errorCode, "system.timeout");
    assert.equal(state.attention.at(-1)?.category, "limit_max_wall_time");
  });

  it("waits after settlement, keeps correction inside each attempt and exhausts the durable stage budget", async (t) => {
    const f = fixture(t, [
      { mode: "silent" },
      { mode: "report", outcome: "again" },
      { mode: "silent" },
      { mode: "report", outcome: "again" },
    ]);
    const { runId, drive } = f.start();
    await drive;
    const state = f.service.coordinator.inspect(runId);
    assert.equal(state.run.status, "paused");
    assert.equal(state.attempts.length, 2);
    assert.deepEqual(
      state.attempts.map((a) => a.correctionCount),
      [1, 1],
    );
    assert.equal(state.events.filter((e) => e.type === "invocation_started").length, 4);
    assert.equal(state.transitions.at(-1)?.outcome, "system.retry_exhausted");
    assert.ok(
      Date.parse(state.attempts[1]?.startedAt ?? "") -
        Date.parse(state.transitions[0]?.committedAt ?? "") >=
        1000,
    );
    assert.notEqual(state.attempts[0]?.sessionId, state.attempts[1]?.sessionId);
  });

  it("pauses or stops promptly during a long backoff without dispatching another attempt", async (t) => {
    for (const action of ["pause", "stop"] as const) {
      const f = fixture(t, [{ mode: "report", outcome: "again" }]);
      const { runId, drive } = f.start(AGENT.replace("backoff_seconds: 1", "backoff_seconds: 60"));
      await until(() => f.service.coordinator.inspect(runId).transitions.length === 1);
      const time = Date.now();
      if (action === "pause") f.service.requestPause(runId);
      else await f.service.stop(runId);
      await drive;
      assert.ok(Date.now() - time < 1000, "controls must wake the retry wait");
      const state = f.service.coordinator.inspect(runId);
      assert.equal(state.run.status, action === "pause" ? "paused" : "stopped");
      assert.equal(state.attempts.length, 1);
    }
  });

  for (const kind of ["agent", "command"] as const) {
    it(`terminates a hanging ${kind} at the run wall deadline and pauses despite timeout routing`, async (t) => {
      const f = fixture(t, [{ mode: "report-then-hang", outcome: "complete" }]);
      const text =
        kind === "agent"
          ? AGENT
          : AGENT.replace(
              / {4}kind: agent[\s\S]*? {4}on:/,
              '    kind: command\n    argv: ["sleep", "30"]\n    on:\n      failed: {pause: true}',
            ).replace(/ {6}again:.*\n/, "");
      const { runId, drive } = f.start(
        text.replace("start: work", "limits: {max_wall_time_seconds: 1}\nstart: work"),
      );
      await drive;
      const state = f.service.coordinator.inspect(runId);
      assert.equal(state.run.status, "paused");
      assert.equal(state.attempts.length, 1);
      assert.equal(state.attempts[0]?.errorCode, "system.timeout");
      assert.equal(state.attempts[0]?.correctionCount, 0);
      assert.equal(state.attention.at(-1)?.category, "limit_max_wall_time");
      const identity = state.attempts[0]?.processIdentity;
      assert.ok(identity);
      assert.equal(observeProcessGroup(identity), "gone");
      if (kind === "agent")
        assert.ok(f.service.coordinator.reportFor(state.attempts[0]?.attemptId ?? ""));
    });
  }

  it("enforces agent idle timeout without requesting report correction", async (t) => {
    const f = fixture(t, [{ mode: "hang" }]);
    const { runId, drive } = f.start(
      AGENT.replace("start: work", "limits: {agent_idle_timeout_seconds: 1}\nstart: work"),
    );
    await drive;
    const state = f.service.coordinator.inspect(runId);
    assert.equal(state.attempts[0]?.errorCode, "system.timeout");
    assert.equal(state.attempts[0]?.correctionCount, 0);
    const settled = state.events.find((e) => e.type === "attempt_settled");
    assert.match(String(settled?.data["detail"]), /idle/);
    const identity = state.attempts[0]?.processIdentity;
    assert.ok(identity);
    assert.equal(observeProcessGroup(identity), "gone");
  });

  it("caps correction by the remaining run budget instead of starting a new wall-clock allowance", async (t) => {
    const seen: { input: AgentInput; at: number }[] = [];
    const scripted = new ScriptedAgentAdapter([{ mode: "silent" }, { mode: "hang" }]);
    const adapter: AgentAdapter = {
      id: "codex",
      capabilities: scripted.capabilities,
      start(input) {
        return scripted.start(input);
      },
      resumeForReportCorrection(input) {
        seen.push({ input, at: Date.now() });
        assert.ok(scripted.resumeForReportCorrection);
        return scripted.resumeForReportCorrection(input);
      },
    };
    const f = fixture(t, [], adapter);
    const { runId, drive } = f.start(
      AGENT.replace("start: work", "limits: {max_wall_time_seconds: 1}\nstart: work"),
    );
    await drive;
    assert.equal(seen.length, 1);
    assert.ok((seen[0]?.input.timeoutMs ?? Infinity) < 1000);
    const state = f.service.coordinator.inspect(runId);
    assert.equal(state.attempts.length, 1);
    assert.equal(state.attempts[0]?.correctionCount, 1);
    assert.equal(state.attempts[0]?.errorCode, "system.report_error");
    assert.equal(state.run.status, "paused");
    assert.equal(state.attention.at(-1)?.category, "limit_max_wall_time");
  });

  it("keeps an idle correction failure as report_error within the same logical attempt", async (t) => {
    const f = fixture(t, [{ mode: "silent" }, { mode: "hang" }]);
    const { runId, drive } = f.start(
      AGENT.replace("start: work", "limits: {agent_idle_timeout_seconds: 1}\nstart: work"),
    );
    await drive;
    const state = f.service.coordinator.inspect(runId);
    assert.equal(state.attempts.length, 1);
    assert.equal(state.attempts[0]?.correctionCount, 1);
    assert.equal(state.attempts[0]?.errorCode, "system.report_error");
    assert.equal(state.run.status, "paused");
    assert.ok(
      state.events.some(
        (e) =>
          e.type === "invocation_settled" &&
          e.data["invocation"] === 1 &&
          e.data["timeoutReason"] === "idle",
      ),
    );
  });
});
