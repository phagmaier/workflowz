/** Offline conformance runs each adapter through the real service, HTTP channel and wf CLI. */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { AgentAdapter, AgentInput } from "../adapters/agent-adapter.js";
import { RunService } from "../runner/run-service.js";
import { WorkflowDatabase } from "../store/database.js";
import type { AgentScript, ScriptedOptions } from "./scripted-agent.js";
import { workflowText } from "./workflows.js";

export type AdapterFactory = (
  plan: readonly AgentScript[],
  options?: ScriptedOptions,
) => AgentAdapter | Promise<AgentAdapter>;
const FLOW = workflowText(`start: build
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
  done:
    kind: end
`);

export async function until(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    assert.ok(Date.now() < deadline, "condition was not reached in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function describeAdapterConformance(
  name: string,
  factory: AdapterFactory,
  harness = "codex",
): void {
  describe(`adapter conformance: ${name}`, () => {
    const fixtures: { root: string; database: WorkflowDatabase }[] = [];
    after(() => {
      for (const { root, database } of fixtures) {
        database.close();
        rmSync(root, { recursive: true, force: true });
      }
    });
    async function fixture(
      plan: readonly AgentScript[],
      options: ScriptedOptions = {},
      text = FLOW,
    ) {
      const root = mkdtempSync(path.join(os.tmpdir(), "wf-conf-"));
      const logFile = path.join(root, "agent.log");
      const database = new WorkflowDatabase(path.join(root, "state.sqlite"));
      fixtures.push({ root, database });
      const adapter = await factory(plan, { ...options, logFile });
      const inputs: AgentInput[] = [];
      const wrapped: AgentAdapter = {
        id: adapter.id,
        start(input) {
          inputs.push(input);
          return adapter.start(input);
        },
        resumeForReportCorrection: adapter.resumeForReportCorrection
          ? (input) => {
              inputs.push(input);
              return adapter.resumeForReportCorrection?.(input) as ReturnType<
                AgentAdapter["start"]
              >;
            }
          : undefined,
      };
      const service = new RunService(database, {
        agents: new Map([[harness, wrapped]]),
        logDir: path.join(root, "logs"),
        correctionTimeoutMs: 1000,
      });
      const runId = service.coordinator.createRun({
        workflowText: text.replace("harness: codex", `harness: ${harness}`),
        workflowDir: root,
      });
      service.coordinator.start(runId);
      const inspect = () => service.coordinator.inspect(runId);
      const corrections = () =>
        inspect().events.filter((e) => e.type === "correction_requested").length;
      const report = () => service.coordinator.reportFor(inspect().attempts[0]?.attemptId ?? "");
      const notes = () => (existsSync(logFile) ? readFileSync(logFile, "utf8") : "");
      return {
        root,
        database,
        adapter,
        service,
        runId,
        inspect,
        corrections,
        report,
        notes,
        inputs,
      };
    }

    it("launches, invokes wf report, receives acknowledgment and persists one declared report", async () => {
      const f = await fixture([{ mode: "report", outcome: "blocked" }]);
      await f.service.drive(f.runId);
      assert.equal(f.report()?.outcome, "blocked");
      assert.match(f.notes(), /ack 0/);
      assert.equal(f.inspect().transitions[0]?.outcome, "blocked");
      assert.equal(f.corrections(), 0);
    });

    it("persists a report while active and routes only after the process settles", async () => {
      const f = await fixture([{ mode: "report-then-delay", extra: "400" }]);
      const driving = f.service.drive(f.runId);
      await until(() => f.report() !== undefined);
      assert.equal(f.inspect().run.cursorStepId, "build");
      assert.equal(f.inspect().transitions.length, 0);
      assert.ok(f.inspect().activeAttempt);
      await driving;
      assert.equal(f.inspect().transitions.length, 1);
      const events = f.inspect().events.map((e) => e.type);
      assert.ok(events.indexOf("report_accepted") < events.indexOf("invocation_settled"));
      assert.ok(events.indexOf("invocation_settled") < events.indexOf("transition_committed"));
    });

    it("rejects undeclared reports synchronously and accepts an in-turn correction", async () => {
      const f = await fixture([{ mode: "invalid-then-valid" }]);
      await f.service.drive(f.runId);
      assert.match(f.notes(), /ack 1\nack 0/);
      assert.equal(f.report()?.outcome, "complete");
      assert.equal(f.corrections(), 0);
      assert.equal(f.inspect().events.filter((e) => e.type === "report_accepted").length, 1);
    });

    it("rejects duplicate submissions while retaining exactly one report", async () => {
      const f = await fixture([{ mode: "duplicate" }]);
      await f.service.drive(f.runId);
      assert.match(f.notes(), /ack 0\nack 1/);
      assert.equal(f.inspect().events.filter((e) => e.type === "report_accepted").length, 1);
      assert.equal(f.inspect().transitions.length, 1);
    });

    it("resumes the persisted session once after clean execution, without overlap", async () => {
      const f = await fixture([{ mode: "silent" }, { mode: "report" }]);
      await f.service.drive(f.runId);
      assert.equal(f.inspect().run.status, "completed");
      assert.equal(f.inspect().attempts.length, 1);
      assert.equal(f.inspect().attempts[0]?.correctionCount, 1);
      assert.equal(f.corrections(), 1);
      const events = f.inspect().events.filter((e) => e.type.startsWith("invocation_"));
      assert.deepEqual(
        events.map((e) => e.type),
        ["invocation_started", "invocation_settled", "invocation_started", "invocation_settled"],
      );
      assert.equal(events[1]?.data["sessionId"], events[2]?.data["sessionId"]);
      assert.notEqual(events[0]?.data["pid"], events[2]?.data["pid"]);
      assert.notEqual(events[0]?.data["logPath"], events[2]?.data["logPath"]);
      assert.match(f.notes(), /start .* silent\nend .*\nstart .* report\ncorrection/);
      assert.equal(f.report()?.outcome, "complete");
    });

    for (const mode of ["silent", "report", "crash", "hang"] as const) {
      it(`pauses after one failed correction (${mode}), with no third invocation`, async () => {
        const f = await fixture([
          { mode: "silent" },
          { mode, outcome: "bogus" },
          { mode: "report" },
        ]);
        await f.service.drive(f.runId);
        assert.equal(f.inspect().run.status, "paused");
        assert.equal(f.inspect().transitions[0]?.outcome, "system.report_error");
        assert.equal(f.corrections(), 1);
        assert.equal(f.inspect().events.filter((e) => e.type === "invocation_started").length, 2);
        assert.equal(f.report(), undefined);
      });
    }

    for (const options of [{ supportsResume: false }, { missingSession: true }]) {
      it(`does not launch fresh correction when resume is unavailable (${JSON.stringify(options)})`, async () => {
        const f = await fixture([{ mode: "silent" }], options);
        await f.service.drive(f.runId);
        const outcome = f.inspect().transitions[0]?.outcome;
        // A missing optional stream identity prevents correction; a missing required API identity
        // is instead a protocol failure. Neither may authorize a fresh fallback.
        assert.ok(
          outcome === "system.report_error" ||
            ("missingSession" in options && outcome === "system.process_error"),
        );
        assert.equal(f.corrections(), 0);
      });
    }

    it("expires the original token before same-session correction accepts a report", async () => {
      const f = await fixture([{ mode: "silent" }, { mode: "report-then-delay", extra: "150" }]);
      const driving = f.service.drive(f.runId);
      await until(() => f.inputs.length === 2);
      const old = f.inputs[0]?.reportAccess;
      const current = f.inputs[1]?.reportAccess;
      assert.ok(old && current);
      assert.notEqual(old.token, current.token);
      const response = await fetch(old.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${old.token}` },
        body: JSON.stringify({ outcome: "complete", summary: "late original" }),
      });
      assert.equal(response.status, 410);
      await driving;
      assert.equal(f.inspect().transitions[0]?.outcome, "complete");
      assert.equal(f.corrections(), 1);
    });

    it("preserves a correction's report for diagnosis if its process fails", async () => {
      const f = await fixture([{ mode: "silent" }, { mode: "report-then-crash" }]);
      await f.service.drive(f.runId);
      assert.equal(f.report()?.outcome, "complete");
      assert.equal(f.inspect().transitions[0]?.outcome, "system.report_error");
      assert.equal(f.corrections(), 1);
    });

    it("routes provider failure without correction even with a clean process status", async () => {
      const f = await fixture([{ mode: "provider-error" }]);
      await f.service.drive(f.runId);
      assert.equal(f.inspect().transitions[0]?.outcome, "system.process_error");
      assert.equal(f.corrections(), 0);
    });

    it("does not create a new session if the persisted session cannot be reopened", async () => {
      const f = await fixture([{ mode: "silent" }], { resumeError: true });
      await f.service.drive(f.runId);
      assert.equal(f.inspect().transitions[0]?.outcome, "system.report_error");
      assert.equal(f.corrections(), 1);
      assert.equal(
        f
          .notes()
          .split("\n")
          .filter((line) => line.startsWith("start")).length,
        1,
      );
    });

    it("scrubs tokens split across output chunks from stdout, stderr, events and disk logs", async () => {
      const f = await fixture([{ mode: "leak-token" }]);
      await f.service.drive(f.runId);
      const token = f.inputs[0]?.reportAccess?.token;
      assert.ok(token);
      const attempt = f.inspect().attempts[0];
      assert.ok(attempt);
      const log = readFileSync(path.join(f.root, "logs", `${attempt.attemptId}.log`), "utf8");
      assert.equal(log.includes(token), false);
      assert.match(log, /\[redacted\]/);
      assert.equal(JSON.stringify(f.inspect()).includes(token), false);
      const row = f.database
        .prepare("SELECT stdout_text FROM attempts WHERE attempt_id = ?")
        .get(attempt.attemptId);
      assert.equal(JSON.stringify(row).includes(token), false);
      assert.equal(f.report()?.outcome, "complete");
    });

    it("honors disabled correction and explicit system.report_error routing", async () => {
      const f = await fixture(
        [{ mode: "silent" }],
        {},
        FLOW.replace(
          "start: build",
          "defaults:\n  report_correction_attempts: 0\nstart: build",
        ).replace(
          "      blocked: { pause: true }",
          "      blocked: { pause: true }\n      system.report_error: { goto: done }",
        ),
      );
      await f.service.drive(f.runId);
      assert.equal(f.inspect().run.status, "completed");
      assert.equal(f.inspect().transitions[0]?.outcome, "system.report_error");
      assert.equal(f.corrections(), 0);
    });

    for (const mode of ["crash", "report-then-crash", "hang", "report-then-hang"] as const) {
      it(`routes ${mode} without correction, preserving any earlier report`, async () => {
        const timeout = mode.includes("hang");
        const f = await fixture(
          [{ mode }],
          {},
          FLOW.replace("    prompt: go", `    prompt: go\n    timeout_seconds: ${timeout ? 1 : 5}`),
        );
        await f.service.drive(f.runId);
        assert.equal(
          f.inspect().transitions[0]?.outcome,
          timeout ? "system.timeout" : "system.process_error",
        );
        assert.equal(f.corrections(), 0);
        assert.equal(f.report() !== undefined, mode.startsWith("report-"));
      });
    }

    it("routes a missing executable as spawn failure without correction", async () => {
      const f = await fixture([{ mode: "report" }], { binary: "/nonexistent/workflowz-harness" });
      await f.service.drive(f.runId);
      assert.equal(f.inspect().transitions[0]?.outcome, "system.spawn_error");
      assert.equal(f.corrections(), 0);
    });

    it("ends the whole owned process tree on stop", async () => {
      const f = await fixture([]);
      const pidFile = path.join(f.root, "child.pid");
      // Replace the initial fixture's adapter before dispatch, retaining the same conformance factory.
      const service = new RunService(f.database, {
        agents: new Map([[harness, await factory([{ mode: "hang-with-child", extra: pidFile }])]]),
        logDir: path.join(f.root, "logs"),
      });
      const driving = service.drive(f.runId);
      await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "");
      const pid = Number(readFileSync(pidFile, "utf8"));
      await service.stop(f.runId);
      await driving;
      assert.throws(
        () => process.kill(pid, 0),
        (error: NodeJS.ErrnoException) => error.code === "ESRCH",
      );
      assert.equal(f.inspect().run.status, "stopped");
      assert.equal(f.inspect().transitions.length, 0);
    });
  });
}
