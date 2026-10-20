import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { startProcess } from "../adapters/process.js";
import { RunCoordinator } from "../engine/run-coordinator.js";
import { WorkflowDatabase } from "../store/database.js";
import { REPO_ROOT } from "../test-support/paths.js";
import { workflowText } from "../test-support/workflows.js";
import { type ReportAccess, ReportServer } from "./report-server.js";

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
const BODY = { outcome: "complete", summary: "done" };
async function fixture(
  work: (f: {
    root: string;
    database: WorkflowDatabase;
    coordinator: RunCoordinator;
    server: ReportServer;
    access: ReportAccess;
    attemptId: string;
    runId: string;
  }) => Promise<void>,
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-reports-"));
  const database = new WorkflowDatabase(path.join(root, "state.sqlite"));
  const coordinator = new RunCoordinator(database);
  const server = new ReportServer(coordinator);
  try {
    const runId = coordinator.createRun({ workflowText: FLOW, workflowDir: root });
    coordinator.start(runId);
    const next = coordinator.advance(runId);
    assert.equal(next.kind, "attempt");
    if (next.kind !== "attempt") throw new Error("not dispatched");
    await server.listen();
    await work({
      root,
      database,
      coordinator,
      server,
      runId,
      attemptId: next.attemptId,
      access: server.issue(next.attemptId),
    });
  } finally {
    await server.close();
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
}
function send(access: { endpoint: string; token: string }, body: unknown = BODY) {
  return fetch(access.endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${access.token}`, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("private reporting endpoint and CLI", () => {
  it("rejects registered injected credentials and discards that knowledge when the channel closes", async () =>
    fixture(async (f) => {
      const credential = "synthetic-injected-authorization";
      f.server.protect(f.access, [credential]);
      const before = f.coordinator.inspect(f.runId);
      assert.equal(
        (await send(f.access, { ...BODY, summary: Buffer.from(credential).toString("base64") }))
          .status,
        422,
      );
      assert.deepEqual(f.coordinator.inspect(f.runId), before);
      f.server.revoke(f.access);
      const current = f.server.issue(f.attemptId);
      assert.ok(current.secrets.includes(credential));
      f.server.protect(f.access, ["late-registration"]);
      assert.ok(!current.secrets.includes("late-registration"));
      await f.server.close();
      await f.server.listen();
      const reopened = f.server.issue(f.attemptId);
      assert.ok(!reopened.secrets.includes(credential));
      assert.equal((await send(reopened)).status, 201);
    }));
  it("rejects malformed/invalid bodies, authority fields, origins and tokens without any mutation", async () =>
    fixture(async (f) => {
      const before = f.coordinator.inspect(f.runId);
      for (const body of [
        "{",
        {},
        { ...BODY, outcome: "unknown" },
        { ...BODY, run_id: "other" },
        { ...BODY, summary: f.access.token },
        { ...BODY, data: { authorization: Buffer.from(f.access.token).toString("base64") } },
        { ...BODY, handoff: Buffer.from(f.access.token).toString("base64url") },
      ]) {
        const response = await send(f.access, body);
        assert.equal(response.status, 422);
        assert.equal((await response.text()).includes(f.access.token), false);
        assert.deepEqual(f.coordinator.inspect(f.runId), before);
        assert.equal(f.coordinator.reportFor(f.attemptId), undefined);
      }
      const escapedToken = JSON.stringify({ ...BODY, summary: f.access.token }).replaceAll(
        f.access.token[0] ?? "0",
        `\\u00${(f.access.token.charCodeAt(0)).toString(16)}`,
      );
      assert.equal((await send(f.access, escapedToken)).status, 422);
      const invalidAuth = await send({ ...f.access, token: "wrong" });
      assert.equal(invalidAuth.status, 410);
      const origin = await fetch(f.access.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${f.access.token}`,
          "content-type": "application/json",
          origin: "http://evil.example",
        },
        body: JSON.stringify(BODY),
      });
      assert.equal(origin.status, 422);
      const big = await send(f.access, " ".repeat(131073));
      assert.equal(big.status, 413);
      assert.deepEqual(f.coordinator.inspect(f.runId), before);
    }));

  it("acknowledges durable acceptance, rejects duplicates and preserves the cursor", async () =>
    fixture(async (f) => {
      assert.equal((await send(f.access)).status, 201);
      const observer = new WorkflowDatabase(path.join(f.root, "state.sqlite"), { readOnly: true });
      try {
        assert.equal(new RunCoordinator(observer).reportFor(f.attemptId)?.summary, "done");
      } finally {
        observer.close();
      }
      assert.equal(f.coordinator.inspect(f.runId).transitions.length, 0);
      assert.equal((await send(f.access)).status, 409);
      assert.equal(
        f.coordinator.inspect(f.runId).events.filter((e) => e.type === "report_accepted").length,
        1,
      );
    }));

  it("rolls back the report if its event cannot be written", async () =>
    fixture(async (f) => {
      f.database
        .prepare(
          "CREATE TRIGGER fail_report_event BEFORE INSERT ON events WHEN NEW.type = 'report_accepted' BEGIN SELECT RAISE(ABORT, 'test event failure'); END",
        )
        .run();
      const before = f.coordinator.inspect(f.runId);
      assert.equal((await send(f.access)).status, 500);
      assert.equal(f.coordinator.reportFor(f.attemptId), undefined);
      assert.deepEqual(f.coordinator.inspect(f.runId), before);
      f.database.prepare("DROP TRIGGER fail_report_event").run();
      assert.equal((await send(f.access)).status, 201);
    }));

  it("rejects revoked, stopped and settled submissions", async () =>
    fixture(async (f) => {
      f.server.revoke(f.access);
      assert.equal((await send(f.access)).status, 410);
      const active = f.server.issue(f.attemptId);
      f.coordinator.settle(f.attemptId, { kind: "system", code: "system.report_error" });
      assert.equal((await send(active)).status, 410);
      assert.equal(f.coordinator.reportFor(f.attemptId), undefined);
      f.coordinator.resume(f.runId);
      const next = f.coordinator.advance(f.runId);
      assert.equal(next.kind, "attempt");
      if (next.kind !== "attempt") return;
      const stopped = f.server.issue(next.attemptId);
      f.coordinator.recordStop(f.runId, "test stop");
      assert.equal((await send(stopped)).status, 410);
    }));

  it("retains revoked token representations for rejection across later attempts in the channel", async () =>
    fixture(async (f) => {
      const old = f.access.token;
      f.server.revoke(f.access);
      f.coordinator.settle(f.attemptId, { kind: "system", code: "system.report_error" });
      f.coordinator.resume(f.runId);
      const next = f.coordinator.advance(f.runId);
      assert.equal(next.kind, "attempt");
      if (next.kind !== "attempt") throw new Error("not dispatched");
      const access = f.server.issue(next.attemptId);
      assert.deepEqual(access.secrets, [old, access.token]);
      assert.equal(
        (await send(access, { ...BODY, summary: Buffer.from(old).toString("base64") })).status,
        422,
      );
      assert.equal(f.coordinator.reportFor(next.attemptId), undefined);
      assert.equal((await send(access)).status, 201);
    }));

  it("persists correction budget and rejects a second request transactionally after reopen", async () =>
    fixture(async (f) => {
      f.coordinator.recordInvocation(f.attemptId, 0, "settled", {
        pid: null,
        sessionId: "persisted-fixture-session",
      });
      f.coordinator.requestCorrection(f.attemptId);
      const before = f.coordinator.inspect(f.runId);
      const observer = new WorkflowDatabase(path.join(f.root, "state.sqlite"), { readOnly: true });
      try {
        const reopened = new RunCoordinator(observer);
        assert.equal(reopened.activeAttempt(f.runId)?.correctionCount, 1);
        assert.throws(() => f.coordinator.requestCorrection(f.attemptId), /already requested/);
        assert.deepEqual(reopened.inspect(f.runId), before);
      } finally {
        observer.close();
      }
    }));

  it("rechecks token lifetime after a slow request body arrives", async () =>
    fixture(async (f) => {
      const status = new Promise<number>((resolve, reject) => {
        const req = request(
          f.access.endpoint,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${f.access.token}`,
              "content-type": "application/json",
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode ?? 0));
          },
        );
        req.on("error", reject);
        req.write('{"outcome":');
        setTimeout(() => {
          f.server.revoke(f.access);
          req.end('"complete","summary":"late"}');
        }, 30);
      });
      assert.equal(await status, 410);
      assert.equal(f.coordinator.reportFor(f.attemptId), undefined);
    }));

  it("real wf client waits for acknowledgment and submits handoff content and JSON", async () =>
    fixture(async (f) => {
      const handoff = path.join(f.root, "handoff.md");
      writeFileSync(handoff, "Durable handoff text");
      const cli = (args: string[]) =>
        startProcess({
          command: path.join(REPO_ROOT, "bin", "wf"),
          args,
          cwd: f.root,
          env: {
            PATH: process.env["PATH"],
            WF_REPORT_ENDPOINT: f.access.endpoint,
            WF_REPORT_TOKEN: f.access.token,
          },
        }).completed;
      const before = f.coordinator.inspect(f.runId);
      const rejected = await cli(["report", "unknown", "--summary", "bad"]);
      assert.equal(rejected.exitCode, 1);
      assert.match(rejected.stderr, /Allowed outcomes: complete, blocked/);
      assert.equal(f.coordinator.reportFor(f.attemptId), undefined);
      assert.deepEqual(f.coordinator.inspect(f.runId), before);
      const accepted = await cli([
        "report",
        "complete",
        "--summary",
        "done",
        "--handoff-file",
        handoff,
        "--data",
        '{"count":2}',
      ]);
      assert.equal(accepted.exitCode, 0);
      assert.match(accepted.stdout, /report accepted/);
      assert.equal(f.coordinator.reportFor(f.attemptId)?.handoff, readFileSync(handoff, "utf8"));
      assert.deepEqual(f.coordinator.reportFor(f.attemptId)?.data, { count: 2 });
      const duplicate = await cli(["report", "complete", "--summary", "duplicate"]);
      assert.equal(duplicate.exitCode, 1);
      assert.match(duplicate.stderr, /409/);
      f.server.revoke(f.access);
      assert.match((await cli(["report", "complete", "--summary", "late"])).stderr, /410/);
    }));
});
