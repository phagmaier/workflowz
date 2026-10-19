import assert from "node:assert/strict";
import os from "node:os";
import { describe, it } from "node:test";
import { commandOutcome, startCommand } from "./command-executor.js";
import type { ProcessResult } from "./process.js";

const base: ProcessResult = {
  exitCode: 0,
  signal: null,
  timedOut: false,
  terminated: false,
  spawnError: null,
  pid: 1,
  stdout: "",
  stdoutTruncated: false,
  stderr: "",
  stderrTruncated: false,
};

describe("commandOutcome (exit-code normalization)", () => {
  it("maps exit 0 to complete and any other status to failed", () => {
    assert.deepEqual(commandOutcome({ ...base, exitCode: 0 }), {
      kind: "outcome",
      outcome: "complete",
      exitCode: 0,
      stdout: "",
    });
    assert.deepEqual(commandOutcome({ ...base, exitCode: 2 }), {
      kind: "outcome",
      outcome: "failed",
      exitCode: 2,
      stdout: "",
    });
  });

  it("maps spawn errors, timeouts, and signal deaths to system outcomes", () => {
    const spawn = commandOutcome({ ...base, spawnError: "ENOENT", exitCode: null });
    assert.deepEqual(
      [spawn.kind, spawn.kind === "system" ? spawn.code : ""],
      ["system", "system.spawn_error"],
    );
    const timeout = commandOutcome({ ...base, exitCode: null, timedOut: true, terminated: true });
    assert.deepEqual(
      [timeout.kind, timeout.kind === "system" ? timeout.code : ""],
      ["system", "system.timeout"],
    );
    const killed = commandOutcome({ ...base, exitCode: null, signal: "SIGSEGV" });
    assert.deepEqual(
      [killed.kind, killed.kind === "system" ? killed.code : ""],
      ["system", "system.process_error"],
    );
  });

  it("reports a stop as terminated, not as a failure", () => {
    assert.equal(
      commandOutcome({ ...base, exitCode: null, signal: "SIGTERM", terminated: true }).kind,
      "terminated",
    );
  });
});

describe("startCommand", () => {
  it("reports empty argv and invalid spawn arguments as spawn errors without throwing", async () => {
    for (const argv of [[], [""], ["node", "bad\0argument"]]) {
      const outcome = await startCommand({ argv, cwd: os.tmpdir(), env: {} }).completed;
      assert.equal(outcome.kind, "system");
      assert.equal(outcome.kind === "system" && outcome.code, "system.spawn_error");
    }
  });

  it("runs argv directly, so shell syntax in an argument is just text", async () => {
    const outcome = await startCommand({ argv: ["echo", "$HOME;", "x"], cwd: os.tmpdir(), env: {} })
      .completed;
    assert.deepEqual(outcome, {
      kind: "outcome",
      outcome: "complete",
      exitCode: 0,
      stdout: "$HOME; x\n",
    });
  });

  it("applies workflow env entries on top of the base allowlist", async () => {
    const outcome = await startCommand({
      argv: ["sh", "-c", 'printf %s "$WF_GREETING"'],
      cwd: os.tmpdir(),
      env: { WF_GREETING: "hi" },
    }).completed;
    assert.equal(outcome.kind === "outcome" && outcome.stdout, "hi");
  });

  it("reports a missing working directory as a spawn error", async () => {
    const outcome = await startCommand({ argv: ["echo"], cwd: "/definitely/not/here", env: {} })
      .completed;
    assert.deepEqual(
      [outcome.kind, outcome.kind === "system" ? outcome.code : ""],
      ["system", "system.spawn_error"],
    );
  });
});
