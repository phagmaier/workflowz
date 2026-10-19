import assert from "node:assert/strict";
import { execFile, fork, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { childEnvironment } from "../adapters/environment.js";
import { observeProcessGroup, signalOwnedGroup } from "../adapters/process-identity.js";
import { managementRequestSchema } from "../contracts/management.js";
import { RunCoordinator } from "../engine/run-coordinator.js";
import { WorkflowDatabase } from "../store/database.js";
import type { AttemptRow, RunRow } from "../store/run-store.js";
import { REPO_ROOT } from "../test-support/paths.js";
import { workflowText } from "../test-support/workflows.js";
import { managementRequest } from "./management-client.js";
import { readDaemonAccess, stateDirectory } from "./state-directory.js";

interface Status {
  run: RunRow;
  expectedEventId: number;
  activeAttempt: AttemptRow | null;
  latestReport: unknown;
}
const END = workflowText("start: done\nsteps:\n  done: {kind: end}\n");
const AGENT = workflowText(`start: work
steps:
  work:
    kind: agent
    harness: codex
    session: fresh
    prompt: Offline fixture
    outcomes: [complete]
    on:
      complete: {goto: done}
  done: {kind: end}
`);
const COMMAND = workflowText(`start: work
steps:
  work:
    kind: command
    argv: ["${process.execPath}", "-e", "const t=setInterval(() => {if(require('node:fs').existsSync('release'))clearInterval(t)},20)"]
    timeout_seconds: 30
    on:
      complete: {goto: next}
      failed: {pause: true}
  next:
    kind: command
    argv: ["${process.execPath}", "-e", "require('node:fs').appendFileSync('effects', 'x')"]
    on:
      complete: {goto: done}
      failed: {pause: true}
  done: {kind: end}
`);

async function until<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeout = 15000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() >= deadline) throw new Error("management fixture condition timed out");
    await delay(30);
  }
}

async function fixture(t: TestContext, mode?: string) {
  const root = mkdtempSync(path.join(REPO_ROOT, ".tmp-management-"));
  const directory = path.join(root, "state");
  const env = childEnvironment({ PATH: process.env["PATH"] ?? "" });
  const owners: { child: ReturnType<typeof spawn>; exited: Promise<void> }[] = [];
  const cli = (args: string[]) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile(
        path.join(REPO_ROOT, "bin/wf"),
        args[0] === "report" ? args : ["--state-dir", directory, "--json", ...args],
        { env, timeout: 20000, maxBuffer: 2 * 1024 * 1024 },
        (error, stdout, stderr) => {
          resolve({
            code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
            stdout,
            stderr,
          });
        },
      );
    });
  const ok = async <T = unknown>(args: string[]): Promise<T> => {
    const result = await cli(args);
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout) as T;
  };
  const launch = async (fixtureMode?: string) => {
    const child = fixtureMode
      ? fork(
          path.join(REPO_ROOT, "test/fixtures/management-daemon.mjs"),
          [directory, fixtureMode],
          { env, stdio: ["ignore", "pipe", "pipe", "ipc"] },
        )
      : spawn(
          path.join(REPO_ROOT, "bin/wf"),
          ["--state-dir", directory, "--json", "daemon", "start"],
          { env, stdio: ["ignore", "pipe", "pipe"] },
        );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4096);
    });
    child.stdout?.resume();
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    owners.push({ child, exited });
    await until(
      async () => {
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error(`daemon exited: ${stderr}`);
        return cli(["daemon", "status"]);
      },
      (result) => result.code === 0,
    );
    return {
      child,
      exited,
      crash: async () => {
        child.kill("SIGKILL");
        await exited;
      },
    };
  };
  t.after(async () => {
    for (const owner of owners) {
      if (owner.child.exitCode === null && owner.child.signalCode === null)
        owner.child.kill("SIGKILL");
      await owner.exited;
    }
    const file = path.join(directory, "state.sqlite");
    if (existsSync(file)) {
      const reader = new WorkflowDatabase(file, { readOnly: true });
      try {
        const rows = reader.prepare("SELECT run_id FROM runs").all();
        for (const row of rows) {
          const state = new RunCoordinator(reader).inspect(String(row["run_id"]));
          for (const attempt of state.attempts) {
            const identity = attempt.processIdentity;
            if (!identity) continue;
            if (observeProcessGroup(identity) === "alive")
              signalOwnedGroup(identity.pid, identity, "SIGKILL");
            await until(
              async () => observeProcessGroup(identity),
              (state) => state === "gone",
            );
          }
        }
      } finally {
        reader.close();
      }
    }
    rmSync(root, { recursive: true, force: true });
    assert.equal(existsSync(root), false);
  });
  const owner = await launch(mode);
  const file = (name: string, text: string) => {
    const file = path.join(root, name);
    writeFileSync(file, text);
    return file;
  };
  const create = async (text: string) =>
    (await ok<{ runId: string }>(["run", "create", file("workflow.yaml", text)])).runId;
  const status = (id: string) => ok<Status>(["run", "status", id]);
  const control = async (action: string, id: string, extra: string[] = []) =>
    ok([
      "run",
      action,
      id,
      "--expected-event",
      String((await status(id)).expectedEventId),
      ...extra,
    ]);
  return { root, directory, cli, ok, file, create, status, control, owner, launch };
}

