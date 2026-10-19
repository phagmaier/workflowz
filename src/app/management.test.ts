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
  const inspect = (id: string) => {
    const reader = new WorkflowDatabase(path.join(directory, "state.sqlite"), { readOnly: true });
    try {
      const coordinator = new RunCoordinator(reader);
      const state = coordinator.inspect(id);
      return {
        ...state,
        inputs: state.attempts.map((attempt) => coordinator.attemptInput(attempt.attemptId)),
      };
    } finally {
      reader.close();
    }
  };
  const control = async (action: string, id: string, extra: string[] = []) =>
    ok([
      "run",
      action,
      id,
      "--expected-event",
      String((await status(id)).expectedEventId),
      ...extra,
    ]);
  return { root, directory, cli, ok, file, create, status, inspect, control, owner, launch };
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

  it("drains daemon shutdown promptly during a persisted retry wait", async (t) => {
    const f = await fixture(t);
    const text = workflowText(`start: work
steps:
  work:
    kind: command
    argv: ["false"]
    on:
      complete: {goto: done}
      failed: {retry: {max_attempts: 2, backoff_seconds: 60}}
  done: {kind: end}
`);
    const id = await f.create(text);
    await f.control("start", id);
    await until(
      () => f.status(id),
      (s) => s.run.retryNotBefore !== null && s.activeAttempt === null,
    );
    const time = Date.now();
    await f.ok(["daemon", "stop"]);
    await f.owner.exited;
    assert.ok(Date.now() - time < 3000, "shutdown must wake the retry wait");
    await f.launch();
    const state = await f.status(id);
    assert.equal(state.run.status, "paused");
    assert.ok(state.run.retryNotBefore);
    const events = await f.ok<{ events: { type: string }[] }>(["run", "events", id]);
    assert.equal(events.events.filter((e) => e.type === "attempt_started").length, 1);
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

  it("recovers a killed command daemon, escalates owned descendant cleanup and admits only one explicit retry", async (t) => {
    const f = await fixture(t);
    f.file(
      "tree.mjs",
      `
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
appendFileSync("executions", "x");
if (readFileSync("executions", "utf8") === "x") {
  process.on("SIGTERM", () => appendFileSync("term", "leader\\n"));
  const child = spawn(process.execPath, ["-e",
    "process.on('SIGTERM',()=>require('node:fs').appendFileSync('term','child\\\\n'));process.stdout.write('ready');setInterval(()=>{},1000)"],
    { stdio: ["ignore", "pipe", "inherit"] });
  child.stdout.once("data", () => writeFileSync("descendant", String(child.pid)));
  setInterval(() => {}, 1000);
}
`,
    );
    const text = COMMAND.replace(
      / {4}argv: .*release.*\n/,
      `    argv: ${JSON.stringify([process.execPath, "tree.mjs"])}\n`,
    );
    const id = await f.create(text);
    const startArgs = [
      "run",
      "start",
      id,
      "--expected-event",
      String((await f.status(id)).expectedEventId),
    ];
    assert.deepEqual(
      (await Promise.all([f.cli(startArgs), f.cli(startArgs)])).map((r) => r.code).sort(),
      [0, 1],
    );
    const active = await until(
      () => f.status(id),
      (s) =>
        s.activeAttempt?.processIdentity != null && existsSync(path.join(f.root, "descendant")),
    );
    const identity = active.activeAttempt?.processIdentity;
    assert.ok(identity);
    const descendant = Number(readFileSync(path.join(f.root, "descendant"), "utf8"));
    const before = f.inspect(id);
    await f.owner.crash();
    await f.launch();
    assert.equal((await f.status(id)).run.status, "interrupted");
    assert.equal(observeProcessGroup(identity), "alive", "startup must not terminate the tree");
    assert.deepEqual(f.inspect(id).transitions, []);
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
    type Recovery = { expectedEventId: number; attempt: AttemptRow | null };
    const request = async (action?: string) => {
      const state = await f.ok<Recovery>(["run", "recovery", id]);
      return f.file(
        "recovery.json",
        JSON.stringify({
          expectedEventId: state.expectedEventId,
          attemptId: state.attempt?.attemptId ?? null,
          reason: "Reviewed partial effects; explicitly clean up and retry",
          ...(action ? { action } : {}),
        }),
      );
    };
    assert.equal(
      (await f.cli(["run", "recovery-decide", id, "--request", await request("retry")])).code,
      1,
    );
    await f.ok(["run", "recovery-terminate", id, "--request", await request()]);
    assert.equal(observeProcessGroup(identity), "gone");
    assert.equal(existsSync(`/proc/${descendant}`), false, "descendant must be reaped");
    assert.deepEqual(readFileSync(path.join(f.root, "term"), "utf8").trim().split("\n").sort(), [
      "child",
      "leader",
    ]);
    await f.ok(["run", "recovery-decide", id, "--request", await request("retry")]);
    const paused = await f.status(id);
    assert.equal(paused.run.status, "paused");
    assert.equal((await f.status(id)).expectedEventId, paused.expectedEventId);
    assert.equal(readFileSync(path.join(f.root, "executions"), "utf8"), "x");
    const resume = [
      "run",
      "resume",
      id,
      "--expected-event",
      String(paused.expectedEventId),
      "--reason",
      "Execute only the selected retry",
    ];
    assert.deepEqual(
      (await Promise.all([f.cli(resume), f.cli(resume)])).map((r) => r.code).sort(),
      [0, 1],
    );
    await until(
      () => f.status(id),
      (s) => s.run.status === "completed",
    );
    const final = f.inspect(id);
    assert.equal(readFileSync(path.join(f.root, "executions"), "utf8"), "xx");
    assert.equal(readFileSync(path.join(f.root, "effects"), "utf8"), "x");
    assert.equal(final.attempts.length, 3);
    assert.equal(final.attempts[0]?.attemptId, before.attempts[0]?.attemptId);
    assert.equal(final.attempts[0]?.status, "interrupted");
    assert.deepEqual(
      final.transitions.map((row) => row.fromStepId),
      ["work", "next"],
    );
    assert.equal(
      final.transitions.some((row) => row.attemptId === before.attempts[0]?.attemptId),
      false,
    );
  });

  for (const mode of ["before-report", "correction-hang"] as const) {
    it(`never replays an agent or routes its interrupted report after daemon SIGKILL at ${mode}`, async (t) => {
      const f = await fixture(t, mode);
      const id = await f.create(AGENT);
      await f.control("start", id);
      const active = await until(
        () => f.status(id),
        (s) =>
          s.activeAttempt?.processIdentity != null &&
          (mode === "before-report" || s.latestReport != null),
      );
      const before = f.inspect(id);
      const original = before.attempts[0];
      assert.ok(original?.processIdentity);
      assert.equal(original.correctionCount, mode === "before-report" ? 0 : 1);
      const reports = await f.ok<unknown[]>(["run", "reports", id]);
      assert.equal(reports.length, mode === "before-report" ? 0 : 1);
      assert.equal(before.transitions.length, 0);
      await f.owner.crash();
      await f.launch("report");
      const recovered = await f.status(id);
      assert.equal(recovered.run.status, "interrupted");
      assert.equal(observeProcessGroup(original.processIdentity), "alive");
      assert.deepEqual(recovered.latestReport, active.latestReport);
      assert.equal((await f.status(id)).expectedEventId, recovered.expectedEventId);
      const reopened = f.inspect(id);
      assert.deepEqual(reopened.inputs, before.inputs);
      assert.deepEqual(
        reopened.events.filter((e) =>
          [
            "invocation_started",
            "invocation_settled",
            "correction_requested",
            "report_accepted",
          ].includes(e.type),
        ),
        before.events.filter((e) =>
          [
            "invocation_started",
            "invocation_settled",
            "correction_requested",
            "report_accepted",
          ].includes(e.type),
        ),
      );
      const recovery = async () => {
        const state = await f.ok<{ expectedEventId: number; attempt: AttemptRow }>([
          "run",
          "recovery",
          id,
        ]);
        return {
          expectedEventId: state.expectedEventId,
          attemptId: state.attempt.attemptId,
          reason: "Explicit cleanup and retry after inspecting interrupted effects",
        };
      };
      await f.ok([
        "run",
        "recovery-terminate",
        id,
        "--request",
        f.file("cleanup.json", JSON.stringify(await recovery())),
      ]);
      assert.equal(observeProcessGroup(original.processIdentity), "gone");
      await f.ok([
        "run",
        "recovery-decide",
        id,
        "--request",
        f.file("decision.json", JSON.stringify({ ...(await recovery()), action: "retry" })),
      ]);
      assert.equal((await f.status(id)).run.status, "paused");
      assert.equal(f.inspect(id).attempts.length, 1);
      await f.control("resume", id, ["--reason", "Launch the selected fresh logical attempt"]);
      await until(
        () => f.status(id),
        (s) => s.run.status === "completed",
      );
      const final = f.inspect(id);
      assert.equal(final.attempts.length, 2);
      assert.equal(final.attempts[0]?.status, "interrupted");
      assert.equal(final.attempts[0]?.correctionCount, original.correctionCount);
      assert.equal(final.attempts[1]?.correctionCount, 0);
      assert.notEqual(
        final.attempts[1]?.sessionId,
        original.sessionId,
        "fresh retry cannot reuse the uncertain session",
      );
      assert.deepEqual(final.inputs[0], before.inputs[0]);
      assert.equal(final.transitions.length, 1);
      assert.equal(final.transitions[0]?.attemptId, final.attempts[1]?.attemptId);
      const finalReports = await f.ok<unknown[]>(["run", "reports", id]);
      assert.deepEqual(finalReports.slice(0, reports.length), reports);
      assert.equal(finalReports.length, reports.length + 1);
    });
  }

  it("reopens a SIGKILL between committed steps and continues only after disposition plus resume", async (t) => {
    const f = await fixture(t, "between");
    f.file("release", "allow the first command to settle");
    const id = await f.create(COMMAND);
    await f.control("start", id);
    await until(async () => existsSync(path.join(f.directory, "between")), Boolean);
    const before = f.inspect(id);
    assert.equal(before.run.cursorStepId, "next");
    assert.equal(before.attempts[0]?.status, "succeeded");
    await f.owner.crash();
    await f.launch();
    const state = await f.status(id);
    assert.equal(state.run.status, "interrupted");
    assert.equal(state.activeAttempt, null);
    assert.deepEqual(f.inspect(id).transitions, before.transitions);
    assert.equal(existsSync(path.join(f.root, "effects")), false);
    const decision = f.file(
      "continue.json",
      JSON.stringify({
        expectedEventId: state.expectedEventId,
        attemptId: null,
        reason: "Continue the committed cursor without repeating work",
        action: "continue",
      }),
    );
    await f.ok(["run", "recovery-decide", id, "--request", decision]);
    const paused = await f.status(id);
    assert.equal((await f.status(id)).expectedEventId, paused.expectedEventId);
    assert.equal(existsSync(path.join(f.root, "effects")), false);
    await f.control("resume", id, ["--reason", "Execute next only"]);
    await until(
      () => f.status(id),
      (s) => s.run.status === "completed",
    );
    const final = f.inspect(id);
    assert.deepEqual(final.attempts[0], before.attempts[0]);
    assert.deepEqual(final.transitions[0], before.transitions[0]);
    assert.deepEqual(
      final.attempts.map((a) => a.stepId),
      ["work", "next"],
    );
    assert.equal(readFileSync(path.join(f.root, "effects"), "utf8"), "x");
  });

  it("does not dispatch an expired backoff after daemon SIGKILL until explicit continue and resume", async (t) => {
    const f = await fixture(t);
    const text = workflowText(`start: work
steps:
  work:
    kind: command
    argv: ["${process.execPath}", "-e", "require('node:fs').appendFileSync('effects','x');process.exit(1)"]
    on:
      complete: {goto: done}
      failed: {retry: {max_attempts: 2, backoff_seconds: 5}}
  done: {kind: end}
`);
    const id = await f.create(text);
    await f.control("start", id);
    const waiting = await until(
      () => f.status(id),
      (s) => s.run.retryNotBefore !== null,
    );
    const due = waiting.run.retryNotBefore;
    assert.ok(due);
    const before = f.inspect(id);
    await f.owner.crash();
    await f.launch();
    const interrupted = await f.status(id);
    assert.equal(interrupted.run.status, "interrupted");
    assert.equal(interrupted.run.retryNotBefore, waiting.run.retryNotBefore);
    assert.equal(interrupted.run.startTime, waiting.run.startTime);
    // The separate daemon owns a real wall-clock deadline; parent fake timers cannot advance it.
    await delay(Math.max(0, Date.parse(due) - Date.now()) + 100);
    assert.deepEqual(f.inspect(id).attempts, before.attempts);
    assert.deepEqual(f.inspect(id).transitions, before.transitions);
    assert.equal((await f.status(id)).expectedEventId, interrupted.expectedEventId);
    await f.ok([
      "run",
      "recovery-decide",
      id,
      "--request",
      f.file(
        "continue.json",
        JSON.stringify({
          expectedEventId: interrupted.expectedEventId,
          attemptId: null,
          reason: "Preserve the committed retry plan",
          action: "continue",
        }),
      ),
    ]);
    assert.equal((await f.status(id)).run.status, "paused");
    assert.equal(readFileSync(path.join(f.root, "effects"), "utf8"), "x");
    await f.control("resume", id, ["--reason", "Admit the due retry"]);
    await until(
      () => f.status(id),
      (s) => s.run.status === "paused",
    );
    const final = f.inspect(id);
    assert.equal(final.attempts.length, 2);
    assert.equal(final.transitions.at(-1)?.outcome, "system.retry_exhausted");
    assert.equal(final.run.retryNotBefore, null);
    assert.equal(final.run.startTime, before.run.startTime);
    assert.equal(readFileSync(path.join(f.root, "effects"), "utf8"), "xx");
  });

  it("preserves paused revisions, task progress and frozen settings across restarts without crossing session scope", async (t) => {
    const f = await fixture(t, "tasks");
    f.file("tasks.md", "- [ ] first\n- [ ] second\n");
    const text = workflowText(`tasks:
  source: {kind: markdown_checklist, path: tasks.md}
start: pick
steps:
  pick:
    kind: task.next
    on:
      task_ready: {goto: work}
      exhausted: {goto: done}
  work:
    kind: agent
    harness: codex
    session: fresh
    model: base
    prompt: 'Original {{task.text}}'
    outcomes: [complete, blocked]
    on:
      complete: {goto: finish}
      blocked: {pause: true}
  finish:
    kind: task.complete
    on:
      complete: {goto: pick}
  done: {kind: end}
`);
    const id = await f.create(text);
    const tasks = f.inspect(id).tasks;
    const second = tasks[1]?.taskId;
    assert.ok(second);
    await f.control("task-overrides", id, [
      "--task",
      second,
      "--request",
      f.file(
        "settings.json",
        JSON.stringify({
          reason: "Freeze the original task settings",
          overrides: {
            steps: { work: { model: "original-model", prompt: "Original {{task.text}}" } },
          },
        }),
      ),
    ]);
    await f.control("start", id);
    await until(
      () => f.status(id),
      (s) => s.run.status === "paused",
    );
    const before = f.inspect(id);
    assert.deepEqual(
      before.tasks.map((task) => task.state),
      ["completed", "active"],
    );
    assert.equal(before.inputs[1]?.model, "original-model");
    const reports = await f.ok<unknown[]>(["run", "reports", id]);
    const resumeRevision = (await f.control("revise", id, [
      "--file",
      f.file("resume.yaml", text.replace("session: fresh", "session: resume")),
      "--reason",
      "Require a session in the new revision",
    ])) as { revisionId: number };
    await f.control("task-overrides", id, [
      "--task",
      second,
      "--request",
      f.file(
        "settings.json",
        JSON.stringify({
          reason: "Change only future task settings",
          overrides: {
            steps: { work: { model: "revised-model", prompt: "Revised {{task.text}}" } },
          },
        }),
      ),
    ]);
    rmSync(path.join(f.root, "tasks.md"));
    const paused = await f.status(id);
    await f.owner.crash();
    const restarted = await f.launch("report");
    const reopened = await f.status(id);
    assert.deepEqual(reopened.run, paused.run);
    assert.equal(reopened.expectedEventId, paused.expectedEventId);
    assert.deepEqual(f.inspect(id).attempts, before.attempts);
    assert.deepEqual(f.inspect(id).inputs, before.inputs);
    await f.control("resume", id, ["--reason", "Try the revised explicit session policy"]);
    await until(
      () => f.status(id),
      (s) => s.run.status === "paused",
    );
    const unavailable = f.inspect(id);
    assert.equal(unavailable.attempts.length, 3);
    assert.equal(unavailable.attempts[2]?.revisionId, resumeRevision.revisionId);
    assert.equal(unavailable.attempts[2]?.errorCode, "system.resume_unavailable");
    assert.equal(
      unavailable.events.filter((event) => event.type === "invocation_started").length,
      2,
      "new revision cannot launch an old revision's session or fall back to fresh",
    );
    assert.deepEqual(await f.ok<unknown[]>(["run", "reports", id]), reports);
    const freshRevision = (await f.control("revise", id, [
      "--file",
      f.file("fresh.yaml", text.replace("Original", "Revised")),
      "--reason",
      "Explicitly choose fresh execution for remaining work",
    ])) as { revisionId: number };
    await restarted.crash();
    await f.launch("report");
    assert.equal((await f.status(id)).run.status, "paused");
    assert.equal((await f.status(id)).run.revisionId, freshRevision.revisionId);
    await f.control("resume", id, ["--reason", "Complete only the remaining task"]);
    await until(
      () => f.status(id),
      (s) => s.run.status === "completed",
    );
    const final = f.inspect(id);
    assert.deepEqual(
      final.tasks.map((task) => task.taskId),
      tasks.map((task) => task.taskId),
    );
    assert.deepEqual(
      final.tasks.map((task) => task.state),
      ["completed", "completed"],
    );
    assert.equal(final.run.startTime, before.run.startTime);
    assert.deepEqual(final.attempts.slice(0, 2), before.attempts);
    assert.deepEqual(final.inputs.slice(0, 2), before.inputs);
    assert.deepEqual(final.transitions.slice(0, before.transitions.length), before.transitions);
    assert.equal(final.attempts.length, 4);
    assert.equal(final.attempts[3]?.revisionId, freshRevision.revisionId);
    assert.equal(final.attempts[3]?.taskId, second);
    assert.equal(final.inputs[3]?.model, "revised-model");
    assert.match(final.inputs[3]?.prompt ?? "", /Revised second/);
    assert.notEqual(final.attempts[3]?.sessionId, before.attempts[1]?.sessionId);
    assert.equal(final.events.filter((event) => event.type === "workflow_revised").length, 2);
    const revisions = await f.ok<{ revisionId: number }[]>(["workflow", "list"]);
    for (const revisionId of [
      before.run.revisionId,
      resumeRevision.revisionId,
      freshRevision.revisionId,
    ])
      assert.ok(revisions.some((row) => row.revisionId === revisionId));
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
