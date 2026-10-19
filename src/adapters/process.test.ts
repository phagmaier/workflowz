import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { childEnvironment } from "./environment.js";
import { OutputCapture } from "./output.js";
import { startProcess } from "./process.js";

const temporaryDirectories: string[] = [];
after(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function scratch(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "wf-proc-"));
  temporaryDirectories.push(directory);
  return directory;
}

/** True when a pid still names a live process. ESRCH means it is gone; EPERM means it exists. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function eventually(check: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("condition not reached in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const sh = (script: string, options: { timeoutMs?: number; cwd?: string; logPath?: string } = {}) =>
  startProcess({
    command: "sh",
    args: ["-c", script],
    cwd: options.cwd ?? os.tmpdir(),
    env: childEnvironment(),
    timeoutMs: options.timeoutMs,
    logPath: options.logPath,
    graceMs: 200,
  });

describe("startProcess", () => {
  it("captures stdout and reports a clean exit", async () => {
    const result = await sh("echo hello").completed;
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "hello\n");
    assert.equal(result.timedOut, false);
    assert.equal(result.spawnError, null);
  });

  it("reports a nonzero exit status without treating it as a spawn failure", async () => {
    const result = await sh("exit 7").completed;
    assert.equal(result.exitCode, 7);
    assert.equal(result.spawnError, null);
  });

  it("reports a missing executable as a spawn error", async () => {
    const result = await startProcess({
      command: "workflowz-no-such-binary",
      args: [],
      cwd: os.tmpdir(),
      env: childEnvironment(),
    }).completed;
    assert.equal(result.spawnError, "ENOENT");
    assert.equal(result.pid, null);
  });

  it("refuses to start in a working directory that does not exist", async () => {
    const result = await sh("echo never", { cwd: path.join(os.tmpdir(), "wf-missing-dir-xyz") })
      .completed;
    assert.equal(result.spawnError, "cwd_not_found");
    assert.equal(result.pid, null);
  });

  it("ends a process that outlives its timeout and marks it timed out", async () => {
    const started = Date.now();
    const result = await sh("sleep 30", { timeoutMs: 200 }).completed;
    assert.equal(result.timedOut, true);
    assert.equal(result.terminated, true);
    assert.ok(Date.now() - started < 5000, "the timeout must not wait for the sleep to finish");
  });

  it("ends the whole process group on timeout, including children that were started in the background", async () => {
    const pidFile = path.join(scratch(), "child.pid");
    const result = await sh(`sleep 30 & echo $! > ${pidFile}; wait`, { timeoutMs: 300 }).completed;
    assert.equal(result.timedOut, true);
    const childPid = Number(readFileSync(pidFile, "utf8"));
    assert.equal(alive(childPid), false, "the background child must not survive the attempt");
  });

  it("terminate() ends the tree and resolves only after the process is reaped", async () => {
    const pidFile = path.join(scratch(), "grandchild.pid");
    const running = sh(`sleep 30 & echo $! > ${pidFile}; sleep 30`);
    await eventually(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "");
    const childPid = Number(readFileSync(pidFile, "utf8"));

    await running.terminate();
    const result = await running.completed;
    assert.equal(result.terminated, true);
    assert.equal(alive(childPid), false);
  });

  it("does not signal an old process group when terminate is called after completion", async (t) => {
    const running = sh("exit 0");
    await running.completed;
    const calls: unknown[][] = [];
    const originalKill = process.kill.bind(process);
    const mock = t.mock.method(process, "kill", (pid: number, signal?: string | number) => {
      calls.push([pid, signal]);
      return originalKill(pid, signal);
    });
    try {
      await running.terminate();
      await running.terminate();
      assert.deepEqual(calls, []);
    } finally {
      mock.mock.restore();
    }
  });

  it("rejects settlement when the process group is still present after SIGKILL", async (t) => {
    const running = sh("exit 0");
    const originalKill = process.kill.bind(process);
    const mock = t.mock.method(process, "kill", (pid: number, signal?: string | number) =>
      pid === -(running.pid as number) ? true : originalKill(pid, signal),
    );
    try {
      await assert.rejects(
        running.completed,
        /still exists after SIGKILL; settlement is uncertain/,
      );
      await assert.rejects(running.terminate(), /settlement is uncertain/);
    } finally {
      mock.mock.restore();
    }
  });

  it("rejects settlement if an escaped descendant keeps the streams open after a long execution", async () => {
    // A real child and clock reproduce the old launch-relative drain deadline; fake timers cannot.
    const pidFile = path.join(scratch(), "escaped.pid");
    const running = startProcess({
      command: process.execPath,
      args: [
        "-e",
        `const { spawn } = require('node:child_process');
         const { writeFileSync } = require('node:fs');
         const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'],
           { detached: true, stdio: ['ignore', 1, 2] });
         writeFileSync(process.argv[1], String(child.pid));
         child.unref();
         setTimeout(() => process.exit(0), 1200);`,
        pidFile,
      ],
      cwd: os.tmpdir(),
      env: childEnvironment(),
    });
    try {
      await assert.rejects(running.completed, /streams remain open.*settlement is uncertain/);
    } finally {
      if (existsSync(pidFile)) {
        const pid = Number(readFileSync(pidFile, "utf8"));
        if (alive(pid)) {
          process.kill(-pid, "SIGKILL");
          await eventually(() => !alive(pid));
        }
      }
    }
  });

  it("escalates to SIGKILL when a process ignores SIGTERM", async () => {
    const running = sh("trap '' TERM; while true; do sleep 0.05; done");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const started = Date.now();
    await running.terminate();
    const result = await running.completed;
    assert.equal(result.signal, "SIGKILL");
    assert.ok(Date.now() - started < 3000);
  });

  it("writes full output to the log file and caps stdout in memory", async () => {
    const logPath = path.join(scratch(), "attempt.log");
    const result = await startProcess({
      command: "sh",
      args: ["-c", "head -c 200000 /dev/zero | tr '\\0' 'x'"],
      cwd: os.tmpdir(),
      env: childEnvironment(),
      logPath,
      stdoutLimit: 1024,
    }).completed;
    assert.equal(result.stdout.length, 1024);
    assert.equal(result.stdoutTruncated, true);
    assert.equal(readFileSync(logPath, "utf8").length, 200_000);
  });

  it("keeps the log head up to its byte limit even when the first chunk exceeds it", async () => {
    const logPath = path.join(scratch(), "capped.log");
    await startProcess({
      command: process.execPath,
      args: ["-e", 'process.stdout.write("x".repeat(200))'],
      cwd: os.tmpdir(),
      env: childEnvironment(),
      logPath,
      logLimit: 100,
    }).completed;
    assert.equal(readFileSync(logPath, "utf8"), `${"x".repeat(100)}\n[log capped at 100 bytes]\n`);
  });

  it("captures stderr separately with its own byte bound", async () => {
    const result = await startProcess({
      command: process.execPath,
      args: ["-e", 'process.stdout.write("out"); process.stderr.write("error")'],
      cwd: os.tmpdir(),
      env: childEnvironment(),
      stderrLimit: 3,
    }).completed;
    assert.equal(result.stdout, "out");
    assert.equal(result.stderr, "err");
    assert.equal(result.stderrTruncated, true);
  });

  it("passes only the allowlisted environment to the child", async () => {
    const source = {
      PATH: "/usr/bin:/bin",
      HOME: "/home/u",
      ANTHROPIC_API_KEY: "secret",
      FOO: "bar",
    };
    const env = childEnvironment({ WF_EXTRA: "1" }, source);
    assert.deepEqual(Object.keys(env).sort(), ["HOME", "PATH", "WF_EXTRA"]);
  });
});

describe("OutputCapture", () => {
  it("keeps the head, drops the rest, and says so", () => {
    const capture = new OutputCapture(5);
    capture.push(Buffer.from("abc"));
    capture.push(Buffer.from("defgh"));
    capture.push(Buffer.from("ij"));
    assert.equal(capture.text(), "abcde");
    assert.equal(capture.truncated(), true);
  });
});
