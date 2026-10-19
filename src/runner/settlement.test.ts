import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRunResult } from "../adapters/agent-adapter.js";
import { settlementForAgent, settlementForCommand } from "./settlement.js";

const clean: AgentRunResult = {
  exitCode: 0,
  signal: null,
  timedOut: false,
  terminated: false,
  spawnError: null,
  stdout: "",
};
const ALLOWED = ["complete", "blocked"];

describe("settlementForAgent (spec §4.4 precedence)", () => {
  it("accepts a declared outcome from a cleanly exited agent", () => {
    assert.deepEqual(settlementForAgent(clean, ALLOWED, "complete"), {
      kind: "outcome",
      outcome: "complete",
    });
  });

  it("treats an undeclared outcome as a report error", () => {
    const result = settlementForAgent(clean, ALLOWED, "bogus");
    assert.deepEqual(
      [result.kind, result.kind === "system" ? result.code : ""],
      ["system", "system.report_error"],
    );
  });

  it("treats a clean exit without a report as a report error", () => {
    const result = settlementForAgent(clean, ALLOWED);
    assert.equal(result.kind === "system" && result.code, "system.report_error");
  });

  it("treats a crash as a process error even when an outcome was printed first", () => {
    const result = settlementForAgent({ ...clean, exitCode: 3 }, ALLOWED, "complete");
    assert.equal(result.kind === "system" && result.code, "system.process_error");
  });

  it("does not accept a report when a terminated agent exits cleanly", () => {
    const result = settlementForAgent({ ...clean, terminated: true }, ALLOWED);
    assert.equal(result.kind === "system" && result.code, "system.process_error");
  });

  it("gives spawn failures and timeouts their own codes, ahead of any report", () => {
    const spawn = settlementForAgent({ ...clean, spawnError: "ENOENT", exitCode: null }, ALLOWED);
    assert.equal(spawn.kind === "system" ? spawn.code : "", "system.spawn_error");
    const timeout = settlementForAgent({ ...clean, timedOut: true, exitCode: null }, ALLOWED);
    assert.equal(timeout.kind === "system" ? timeout.code : "", "system.timeout");
  });
});

describe("settlementForCommand", () => {
  it("passes complete and failed through as normal outcomes", () => {
    assert.deepEqual(
      settlementForCommand({ kind: "outcome", outcome: "failed", exitCode: 1, stdout: "" }),
      {
        kind: "outcome",
        outcome: "failed",
      },
    );
  });
});
