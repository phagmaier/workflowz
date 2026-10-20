/** Real production owners, owned loopback sockets and command-only execution. No harness probes. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { captureProcessIdentity, observeProcessGroup } from "../adapters/process-identity.js";
import { InstanceLockError, WorkflowDatabase } from "../store/database.js";
import { REPO_ROOT } from "../test-support/paths.js";
import { workflowText } from "../test-support/workflows.js";
import { managementRequest } from "./management-client.js";
import type { BrowserRunStatus } from "./management-service.js";
import { readDaemonAccess } from "./state-directory.js";

async function poll<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, message: string) {
  const deadline = Date.now() + 3000;
  do {
    const value = await read();
    if (accept(value)) return value;
    await delay(15);
  } while (Date.now() < deadline);
  throw new Error(message);
}

async function listenerPresent(port: number) {
  return new Promise<boolean>((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
    socket.setTimeout(1000, () => {
      socket.destroy();
      reject(new Error("listener probe timed out"));
    });
  });
}

async function fixture(t: TestContext, dangling = false) {
  mkdirSync("/tmp/opencode", { recursive: true });
  const root = mkdtempSync("/tmp/opencode/wf-daemon-repair-");
  const directory = path.join(root, "state");
  mkdirSync(directory, { mode: 0o700 });
  const file = path.join(directory, "state.sqlite");
  const target = path.join(directory, "real.sqlite");
  if (dangling) symlinkSync("real.sqlite", file);
  const env = { PATH: process.env["PATH"] ?? "", WF_STATE_DIR: directory };
  const owner = spawn(path.join(REPO_ROOT, "bin/wf"), ["--json", "daemon", "start"], {
    env,
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
  });
  const identity = captureProcessIdentity(owner.pid as number);
  owner.stderr.resume();
  const exited = new Promise<void>((resolve) => owner.once("exit", () => resolve()));
  const request = (input: Parameters<typeof managementRequest>[1]) =>
    managementRequest(directory, input);
  let port: number | undefined;
  let operation: BrowserRunStatus["activeAttempt"];
  const isExited = () => owner.exitCode !== null || owner.signalCode !== null;
  const release = () => writeFileSync(path.join(root, "release"), "settle\n");
  t.after(async () => {
    try {
      release();
      if (!isExited()) owner.kill("SIGTERM");
      await poll(isExited, Boolean, "repair fixture owner failed to exit; preserving evidence");
      await exited;
      assert.equal(owner.exitCode, 0);
      assert.equal(observeProcessGroup(identity), "gone");
      if (operation?.processIdentity)
        assert.equal(observeProcessGroup(operation.processIdentity), "gone");
      if (port !== undefined) assert.equal(await listenerPresent(port), false);
      assert.equal(existsSync(path.join(directory, "daemon.json")), false);
      const next = new WorkflowDatabase(file);
      next.close();
      rmSync(root, { recursive: true });
      assert.equal(existsSync(root), false);
      t.diagnostic(
        `cleanup proven: owner ${owner.pid} and owned group gone; ${operation?.processIdentity ? "command group gone; " : ""}listener refused, discovery removed, lease released, owned root removed`,
      );
    } catch (error) {
      console.error(`Unproven repair cleanup; preserving ${root}`);
      throw error;
    }
  });
  await poll(
    () => existsSync(path.join(directory, "daemon.json")),
    Boolean,
    "owner did not publish",
  );
  const access = readDaemonAccess(directory);
  port = access.port;
  const held = async () => {
    const { runId } = (await request({
      op: "create",
      workflowDir: root,
      workflowText: workflowText(`start: work
steps:
  work:
    kind: command
    timeout_seconds: 20
    argv: ["${process.execPath}", "-e", "const fs=require('node:fs'); const t=setInterval(()=>{if(fs.existsSync('release'))clearInterval(t)},10)"]
    on:
      complete: {goto: next}
      failed: {pause: true}
  next:
    kind: command
    argv: ["${process.execPath}", "-e", "require('node:fs').writeFileSync('unexpected-next', 'x')"]
    on:
      complete: {goto: done}
      failed: {pause: true}
  done: {kind: end}
`),
    })) as { runId: string };
    const status = () => request({ op: "status", runId }) as Promise<BrowserRunStatus>;
    await request({ op: "start", runId, expectedEventId: (await status()).expectedEventId });
    const active = await poll(
      status,
      (s) => s.activeAttempt?.processIdentity != null,
      "command did not launch",
    );
    operation = active.activeAttempt;
    return { runId, status, active };
  };
  const resetShutdown = () =>
    new Promise<void>((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port: access.port });
      socket.once("error", reject);
      socket.once("connect", () => {
        const body = JSON.stringify({ op: "shutdown" });
        socket.write(
          `POST /api/v1 HTTP/1.1\r\nHost: 127.0.0.1:${access.port}\r\nAuthorization: Bearer ${access.token}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
          () => socket.resetAndDestroy(),
        );
      });
      socket.once("close", () => resolve());
    });
  const waitForExit = async () => {
    await poll(isExited, Boolean, "admitted shutdown stranded its owner");
    await exited;
  };
  return {
    root,
    directory,
    file,
    target,
    env,
    owner,
    request,
    held,
    release,
    resetShutdown,
    waitForExit,
  };
}

describe("daemon correctness repairs", { timeout: 15000 }, () => {
  it("refuses same-alias and direct-target contenders before reconciliation or discovery replacement", async (t) => {
    const f = await fixture(t, true);
    const live = await f.held();
    const discovery = readFileSync(path.join(f.directory, "daemon.json"));
    for (const file of [f.file, f.target]) {
      assert.throws(() => {
        const second = new WorkflowDatabase(file);
        second.close();
      }, InstanceLockError);
    }
    const contender = await new Promise<number | string | undefined>((resolve) => {
      execFile(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
        import {startDaemon} from ${JSON.stringify(new URL("./daemon.js", import.meta.url).href)};
        import {InstanceLockError} from ${JSON.stringify(new URL("../store/database.js", import.meta.url).href)};
        try { const owner = await startDaemon(process.env.WF_STATE_DIR); await owner.close(); process.exitCode = 2; }
        catch (error) { if (!(error instanceof InstanceLockError)) throw error; }
      `,
        ],
        { env: f.env, timeout: 3000 },
        (error) => resolve(error?.code ?? 0),
      );
    });
    assert.equal(contender, 0, "a competing production daemon must reject ownership");
    assert.equal(
      readFileSync(path.join(f.directory, "daemon.json")).equals(discovery),
      true,
      "discovery changed",
    );
    const after = await live.status();
    assert.deepEqual(after.run, live.active.run, "live run changed through a contender");
    assert.deepEqual(after.activeAttempt, live.active.activeAttempt);
    assert.equal(after.expectedEventId, live.active.expectedEventId);
  });

  for (const active of [false, true]) {
    it(`finishes admitted reset-client shutdown ${active ? "after draining the current command" : "while idle"}`, async (t) => {
      const f = await fixture(t);
      const live = active ? await f.held() : undefined;
      await f.resetShutdown();
      if (live) {
        await poll(
          () => f.request({ op: "ping" }) as Promise<{ closing: boolean }>,
          (s) => s.closing,
          "shutdown was not admitted",
        );
        assert.equal((await live.status()).run.status, "pausing");
        assert.equal(f.owner.exitCode, null, "shutdown must drain, not stop-now");
        assert.equal(
          observeProcessGroup(live.active.activeAttempt?.processIdentity ?? null),
          "alive",
        );
        f.release();
      }
      await f.waitForExit();
      assert.equal(f.owner.exitCode, 0);
      assert.equal(existsSync(path.join(f.root, "unexpected-next")), false);
    });
  }
});
