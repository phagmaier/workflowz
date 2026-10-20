import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";
import {
  captureProcessIdentity,
  processGroupState,
  signalOwnedGroup,
} from "../../dist/adapters/process-identity.js";
import { managementRequest } from "../../dist/app/management-client.js";
import { WorkflowDatabase } from "../../dist/store/database.js";
import { RunStore } from "../../dist/store/run-store.js";

export { expect };

const daemonFile = fileURLToPath(new URL("./daemon.mjs", import.meta.url));
const limit = 10_000;
async function bounded(promise, message, timeout = limit) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function poll(check, message) {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(25);
  }
  throw new Error(message);
}
function listenerPresent(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", (error) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
    socket.setTimeout(1000, () => {
      socket.destroy();
      reject(new Error("listener absence probe timed out"));
    });
  });
}
function loopback(url) {
  const parsed = new URL(url);
  return (
    ["http:", "https:", "ws:", "wss:"].includes(parsed.protocol) &&
    ["127.0.0.1", "[::1]", "localhost"].includes(parsed.hostname)
  );
}

export const test = base.extend({
  scenario: ["gate", { option: true }],
  serviceWorkers: ["block", { option: true }],
  app: async ({ context, scenario }, use, testInfo) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "workflowz-chromium-"));
    const directory = path.join(root, "state");
    const gate = path.join(root, "release-agent");
    const children = [];
    const errors = [];
    const failures = [];
    const audits = [];
    const messages = [];
    const sanitize = (value) =>
      String(value)
        .replaceAll(root, "<fixture>")
        .replace(/[a-f0-9]{64}/gi, "[secret]");
    let owner;
    let ownerIdentity;
    let exited;
    let port;
    let closing;
    let output = "";
    let snapshots = [];
    let cleanupProven = false;
    const recordPage = (page) => {
      page.on("pageerror", (error) => errors.push(sanitize(error.message)));
    };
    context.on("page", recordPage);
    for (const page of context.pages()) recordPage(page);
    const network = async (route) => {
      const url = route.request().url();
      if (loopback(url)) await route.continue();
      else {
        errors.push(`blocked non-loopback request: ${sanitize(new URL(url).origin)}`);
        await route.abort("blockedbyclient");
      }
    };
    const sockets = (route) => {
      if (loopback(route.url())) route.connectToServer();
      else {
        errors.push(`blocked non-loopback websocket: ${sanitize(new URL(route.url()).origin)}`);
        route.close();
      }
    };
    const request = (input) =>
      bounded(managementRequest(directory, input), `management ${input.op} timed out`);
    const status = (runId) => request({ op: "status", runId });
    const until = (runId, predicate) =>
      poll(async () => {
        const state = await status(runId);
        return predicate(state) ? state : false;
      }, `run ${runId} did not reach the expected boundary`);
    const events = async (runId) => {
      const found = [];
      let after = 0;
      for (;;) {
        const page = await request({ op: "events", runId, after, limit: 1000 });
        found.push(...page.events);
        if (!page.hasMore) return found;
        after = page.nextAfter;
      }
    };
    const stopAndClose = () => {
      closing ??= (async () => {
        if (!owner) {
          cleanupProven = true;
          return;
        }
        if (owner.exitCode === null && owner.signalCode === null && port) {
          // Shutdown pauses at a boundary, so first use the real stop control to reap live work.
          try {
            for (const run of await request({ op: "runs" })) {
              const state = await status(run.runId);
              if (state.activeAttempt || ["running", "pausing"].includes(state.run.status)) {
                await request({
                  op: "stop",
                  runId: run.runId,
                  expectedEventId: state.expectedEventId,
                  reason: "Offline Chromium fixture cleanup",
                });
                await until(run.runId, (current) => current.activeAttempt === null);
              }
            }
            snapshots = await Promise.all(
              (await request({ op: "runs" })).map(async (run) => ({
                state: await status(run.runId),
                events: await events(run.runId),
                reports: await request({ op: "reports", runId: run.runId }),
              })),
            );
          } catch (error) {
            failures.push(error);
            // Release is only an emergency cleanup fallback, never a test synchronization timer.
            writeFileSync(gate, "release\n");
          }
        }
        if (owner.connected) {
          try {
            owner.send({ type: "close" });
          } catch (error) {
            failures.push(error);
          }
        }
        try {
          const result = await bounded(exited, "foreground owner did not exit after close");
          assert.deepEqual(result, { code: 0, signal: null }, "foreground owner exited uncleanly");
        } catch (error) {
          failures.push(error);
          if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL");
          await bounded(exited, "foreground owner could not be reaped").catch((error) =>
            failures.push(error),
          );
        }
        for (const child of children) {
          try {
            await poll(
              () => processGroupState(child.pid, child.processIdentity) === "gone",
              `supervised process group ${child.pid} survived owner close`,
            );
          } catch (error) {
            failures.push(error);
            try {
              signalOwnedGroup(child.pid, child.processIdentity, "SIGKILL");
              await poll(
                () => processGroupState(child.pid, child.processIdentity) === "gone",
                `supervised process group ${child.pid} survived forced cleanup`,
              );
            } catch (error) {
              failures.push(error);
            }
          }
        }
        for (const child of children)
          assert.equal(
            processGroupState(child.pid, child.processIdentity),
            "gone",
            `child ${child.pid} remains`,
          );
        assert.equal(processGroupState(owner.pid, ownerIdentity), "gone", "owner group remains");
        assert.equal(existsSync(path.join(directory, "daemon.json")), false, "discovery remains");
        if (port) assert.equal(await listenerPresent(port), false, "loopback listener remains");
        if (existsSync(path.join(directory, "state.sqlite"))) {
          // Independent read-only reopen only after the foreground owner is reaped.
          const database = new WorkflowDatabase(path.join(directory, "state.sqlite"), {
            readOnly: true,
          });
          try {
            const store = new RunStore(database, () => new Date().toISOString());
            for (const snapshot of snapshots) {
              const runId = snapshot.state.run.runId;
              assert.deepEqual(store.getRun(runId), snapshot.state.run);
              assert.deepEqual(store.listTasks(runId), snapshot.state.tasks);
              assert.deepEqual(store.listEvents(runId), snapshot.events);
              const reports = store.listAttempts(runId).flatMap((attempt) => {
                const report = store.getReport(attempt.attemptId);
                return report ? [report] : [];
              });
              assert.deepEqual(reports, snapshot.reports);
              assert.equal(
                store
                  .listAttempts(runId)
                  .some((attempt) =>
                    ["created", "starting", "running", "settling"].includes(attempt.status),
                  ),
                false,
              );
            }
            for (const audit of audits) await audit(store);
          } finally {
            database.close();
          }
        }
        cleanupProven = true;
      })();
      return closing;
    };
    try {
      writeFileSync(
        path.join(root, "instructions.md"),
        "Offline synthetic browser instructions.\n",
      );
      writeFileSync(
        path.join(root, "tasks.md"),
        "# Offline tasks\n- [ ] browser <img src=x onerror=alert(1)> task\n- [ ] second browser task\n",
      );
      await context.route("**/*", network);
      await context.routeWebSocket("**/*", sockets);
      owner = fork(daemonFile, [directory, scenario, gate], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        execArgv: [],
        env: {
          PATH: process.env.PATH ?? "",
          HOME: root,
          TMPDIR: root,
          WF_STATE_DIR: directory,
          NODE_NO_WARNINGS: "1",
        },
      });
      ownerIdentity = captureProcessIdentity(owner.pid);
      exited = new Promise((resolve, reject) => {
        owner.once("error", reject);
        owner.once("exit", (code, signal) => resolve({ code, signal }));
      });
      const ready = new Promise((resolve, reject) => {
        owner.on("message", (message) => {
          if (message.type === "ready") resolve(message.port);
          else if (message.type === "child") children.push(message);
          else if (message.type === "failure") {
            messages.push(sanitize(message.message));
            reject(new Error(sanitize(message.message)));
          }
        });
        exited.then(
          (result) =>
            reject(new Error(`foreground owner exited before ready: ${JSON.stringify(result)}`)),
          reject,
        );
      });
      const log = (chunk) => {
        output = (output + sanitize(chunk)).slice(-32_768);
      };
      owner.stdout.on("data", log);
      owner.stderr.on("data", log);
      port = await bounded(ready, "foreground owner did not report ready");
      const url = `http://127.0.0.1:${port}`;
      await use({
        root,
        directory,
        url,
        children,
        request,
        status,
        until,
        release: async () => {
          writeFileSync(gate, "release\n");
        },
        close: stopAndClose,
        pair: async (page) => {
          const issued = await request({ op: "browser-access" });
          await page.goto(`${url}/ui/`);
          await page.getByLabel("Pairing code").fill(issued.code);
          await page.getByRole("button", { name: "Connect", exact: true }).click();
          await expect(page.locator("#connection")).toHaveText("Connected / localhost");
          await expect(page.locator("#workspace")).toBeVisible();
        },
        seed: async ({ workflowText }) => {
          const created = await request({ op: "create", workflowText, workflowDir: root });
          const state = await status(created.runId);
          assert.equal(state.run.status, "ready");
          assert.equal(state.activeAttempt, null);
          return { ...created, revisionId: state.run.revisionId };
        },
        audit: (callback) => {
          audits.push(callback);
        },
        durableEvents: (runId, eventIds) => {
          audits.push((store) => {
            const durable = new Set(store.listEvents(runId).map((event) => event.eventId));
            for (const id of eventIds)
              assert.ok(durable.has(id), `event ${id} missing after owner exit`);
          });
        },
      });
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        await stopAndClose();
      } catch (error) {
        failures.push(error);
      } finally {
        try {
          context.off("page", recordPage);
          await context.unroute("**/*", network).catch((error) => failures.push(error));
          if (errors.length) failures.push(new Error(errors.join("\n")));
          if (testInfo.status !== testInfo.expectedStatus || failures.length || messages.length) {
            let agentLog = "";
            const logFile = path.join(directory, "fake-agent.log");
            if (existsSync(logFile)) agentLog = sanitize(readFileSync(logFile, "utf8"));
            await testInfo.attach("offline-fixture-diagnostics", {
              contentType: "application/json",
              body: Buffer.from(
                JSON.stringify(
                  {
                    scenario,
                    ownerPid: owner?.pid,
                    children,
                    retainedRoot: cleanupProven ? undefined : root,
                    errors,
                    failures: failures.map((error) => sanitize(error.message)),
                    messages,
                    output,
                    agentLog,
                  },
                  null,
                  2,
                ),
              ),
            });
          }
        } catch (error) {
          failures.push(error);
        } finally {
          if (cleanupProven) {
            rmSync(root, { recursive: true, force: true });
            assert.equal(existsSync(root), false, "owned fixture state remains");
            if (!failures.length && !messages.length)
              console.log(
                `${scenario}: durable reopen, ${children.length} owned children gone, owner exit 0, listener/discovery gone, temp root removed`,
              );
          } else {
            console.error(`${scenario}: cleanup proof failed; preserving owned fixture ${root}`);
          }
        }
      }
    }
    if (messages.length) failures.push(new Error(messages.join("\n")));
    if (failures.length)
      throw new AggregateError(failures, "offline browser fixture cleanup failed");
  },
});