describe("management CLI and local daemon", { timeout: 90000 }, () => {
  it("validates without a daemon; imports immutable definitions, previews/tasks and paginates events", async (t) => {
    const f = await fixture(t);
    const invalid = f.file("bad.yaml", "version: 99\n");
    assert.equal((await f.cli(["workflow", "validate", invalid])).code, 1);
    const unsupported = await f.cli([
      "run",
      "create",
      f.file("unsupported.yaml", AGENT.replace("harness: codex", "harness: unavailable_fixture")),
    ]);
    assert.equal(unsupported.code, 1);
    assert.match(unsupported.stderr, /unknown_harness/);
    assert.equal((await f.cli(["workflow", "validate", "missing.yaml"])).code, 2);
    const tasks = "tasks:\n  source: {kind: markdown_checklist, path: tasks.md}\n";
    f.file("tasks.md", "# Tasks\n- [ ] first\n- [x] second\n");
    const file = f.file("tasks.yaml", END.replace("start:", `${tasks}start:`));
    const preview = await f.ok<{ runnableCount: number; total: number }>([
      "tasks",
      "preview",
      file,
    ]);
    assert.equal(preview.total, 2);
    assert.equal(preview.runnableCount, 1);
    const imported = await f.ok<{ revisionId: number }>(["workflow", "import", file]);
    f.file("tasks.yaml", "invalid");
    const { runId } = await f.ok<{ runId: string }>([
      "run",
      "create",
      "--revision",
      String(imported.revisionId),
    ]);
    const snapshot = await f.ok<unknown[]>(["run", "tasks", runId]);
    assert.equal(snapshot.length, 1);
    assert.equal((await f.ok<unknown[]>(["workflow", "list"])).length, 1);
    assert.equal((await f.ok<unknown[]>(["run", "list"])).length, 1);
    const first = await f.ok<{
      events: { eventId: number }[];
      nextAfter: number;
      hasMore: boolean;
    }>(["run", "events", runId, "--limit", "1"]);
    assert.equal(first.events.length, 1);
    assert.equal(first.hasMore, true);
    const second = await f.ok<{ events: { eventId: number }[] }>([
      "run",
      "events",
      runId,
      "--after",
      String(first.nextAfter),
    ]);
    assert.ok(second.events.every((e) => e.eventId > first.nextAfter));
    assert.equal((await f.cli(["run", "events", runId, "--limit", "1001"])).code, 2);
    assert.equal((await f.cli(["run", "status", "unknown"])).code, 1);
    assert.equal((await f.cli(["run", "status", runId, "--bogus", "x"])).code, 2);
    await f.ok(["daemon", "stop"]);
    await f.owner.exited;
    assert.equal((await f.cli(["daemon", "status"])).code, 1);
    assert.equal((await f.cli(["workflow", "validate", f.file("valid.yaml", END)])).code, 0);
  });

  it("controls a driven command from other CLI processes, rejects stale/wrong-state controls and reuses service after stop", async (t) => {
    const f = await fixture(t);
    const id = await f.create(COMMAND);
    const before = await f.status(id);
    await f.control("start", id);
    await until(
      () => f.status(id),
      (s) => s.activeAttempt?.processIdentity != null,
    );
    const other = await f.create(END);
    assert.equal(
      (
        await f.cli([
          "run",
          "start",
          other,
          "--expected-event",
          String((await f.status(other)).expectedEventId),
        ])
      ).code,
      1,
    );
    assert.equal(
      (await f.cli(["run", "pause", id, "--expected-event", String(before.expectedEventId)])).code,
      1,
    );
    await f.control("pause", id);
    // An unrelated ready run must stop without waiting for this still-held drive.
    const saved = await f.create(END);
    await f.control("stop", saved, ["--reason", "discard saved run"]);
    assert.equal((await f.status(saved)).run.status, "stopped");
    assert.equal((await f.status(id)).run.status, "pausing");
    f.file("release", "settle first command");
    const paused = await until(
      () => f.status(id),
      (s) => s.run.status === "paused",
    );
    assert.equal(paused.run.cursorStepId, "next");
    assert.equal(existsSync(path.join(f.root, "effects")), false);
    assert.equal(
      (await f.cli(["run", "start", id, "--expected-event", String(paused.expectedEventId)])).code,
      1,
    );
    await f.control("resume", id, ["--reason", "continue from committed cursor"]);
    await until(
      () => f.status(id),
      (s) => s.run.status === "completed",
    );
    assert.equal(readFileSync(path.join(f.root, "effects"), "utf8"), "x");
    rmSync(path.join(f.root, "release"));
    const stopped = await f.create(COMMAND);
    await f.control("start", stopped);
    await until(
      () => f.status(stopped),
      (s) => s.activeAttempt?.processIdentity != null,
    );
    await f.control("stop", stopped, ["--reason", "stop owned operation"]);
    assert.equal((await f.status(stopped)).run.status, "stopped");
    await f.control("start", other);
    await until(
      () => f.status(other),
      (s) => s.run.status === "completed",
    );
  });

  it("honors graceful daemon shutdown as pause-after-current and restart never auto-drives", async (t) => {
    const f = await fixture(t);
    const id = await f.create(COMMAND);
    await f.control("start", id);
    await until(
      () => f.status(id),
      (s) => s.activeAttempt?.processIdentity != null,
    );
    f.owner.child.kill("SIGTERM");
    await until(
      () => f.status(id),
      (s) => s.run.status === "pausing",
    );
    f.file("release", "settle during graceful shutdown");
    await f.owner.exited;
    assert.equal(existsSync(path.join(f.directory, "daemon.json")), false);
    assert.equal(existsSync(path.join(f.root, "effects")), false);
    await f.launch();
    const state = await f.status(id);
    assert.equal(state.run.status, "paused");
    assert.equal(state.run.cursorStepId, "next");
    await delay(150);
    assert.equal((await f.status(id)).expectedEventId, state.expectedEventId);
    await f.control("resume", id, ["--reason", "explicitly continue"]);
    await until(
      () => f.status(id),
      (s) => s.run.status === "completed",
    );
    assert.equal(readFileSync(path.join(f.root, "effects"), "utf8"), "x");
  });

  it("starts, revises and resumes from frozen tasks after the checklist is removed", async (t) => {
    const f = await fixture(t);
    const text = COMMAND.replace(
      "start: work",
      "tasks:\n  source: {kind: markdown_checklist, path: tasks.md}\nstart: pick",
    )
      .replace(
        "steps:\n",
        "steps:\n  pick:\n    kind: task.next\n    on:\n      task_ready: {goto: work}\n      exhausted: {goto: end}\n",
      )
      .replace(
        "  done: {kind: end}",
        "  done: {kind: task.complete, on: {complete: {goto: end}}}\n  end: {kind: end}",
      );
    const file = f.file("tasks-workflow.yaml", text);
    assert.equal((await f.cli(["run", "create", file])).code, 1);
    f.file("tasks.md", "- [ ] frozen task\n");
    const id = await f.create(text);
    const tasks = await f.ok<{ taskId: string; title: string }[]>(["run", "tasks", id]);
    rmSync(path.join(f.root, "tasks.md"));
    await f.control("start", id);
    await until(
      () => f.status(id),
      (s) => s.activeAttempt?.processIdentity != null,
    );
    await f.control("pause", id);
    f.file("release", "settle imported task's current step");
    await until(
      () => f.status(id),
      (s) => s.run.status === "paused",
    );
    const active = await f.ok<{ taskId: string; title: string }[]>(["run", "tasks", id]);
    assert.equal(active[0]?.taskId, tasks[0]?.taskId);
    assert.equal(active[0]?.title, "frozen task");
    const revised = f.file("revised.yaml", text.replace("name: test", "name: revised"));
    await f.control("revise", id, ["--file", revised, "--reason", "revise frozen task run"]);
    await f.control("resume", id, ["--reason", "continue frozen task run"]);
    await until(
      () => f.status(id),
      (s) => s.run.status === "completed",
    );
    assert.equal(readFileSync(path.join(f.root, "effects"), "utf8"), "x");
    const completed = await f.ok<{ taskId: string; state: string }[]>(["run", "tasks", id]);
    assert.equal(completed[0]?.state, "completed");
    assert.equal(completed[0]?.taskId, tasks[0]?.taskId);
    assert.equal(completed.length, tasks.length);
  });

  it("supports paused revision, cursor/skip/task overrides and reasoned task completion", async (t) => {
    const f = await fixture(t);
    f.file("tasks.md", "- [ ] first\n- [ ] second\n");
    const text = workflowText(
      `tasks:\n  source: {kind: markdown_checklist, path: tasks.md}\nstart: pick\nsteps:\n  pick:\n    kind: task.next\n    on:\n      task_ready: {goto: work}\n      exhausted: {goto: done}\n  work:\n    kind: command\n    argv: ["${process.execPath}", "-e", "process.exit(1)"]\n    on:\n      complete: {goto: pick}\n      failed: {pause: true}\n  done: {kind: end}\n`,
    );
    const id = await f.create(text);
    const tasks = await f.ok<{ taskId: string }[]>(["run", "tasks", id]);
    const task = tasks[0];
    assert.ok(task);
    const edit = f.file(
      "edit.json",
      JSON.stringify({
        overrides: { steps: { work: { on: { failed: { pause: true } } } } },
        reason: "choose task routing",
      }),
    );
    await f.control("task-overrides", id, ["--task", task.taskId, "--request", edit]);
    await f.control("start", id);
    await until(
      () => f.status(id),
      (s) => s.run.status === "paused",
    );
    const override = (value: unknown) => f.file("override.json", JSON.stringify(value));
    const bad = override({ action: "jump", stepId: "pick", reason: "incompatible active task" });
    assert.equal(
      (
        await f.cli([
          "run",
          "override",
          id,
          "--expected-event",
          String((await f.status(id)).expectedEventId),
          "--request",
          bad,
        ])
      ).code,
      1,
    );
    await f.control("override", id, [
      "--request",
      override({
        action: "mark-task-complete",
        taskId: task.taskId,
        reason: "manually accept task",
      }),
    ]);
    await f.control("override", id, [
      "--request",
      override({ action: "skip", outcome: "complete", reason: "skip failed stage" }),
    ]);
    await f.control("override", id, [
      "--request",
      override({ action: "jump", stepId: "done", reason: "end remaining work" }),
    ]);
    const revision = f.file("revision.yaml", text.replace("name: test", "name: revised"));
    await f.control("revise", id, ["--file", revision, "--reason", "revise remaining graph"]);
    assert.equal((await f.ok<{ state: string }[]>(["run", "tasks", id]))[0]?.state, "completed");
    await f.control("resume", id, ["--reason", "execute revised cursor"]);
    await until(
      () => f.status(id),
      (s) => s.run.status === "completed",
    );
  });

  it("acknowledges API shutdown while draining and rejects new mutations before the held step settles", async (t) => {
    const f = await fixture(t);
    const id = await f.create(COMMAND);
    await f.control("start", id);
    await until(
      () => f.status(id),
      (s) => s.activeAttempt?.processIdentity != null,
    );
    await f.ok(["daemon", "stop"]);
    const lifecycle = await f.ok<{ closing: boolean }>(["daemon", "status"]);
    assert.equal(lifecycle.closing, true);
    assert.equal((await f.status(id)).run.status, "pausing");
    assert.equal((await f.cli(["run", "create", f.file("next.yaml", END)])).code, 1);
    assert.equal(f.owner.child.exitCode, null);
    f.file("release", "finish admitted step");
    await f.owner.exited;
    assert.equal(existsSync(path.join(f.root, "effects")), false);
  });

  it("keeps real wf report and one exact-session correction working through the daemon", async (t) => {
    const f = await fixture(t, "correction");
    const id = await f.create(AGENT);
    await f.control("start", id);
    await until(
      () => f.status(id),
      (s) => s.run.status === "completed",
    );
    const reports = await f.ok<{ outcome: string }[]>(["run", "reports", id]);
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.outcome, "complete");
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(f.directory, "authority-result"), "utf8")),
      [401, 410],
    );
    const events = await f.ok<{ events: { type: string }[] }>(["run", "events", id]);
    assert.equal(events.events.filter((e) => e.type === "correction_requested").length, 1);
    assert.equal((await f.cli(["report", "complete", "--summary", "outside attempt"])).code, 1);
  });

  it("rejects competing owners; crash/reopen preserves accepted report, blocks replay and exposes exact recovery decisions", async (t) => {
    const f = await fixture(t, "hang");
    const id = await f.create(AGENT);
    await f.control("start", id);
    const active = await until(
      () => f.status(id),
      (s) => s.latestReport != null && s.activeAttempt?.processIdentity != null,
    );
    const discovery = readFileSync(path.join(f.directory, "daemon.json"), "utf8");
    assert.equal((await f.cli(["daemon", "start"])).code, 1);
    assert.equal(readFileSync(path.join(f.directory, "daemon.json"), "utf8"), discovery);
    await f.owner.crash();
    assert.equal((await f.cli(["daemon", "status"])).code, 1);
    await f.launch("hang");
    const interrupted = await f.status(id);
    assert.equal(interrupted.run.status, "interrupted");
    assert.ok(interrupted.latestReport);
    assert.equal(
      (
        await f.cli([
          "run",
          "resume",
          id,
          "--expected-event",
          String(interrupted.expectedEventId),
          "--reason",
          "cannot bypass recovery",
        ])
      ).code,
      1,
    );
    type Recovery = { expectedEventId: number; attempt: AttemptRow | null };
    const state = await f.ok<Recovery>(["run", "recovery", id]);
    assert.equal(state.attempt?.attemptId, active.activeAttempt?.attemptId);
    const request = {
      expectedEventId: state.expectedEventId,
      attemptId: state.attempt?.attemptId ?? null,
      reason: "terminate verified orphan",
    };
    const requestFile = f.file("recovery.json", JSON.stringify(request));
    await f.ok(["run", "recovery-terminate", id, "--request", requestFile]);
    assert.equal(
      (await f.cli(["run", "recovery-terminate", id, "--request", requestFile])).code,
      1,
    );
    const resolved = await f.ok<Recovery>(["run", "recovery", id]);
    assert.equal(
      (
        await f.cli([
          "run",
          "stop",
          id,
          "--expected-event",
          String(resolved.expectedEventId),
          "--reason",
          "cannot bypass exact recovery identity",
        ])
      ).code,
      1,
    );
    f.file(
      "recovery.json",
      JSON.stringify({
        ...request,
        expectedEventId: resolved.expectedEventId,
        action: "end",
        reason: "reviewed external effects; end run",
      }),
    );
    await f.ok(["run", "recovery-decide", id, "--request", requestFile]);
    assert.equal((await f.status(id)).run.status, "stopped");
    assert.equal((await f.ok<unknown[]>(["run", "reports", id])).length, 1);
  });

  it("enforces separate management authority, strict bodies/origin, owner-only discovery and no token output", async (t) => {
    const f = await fixture(t);
    const access = readDaemonAccess(f.directory);
    assert.equal(statSync(f.directory).mode & 0o777, 0o700);
    assert.equal(statSync(path.join(f.directory, "daemon.json")).mode & 0o777, 0o600);
    const raw = (body: string, auth = `Bearer ${access.token}`, origin?: string) =>
      fetch(`http://127.0.0.1:${access.port}/api/v1`, {
        method: "POST",
        headers: {
          authorization: auth,
          "content-type": "application/json",
          ...(origin ? { origin } : {}),
        },
        body,
      });
    assert.equal((await raw('{"op":"ping"}', "Bearer attempt-token")).status, 401);
    assert.equal((await raw('{"op":"ping"}', undefined, "http://localhost")).status, 422);
    assert.equal((await raw('{"op":"ping","hidden":true}')).status, 422);
    assert.equal((await raw("{")).status, 422);
    assert.equal((await raw("x".repeat(2 * 1024 * 1024 + 1))).status, 413);
    const output = await f.cli(["daemon", "status"]);
    assert.ok(!output.stdout.includes(access.token));
    assert.ok(!output.stderr.includes(access.token));
    const discovery = path.join(f.directory, "daemon.json");
    chmodSync(discovery, 0o644);
    assert.throws(() => readDaemonAccess(f.directory));
    chmodSync(discovery, 0o600);
    const saved = readFileSync(discovery, "utf8");
    rmSync(discovery);
    const target = f.file("discovery-copy", saved);
    symlinkSync(target, discovery);
    assert.throws(() => readDaemonAccess(f.directory));
    rmSync(discovery);
    writeFileSync(discovery, saved, { mode: 0o600 });
    assert.deepEqual(await managementRequest(f.directory, { op: "ping" }), {
      version: 1,
      closing: false,
      driveFailure: null,
    });
  });
});

describe("management contracts and state selection", () => {
  it("uses explicit, environment, then XDG defaults", () => {
    assert.equal(stateDirectory("/explicit", { WF_STATE_DIR: "/env" }), "/explicit");
    assert.equal(
      stateDirectory(undefined, { WF_STATE_DIR: "/env", XDG_STATE_HOME: "/xdg" }),
      "/env",
    );
    assert.equal(stateDirectory(undefined, { XDG_STATE_HOME: "/xdg" }), "/xdg/workflowz");
    assert.throws(() => stateDirectory(""));
  });
  it("rejects authority extras, missing/stale-shape cursors, blank reasons and unknown recovery actions", () => {
    for (const input of [
      { op: "pause", runId: "run" },
      { op: "start", runId: "run", expectedEventId: "1" },
      { op: "stop", runId: "run", expectedEventId: 1, reason: " " },
      {
        op: "override",
        runId: "run",
        expectedEventId: 1,
        edit: { action: "jump", stepId: "work", reason: "yes", status: "completed" },
      },
      {
        op: "recovery-decide",
        runId: "run",
        request: { action: "success", expectedEventId: 1, attemptId: null, reason: "no" },
      },
    ])
      assert.equal(managementRequestSchema.safeParse(input).success, false);
  });
});
