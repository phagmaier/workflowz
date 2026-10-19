import assert from "node:assert/strict";
import os from "node:os";
import { describe, it } from "node:test";
import { childEnvironment } from "./environment.js";
import { startProcess } from "./process.js";
import {
  captureProcessIdentity,
  observeProcessGroup,
  parseProcessStat,
  signalOwnedGroup,
} from "./process-identity.js";

const sleeper = () =>
  startProcess({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    cwd: os.tmpdir(),
    env: childEnvironment(),
    graceMs: 100,
  });

describe("Linux process identity", () => {
  it("parses start ticks without confusing spaces, parentheses or newlines in comm for fields", () => {
    const fields = Array(20).fill("0");
    fields[0] = "S";
    fields[2] = "41";
    fields[3] = "41";
    fields[19] = "90071992547409930";
    assert.deepEqual(parseProcessStat(`41 (a ) tricky\nname) ${fields.join(" ")}\n`), {
      pid: 41,
      pgid: 41,
      sid: 41,
      startTicks: "90071992547409930",
    });
    fields[2] = "0";
    fields[3] = "0";
    assert.deepEqual(parseProcessStat(`2 (kthreadd) ${fields.join(" ")}`), {
      pid: 2,
      pgid: 0,
      sid: 0,
      startTicks: "90071992547409930",
    });
    fields[19] = "bad";
    assert.throws(() => parseProcessStat(`41 (name) ${fields.join(" ")}`));
    assert.throws(() => parseProcessStat("41 missing fields"));
  });

  it("refuses a reused PID identity and leaves the unrelated live process untouched", async () => {
    const child = sleeper();
    try {
      const identity = child.processIdentity;
      assert.ok(identity);
      assert.deepEqual(captureProcessIdentity(child.pid), identity);
      assert.equal(observeProcessGroup(identity), "alive");
      const stale = { ...identity, startTicks: String(BigInt(identity.startTicks) + 1n) };
      assert.equal(observeProcessGroup(stale), "mismatch");
      assert.throws(() => signalOwnedGroup(identity.pid, stale, "SIGKILL"));
      assert.equal(observeProcessGroup(identity), "alive");
    } finally {
      await child.terminate();
    }
    assert.equal(observeProcessGroup(child.processIdentity), "gone");
  });

  it("does not signal a live numeric group without ownership evidence or from an earlier boot", async () => {
    const child = sleeper();
    try {
      const identity = child.processIdentity;
      assert.ok(identity);
      assert.throws(() => signalOwnedGroup(identity.pid, null, "SIGTERM"));
      const oldBoot = { ...identity, bootId: "00000000-0000-4000-8000-000000000000" };
      assert.equal(observeProcessGroup(oldBoot), "gone");
      signalOwnedGroup(identity.pid, oldBoot, "SIGKILL");
      assert.equal(observeProcessGroup(identity), "alive");
      assert.equal(observeProcessGroup(null), "unknown");
    } finally {
      await child.terminate();
    }
  });
});
