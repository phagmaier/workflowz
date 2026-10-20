import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { AgentAdapter } from "../adapters/agent-adapter.js";
import { parseWorkflowText } from "../contracts/parse-workflow.js";
import { ScriptedAgentAdapter } from "../test-support/scripted-agent.js";
import type { BrowserDraft } from "./browser-service.js";
import { startDaemon } from "./daemon.js";
import { managementRequest } from "./management-client.js";
import type { BrowserEvents, BrowserRunStatus } from "./management-service.js";
import { readDaemonAccess } from "./state-directory.js";

const FLOW = `version: 1
name: Browser fixture
project:
  root: .
  instructions: [instructions.md]
tasks:
  source: {kind: markdown_checklist, path: tasks.md}
start: pick
steps:
  pick:
    kind: task.next
    on:
      task_ready: {goto: finish}
      exhausted: {goto: done}
  finish:
    kind: task.complete
    on:
      complete: {goto: pick}
  done: {kind: end}
`;
async function fixture(t: TestContext, agents?: Map<string, AgentAdapter>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-browser-"));
  writeFileSync(path.join(root, "instructions.md"), "Synthetic instructions");
  writeFileSync(path.join(root, "tasks.md"), "# Tasks\n- [x] old\n- [ ] parent\n    - [ ] child\n");
  const directory = path.join(root, "state");
  const owner = await startDaemon(directory, agents);
  t.after(async () => {
    await owner.close();
    rmSync(root, { recursive: true, force: true });
    assert.equal(existsSync(root), false);
  });
  const access = readDaemonAccess(directory);
  const url = `http://127.0.0.1:${access.port}`;
  let cookie = "";
  const post = (route: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${url}${route}`, {
      method: "POST",
      headers: {
        origin: url,
        "content-type": "application/json",
        "x-workflowz-ui": "1",
        cookie,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  const code = async () =>
    (await managementRequest(directory, { op: "browser-access" })) as { code: string; url: string };
  const pair = async () => {
    const issued = await code();
    const response = await post("/ui/pair", { code: issued.code });
    assert.equal(response.status, 200);
    cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Strict; Path=\/ui/);
    return issued;
  };
  const selection = {
    source: { workflowText: FLOW, workflowDir: root },
    projectRoot: root,
    instructions: ["instructions.md"],
    taskPath: "tasks.md",
    includeCompleted: false,
  };
  return { root, owner, access, url, post, code, pair, selection, directory };
}

describe("localhost browser shell boundary", () => {
  it("serves inert assets but requires separate cookie authority and exact origin/host for API", async (t) => {
    const f = await fixture(t);
    const page = await fetch(`${f.url}/ui/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.equal(page.headers.get("access-control-allow-origin"), null);
    assert.equal((await f.post("/ui/api", { op: "runs" })).status, 401);
    assert.equal(
      (await f.post("/ui/api", { op: "runs" }, { authorization: `Bearer ${f.access.token}` }))
        .status,
      401,
    );
    await f.pair();
    for (const headers of [
      { origin: "http://evil.invalid" },
      { origin: "null" },
      { origin: "" },
      { "x-workflowz-ui": "" },
      { "content-type": "text/plain" },
    ]) {
      assert.equal(
        (await f.post("/ui/api", { op: "runs" }, headers)).status,
        403,
        JSON.stringify(headers),
      );
    }
    // Node fetch replaces Host; raw HTTP is required to actually exercise rebinding.
    const wrongHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(`${f.url}/ui/`, { headers: { host: "evil.invalid" } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(wrongHostStatus, 403);
    assert.equal(
      (await f.post("/api/v1", { op: "runs" }, { authorization: `Bearer ${f.access.token}` }))
        .status,
      422,
    );
    assert.equal((await f.post("/ui/api", { op: "runs" })).status, 200);
  });
  it("consumes pairing once, rotates sessions, rejects CLI-token pairing and logs out", async (t) => {
    const f = await fixture(t);
    assert.equal((await f.post("/ui/pair", { code: f.access.token })).status, 401);
    const first = await f.code();
    const next = await f.code();
    assert.equal((await f.post("/ui/pair", { code: first.code })).status, 401);
    const paired = await f.post("/ui/pair", { code: next.code });
    const oldCookie = paired.headers.get("set-cookie")?.split(";")[0] ?? "";
    assert.equal(paired.status, 200);
    assert.equal((await f.post("/ui/pair", { code: next.code })).status, 401);
    await f.pair();
    assert.equal((await f.post("/ui/api", { op: "runs" }, { cookie: oldCookie })).status, 401);
    assert.equal((await f.post("/ui/api", { op: "logout" })).status, 200);
    assert.equal((await f.post("/ui/api", { op: "runs" })).status, 401);
  });

  it("revokes a partially received mutation when another pairing rotates its session", async (t) => {
    const f = await fixture(t);
    const paired = await f.post("/ui/pair", { code: (await f.code()).code });
    const cookie = paired.headers.get("set-cookie")?.split(";")[0] ?? "";
    const body = JSON.stringify({ op: "create", ...f.selection });
    let receiving: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      receiving = resolve;
    });
    const req = httpRequest(`${f.url}/ui/api`, {
      method: "POST",
      headers: {
        origin: f.url,
        cookie,
        "content-type": "application/json",
        "x-workflowz-ui": "1",
        expect: "100-continue",
        "content-length": Buffer.byteLength(body),
      },
    });
    const result = new Promise<number | undefined>((resolve, reject) => {
      req.on("response", (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
    });
    req.once("continue", receiving);
    req.flushHeaders();
    await ready;
    await f.pair();
    req.end(body);
    assert.equal(await result, 401);
    assert.deepEqual(f.owner.management.store.listRuns(), []);
  });

  it("expires unused pairing codes and browser sessions at their admission deadlines", async (t) => {
    let now = Date.now();
    t.mock.method(Date, "now", () => now);
    const f = await fixture(t);
    const expired = await f.code();
    now += 5 * 60_000;
    assert.equal((await f.post("/ui/pair", { code: expired.code })).status, 401);
    await f.pair();
    now += 12 * 60 * 60_000 - 1;
    assert.equal((await f.post("/ui/api", { op: "session" })).status, 200);
    now += 1;
    assert.equal((await f.post("/ui/api", { op: "session" })).status, 401);
  });

  it("previews without writes, saves immutable selections and creates only ready snapshots", async (t) => {
    const f = await fixture(t);
    await f.pair();
    const preview = await f.post("/ui/api", { op: "preview", ...f.selection });
    assert.equal(preview.status, 200);
    assert.deepEqual(
      ((await preview.json()) as { runnable: { title: string }[] }).runnable.map(
        (task) => task.title,
      ),
      ["parent", "child"],
    );
    assert.deepEqual(f.owner.management.store.listRuns(), []);
    assert.deepEqual(f.owner.management.store.listRevisions(), []);
    const included = await f.post("/ui/api", {
      op: "preview",
      ...f.selection,
      includeCompleted: true,
    });
    assert.equal(((await included.json()) as { runnableCount: number }).runnableCount, 3);
    const saved = await f.post("/ui/api", { op: "save", ...f.selection, instructions: [] });
    assert.equal(saved.status, 200);
    const { revisionId } = (await saved.json()) as { revisionId: number };
    assert.deepEqual(f.owner.management.store.listRuns(), []);
    assert.deepEqual(
      parseWorkflowText(f.owner.management.store.getRevision(revisionId).definitionYaml).document
        ?.project.instructions,
      [],
    );
    // Creation must reread, not promote the old preview.
    writeFileSync(path.join(f.root, "tasks.md"), "- [ ] changed after preview\n");
    const created = await f.post("/ui/api", {
      op: "create",
      ...f.selection,
      source: { revisionId },
      instructions: [],
    });
    assert.equal(created.status, 200);
    const { runId } = (await created.json()) as { runId: string };
    const state = f.owner.management.service.coordinator.inspect(runId);
    assert.equal(state.run.status, "ready");
    assert.equal(state.run.startTime, null);
    assert.deepEqual(state.attempts, []);
    assert.deepEqual(
      state.tasks.map((task) => task.title),
      ["changed after preview"],
    );
    writeFileSync(path.join(f.root, "tasks.md"), "- [ ] later change\n");
    assert.deepEqual(
      f.owner.management.service.coordinator.tasks(runId).map((task) => task.title),
      ["changed after preview"],
    );
    assert.equal(state.run.revisionId, revisionId);
  });

  it("validates selected inputs and refuses non-allowlisted controls, raw file access and malformed/oversized bodies", async (t) => {
    const f = await fixture(t);
    await f.pair();
    for (const changes of [
      { projectRoot: "relative" },
      { instructions: ["missing.md"] },
      { taskPath: "missing.md" },
      { projectRoot: path.join(f.root, "absent") },
      { taskPath: null },
    ]) {
      const response = await f.post("/ui/api", { op: "create", ...f.selection, ...changes });
      assert.equal(response.status, 422);
    }
    for (const input of [
      { op: "start", runId: "anything", expectedEventId: 1, extra: true },
      { op: "revise", runId: "anything", expectedEventId: 1 },
      { op: "recovery-decide", runId: "anything" },
      { op: "override", runId: "anything", expectedEventId: 1 },
      { op: "read-file", path: "/etc/passwd" },
      { op: "runs", extra: true },
      { op: "load", source: { workflowText: "version: 1\nversion: 1", workflowDir: f.root } },
    ])
      assert.equal((await f.post("/ui/api", input)).status, 422);
    assert.equal(
      (await f.post("/ui/api", { op: "load", source: { revisionId: 999 } })).status,
      400,
    );
    assert.equal((await fetch(`${f.url}/ui/../../etc/passwd`)).status, 404);
    assert.equal((await f.post("/ui/api", { padding: "x".repeat(2 * 1024 * 1024) })).status, 413);
    const malformed = await fetch(`${f.url}/ui/api`, {
      method: "POST",
      headers: {
        origin: f.url,
        "content-type": "application/json",
        "x-workflowz-ui": "1",
        cookie:
          (await f.post("/ui/pair", { code: (await f.code()).code })).headers
            .get("set-cookie")
            ?.split(";")[0] ?? "",
      },
      body: "{",
    });
    assert.equal(malformed.status, 422);
    assert.deepEqual(f.owner.management.store.listRuns(), []);
  });

  it("supports graph-only workflows and never starts work on browser reconnect", async (t) => {
    const f = await fixture(t);
    await f.pair();
    const input = {
      ...f.selection,
      taskPath: null,
      source: {
        workflowText:
          "version: 1\nname: One off\nproject: {root: .}\nstart: done\nsteps: {done: {kind: end}}\n",
        workflowDir: f.root,
      },
    };
    assert.equal(await (await f.post("/ui/api", { op: "preview", ...input })).json(), null);
    const created = await f.post("/ui/api", { op: "create", ...input });
    const { runId } = (await created.json()) as { runId: string };
    await f.pair();
    assert.equal((await f.post("/ui/api", { op: "session" })).status, 200);
    assert.equal(f.owner.management.store.getRun(runId).status, "ready");
    assert.deepEqual(f.owner.management.store.listAttempts(runId), []);
  });

  it("retains invalid drafts with located diagnostics and never promotes them to revisions or runs", async (t) => {
    const f = await fixture(t);
    await f.pair();
    for (const text of [
      "",
      "version: [",
      `${FLOW}\nunknown_field: true\n`,
      FLOW.replace("start: pick", "start: absent"),
      FLOW.replace("{goto: finish}", "{goto: absent}"),
      FLOW.replace("task_ready:", "undeclared:"),
      FLOW.replace("instructions.md", "missing.md"),
      `${FLOW}\npolicies:\n  - match: {all: true}\n    on: {system.error: {pause: true}}\n  - match: {all: true}\n    on: {system.error: {goto: done}}\n`,
    ]) {
      const result = await f.post("/ui/api", {
        op: "draft",
        workflowText: text,
        workflowDir: f.root,
      });
      assert.equal(result.status, 200);
      const draft = (await result.json()) as BrowserDraft;
      assert.equal(draft.valid, false);
      assert.equal(draft.workflowText, text);
      assert.ok(
        draft.diagnostics.some((d) => d.severity === "error"),
        text,
      );
      if (text)
        assert.ok(
          draft.diagnostics.some((d) => d.location),
          text,
        );
      for (const op of ["save", "create"]) {
        const response = await f.post("/ui/api", {
          ...f.selection,
          op,
          source: { workflowText: text, workflowDir: f.root },
        });
        assert.equal(response.status, 422);
      }
    }
    assert.deepEqual(f.owner.management.store.listRevisions(), []);
    assert.deepEqual(f.owner.management.store.listRuns(), []);
  });

  it("exposes canonical precedence, exact system rules, fallback and terminal behavior", async (t) => {
    const f = await fixture(t);
    await f.pair();
    const workflowText = `version: 1
name: Policy editor
project: {root: .}
start: direct
defaults:
  on: {complete: {goto: done}, failed: {pause: true}}
policies:
  - match: {all: true}
    on: {failed: {goto: done}, system.timeout: {retry: {max_attempts: 3, backoff_seconds: 7}}}
  - match: {tags: [worker]}
    on: {failed: {pause: true}}
  - match: {step_ids: [explicit]}
    on: {failed: {goto: direct}}
steps:
  direct: {kind: command, argv: [echo], tags: [worker], on: {failed: {goto: explicit}, system.error: {goto: done}}}
  explicit: {kind: command, argv: [echo], tags: [worker]}
  tagged: {kind: command, argv: [echo], tags: [worker]}
  global: {kind: command, argv: [echo]}
  done: {kind: end}
`;
    const result = await f.post("/ui/api", { op: "draft", workflowText, workflowDir: f.root });
    const draft = (await result.json()) as BrowserDraft;
    assert.equal(draft.valid, true);
    const rule = (step: string, outcome: string) =>
      draft.transitions[step]?.find((r) => r.outcome === outcome);
    for (const [step, level] of [
      ["direct", "step"],
      ["explicit", "step_id_policy"],
      ["tagged", "tag_policy"],
      ["global", "all_policy"],
    ]) {
      assert.equal(rule(step ?? "", "failed")?.source.level, level);
      assert.equal(rule(step ?? "", "complete")?.source.level, "defaults");
    }
    assert.deepEqual(rule("direct", "system.timeout")?.action, {
      kind: "retry",
      maxAttempts: 3,
      backoffSeconds: 7,
    });
    assert.equal(rule("direct", "system.timeout")?.viaSystemError, false);
    assert.deepEqual(rule("direct", "system.report_error")?.action, {
      kind: "goto",
      target: "done",
    });
    assert.equal(rule("direct", "system.report_error")?.viaSystemError, true);
    assert.equal(rule("global", "system.report_error")?.source.level, "built_in_pause");
    assert.deepEqual(draft.transitions.done, []);
    assert.deepEqual(f.owner.management.store.listRevisions(), []);
  });

  it("round-trips visual model fields and freezes prior saved definitions and ready runs", async (t) => {
    const f = await fixture(t);
    await f.pair();
    const initial = await f.post("/ui/api", { op: "draft", ...f.selection.source });
    const first = (await initial.json()) as BrowserDraft;
    assert.ok(first.document);
    const original = await f.post("/ui/api", { op: "save", ...f.selection });
    const { revisionId } = (await original.json()) as { revisionId: number };
    const created = await f.post("/ui/api", { op: "create", ...f.selection });
    const { runId } = (await created.json()) as { runId: string };
    const model = {
      ...first.document,
      name: "Edited revision",
      limits: { max_wall_time_seconds: 60, max_step_executions: 20, agent_idle_timeout_seconds: 9 },
      steps: {
        ...first.document.steps,
        worker: {
          kind: "agent",
          harness: "codex",
          model: "chosen",
          reasoning_effort: "low",
          session: "fresh",
          prompt_file: "instructions.md",
          cwd: "{{project.root}}",
          instructions: ["instructions.md"],
          outcomes: ["complete"],
          context: { include_reports: [] },
          tags: ["worker"],
          timeout_seconds: 12,
          on: { complete: { goto: "done" } },
        },
        command: {
          kind: "command",
          argv: ["echo", "", "two words"],
          env: { VALUE: "verbatim" },
          on: { complete: { goto: "done" }, failed: { pause: true } },
        },
      },
    };
    const result = await f.post("/ui/api", { op: "draft", ...f.selection.source, model });
    const edited = (await result.json()) as BrowserDraft;
    assert.equal(edited.valid, true);
    assert.deepEqual(edited.document, model);
    assert.equal(f.owner.management.store.listRevisions().length, 1);
    const saved = await f.post("/ui/api", {
      op: "save",
      ...f.selection,
      source: { workflowText: edited.workflowText, workflowDir: f.root },
    });
    const next = (await saved.json()) as { revisionId: number };
    assert.notEqual(next.revisionId, revisionId);
    assert.equal(f.owner.management.store.getRevision(revisionId).definitionYaml, FLOW);
    assert.equal(f.owner.management.store.getRun(runId).revisionId, revisionId);
    assert.equal(f.owner.management.store.getRun(runId).status, "ready");
    assert.deepEqual(f.owner.management.store.listAttempts(runId), []);
    const reused = await f.post("/ui/api", {
      op: "save",
      ...f.selection,
      source: { workflowText: edited.workflowText, workflowDir: f.root },
    });
    assert.equal(((await reused.json()) as { revisionId: number }).revisionId, next.revisionId);
  });
  it("controls the owner with stale checks, waits for settlement and counts only accepted task completion", async (t) => {
    const adapter = new ScriptedAgentAdapter([
      { mode: "report-then-delay", extra: "700", outcome: "complete" },
      { mode: "report-then-hang", outcome: "blocked" },
    ]);
    const f = await fixture(t, new Map([["codex", adapter]]));
    await f.pair();
    const workflowText = FLOW.replace("{goto: finish}", "{goto: work}").replace(
      "  finish:",
      "  work:\n    kind: agent\n    harness: codex\n    model: offline-model\n    session: fresh\n    prompt: Work\n    outcomes: [complete, blocked]\n    on:\n      complete: {goto: finish}\n      blocked: {pause: true}\n  finish:",
    );
    const { runId } = (await (
      await f.post("/ui/api", {
        op: "create",
        ...f.selection,
        source: { workflowText, workflowDir: f.root },
      })
    ).json()) as { runId: string };
    const inspect = async () =>
      (await (await f.post("/ui/api", { op: "status", runId })).json()) as BrowserRunStatus;
    const until = async (accept: (state: BrowserRunStatus) => boolean) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const state = await inspect();
        if (accept(state)) return state;
        await delay(10);
      }
      throw new Error("browser run state did not reach expected boundary");
    };
    const ready = await inspect();
    assert.deepEqual(ready.progress, { completed: 0, total: 2 });
    assert.equal(
      (await f.post("/ui/api", { op: "start", runId, expectedEventId: ready.expectedEventId }))
        .status,
      200,
    );
    const reporting = await until((state) => state.latestReport !== null);
    assert.equal(reporting.current?.harness, "codex");
    assert.equal(reporting.current?.model, "offline-model");
    assert.equal(
      reporting.tasks.find((task) => task.taskId === reporting.run.activeTaskId)?.title,
      "parent",
    );
    assert.deepEqual(reporting.progress, { completed: 0, total: 2 });
    assert.equal(reporting.activeAttempt?.status, "running");
    assert.equal(
      (await f.post("/ui/api", { op: "pause", runId, expectedEventId: ready.expectedEventId }))
        .status,
      409,
    );
    assert.equal((await inspect()).run.status, "running");
    assert.equal(
      (await f.post("/ui/api", { op: "pause", runId, expectedEventId: reporting.expectedEventId }))
        .status,
      200,
    );
    const paused = await until((state) => state.run.status === "paused");
    assert.equal(paused.activeAttempt, null);
    assert.equal(paused.run.cursorStepId, "finish");
    assert.deepEqual(paused.progress, { completed: 0, total: 2 });
    assert.equal(f.owner.management.store.listAttempts(runId).length, 1);
    const page1 = (await (
      await f.post("/ui/api", { op: "events", runId, after: 0, limit: 2 })
    ).json()) as BrowserEvents;
    assert.equal(page1.hasMore, true);
    const page2 = (await (
      await f.post("/ui/api", { op: "events", runId, after: page1.nextAfter, limit: 100 })
    ).json()) as BrowserEvents;
    assert.ok(
      page2.events.every((event) => event.eventId > page1.nextAfter && event.runId === runId),
    );
    assert.ok(page2.events.some((event) => event.type === "run_paused"));
    assert.equal(
      (
        await f.post("/ui/api", {
          op: "resume",
          runId,
          expectedEventId: paused.expectedEventId,
          reason: "Continue the task loop",
        })
      ).status,
      200,
    );
    const hanging = await until((state) => state.latestReport?.outcome === "blocked");
    assert.deepEqual(hanging.progress, { completed: 1, total: 2 });
    assert.equal(hanging.run.status, "running");
    const attemptId = hanging.activeAttempt?.attemptId;
    assert.ok(attemptId);
    assert.equal(
      (
        await f.post("/ui/api", {
          op: "stop",
          runId,
          expectedEventId: hanging.expectedEventId,
          reason: "Stop the unsettled fixture",
        })
      ).status,
      200,
    );
    const stopped = await inspect();
    assert.equal(stopped.run.status, "stopped");
    assert.equal(stopped.activeAttempt, null);
    assert.deepEqual(stopped.progress, { completed: 1, total: 2 });
    assert.equal(f.owner.management.store.getAttempt(attemptId)?.status, "interrupted");
    assert.equal(
      ((await (await f.post("/ui/api", { op: "reports", runId })).json()) as unknown[]).length,
      2,
    );
    assert.equal(
      (
        await f.post("/ui/api", {
          op: "resume",
          runId,
          expectedEventId: stopped.expectedEventId,
          reason: "Cannot resume stopped",
        })
      ).status,
      409,
    );
  });

  it("exposes blocked attention and keeps recovery admission out of browser controls", async (t) => {
    const f = await fixture(
      t,
      new Map([["codex", new ScriptedAgentAdapter([{ mode: "report", outcome: "blocked" }])]]),
    );
    await f.pair();
    const workflowText =
      "version: 1\nname: Blocked\nproject: {root: .}\nstart: work\nsteps:\n  work:\n    kind: agent\n    harness: codex\n    session: fresh\n    prompt: Work\n    outcomes: [blocked]\n    on:\n      blocked: {pause: true}\n";
    const runId = f.owner.management.service.createRun({ workflowText, workflowDir: f.root });
    const get = async () =>
      (await (await f.post("/ui/api", { op: "status", runId })).json()) as BrowserRunStatus;
    const ready = await get();
    assert.equal(ready.progress, null);
    assert.equal(
      (
        await f.post(
          "/ui/api",
          { op: "start", runId, expectedEventId: ready.expectedEventId },
          { origin: "http://evil.invalid" },
        )
      ).status,
      403,
    );
    assert.equal((await get()).run.status, "ready");
    assert.equal(
      (await f.post("/ui/api", { op: "start", runId, expectedEventId: ready.expectedEventId }))
        .status,
      200,
    );
    let state = await get();
    const deadline = Date.now() + 5000;
    while (state.run.status !== "paused" && Date.now() < deadline) {
      await delay(10);
      state = await get();
    }
    assert.equal(state.run.status, "paused");
    assert.equal(state.latestReport?.outcome, "blocked");
    assert.ok(state.attention.some((item) => item.attemptId === state.latestReport?.attemptId));
    // Model a committed between-step crash using the existing coordinator/reconciliation seam.
    await delay(20); // Let the completed drive release its admission guard.
    f.owner.management.service.coordinator.resume(runId, "Simulate interrupted admission");
    f.owner.management.service.reconcile(runId);
    const interrupted = await get();
    assert.equal(interrupted.run.status, "interrupted");
    assert.equal(
      (
        await f.post("/ui/api", {
          op: "resume",
          runId,
          expectedEventId: interrupted.expectedEventId,
          reason: "No recovery decision",
        })
      ).status,
      409,
    );
    assert.equal((await get()).run.status, "interrupted");
  });
});
