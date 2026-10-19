/**
 * The offline conformance suite every agent adapter must pass before it is registered as supported
 * (todo 3.7, spec §9). It asserts behavior, not wiring: a launch, a declared report, an undeclared
 * report, a crash, a timeout, a missing binary, and a stop that reaps the whole tree. Each adapter
 * runs against the same fake harness fixture, so passing means the same thing for every harness.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { AgentAdapter, AgentRunResult } from "../adapters/agent-adapter.js";
import { settlementForAgent } from "../runner/settlement.js";
import type { AgentScript, ScriptedOptions } from "./scripted-agent.js";

/** The system code of a settlement, or "outcome" when it routed a normal outcome. */
function systemCode(settlement: { kind: string; code?: string }): string {
  return settlement.kind === "system" ? (settlement.code ?? "") : "outcome";
}

export type AdapterFactory = (
  plan: readonly AgentScript[],
  options?: ScriptedOptions,
) => AgentAdapter;

const ALLOWED = ["complete", "blocked"];

export function describeAdapterConformance(name: string, factory: AdapterFactory): void {
  describe(`adapter conformance: ${name}`, () => {
    const directories: string[] = [];
    after(() => {
      for (const directory of directories) {
        rmSync(directory, { recursive: true, force: true });
      }
    });
    const scratch = (): string => {
      const directory = mkdtempSync(path.join(os.tmpdir(), "wf-conf-"));
      directories.push(directory);
      return directory;
    };

    async function runOnce(
      plan: readonly AgentScript[],
      options: { timeoutMs?: number; binary?: string } = {},
    ): Promise<AgentRunResult> {
      const adapter = factory(plan, options.binary === undefined ? {} : { binary: options.binary });
      const handle = adapter.start({
        attemptId: "conformance",
        cwd: os.tmpdir(),
        prompt: "conformance prompt",
        instructionFiles: [],
        allowedOutcomes: ALLOWED,
        timeoutMs: options.timeoutMs,
      });
      return handle.completed;
    }

    it("launches the harness and settles a declared outcome", async () => {
      const result = await runOnce([{ mode: "report", outcome: "blocked" }]);
      assert.deepEqual(settlementForAgent(result, ALLOWED), {
        kind: "outcome",
        outcome: "blocked",
      });
    });

    it("rejects an undeclared reported outcome as a report error", async () => {
      const result = await runOnce([{ mode: "report", outcome: "bogus" }]);
      assert.equal(systemCode(settlementForAgent(result, ALLOWED)), "system.report_error");
    });

    it("treats a clean exit without any report as a report error", async () => {
      const settled = settlementForAgent(await runOnce([{ mode: "silent" }]), ALLOWED);
      assert.equal(systemCode(settled), "system.report_error");
    });

    it("treats a crash as a process error, even after an outcome was printed", async () => {
      const crash = settlementForAgent(await runOnce([{ mode: "crash" }]), ALLOWED);
      assert.equal(systemCode(crash), "system.process_error");
      const after = settlementForAgent(
        await runOnce([{ mode: "report-then-crash", outcome: "complete" }]),
        ALLOWED,
      );
      assert.equal(systemCode(after), "system.process_error");
    });

    it("ends an attempt that outlives its timeout as a timeout", async () => {
      const result = await runOnce([{ mode: "hang" }], { timeoutMs: 300 });
      assert.equal(result.timedOut, true);
      assert.equal(systemCode(settlementForAgent(result, ALLOWED)), "system.timeout");
    });

    it("reports a harness that cannot be launched as a spawn error", async () => {
      const result = await runOnce([{ mode: "report" }], {
        binary: "/nonexistent/workflowz-harness",
      });
      const settled = settlementForAgent(result, ALLOWED);
      assert.equal(systemCode(settled), "system.spawn_error");
    });

    it("ends the whole process tree on terminate, including children the harness started", async () => {
      const pidFile = path.join(scratch(), "child.pid");
      const adapter = factory([{ mode: "hang-with-child", extra: pidFile }]);
      const handle = adapter.start({
        attemptId: "conformance-tree",
        cwd: os.tmpdir(),
        prompt: "p",
        instructionFiles: [],
        allowedOutcomes: ALLOWED,
      });
      const deadline = Date.now() + 3000;
      while (!existsSync(pidFile) || readFileSync(pidFile, "utf8").trim() === "") {
        assert.ok(Date.now() < deadline, "the harness never started its child");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const childPid = Number(readFileSync(pidFile, "utf8"));
      await handle.terminate();
      await handle.completed;
      assert.throws(
        () => process.kill(childPid, 0),
        (error: NodeJS.ErrnoException) => error.code === "ESRCH",
      );
    });
  });
}
