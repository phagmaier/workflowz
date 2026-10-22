// Drives the compiled engine with the scripted fake agent, so history is built from real events.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type * as Management from "../../../src/app/management-service.ts";
import type * as Database from "../../../src/store/database.ts";
import type * as Scripted from "../../../src/test-support/scripted-agent.ts";
import type { BrowserRunStatus, EventRow, ReportRow } from "../types.ts";
import {
  buildHistory,
  groupHistory,
  type NoteItem,
  redact,
  type StepItem,
  walked,
} from "./history.ts";
import { layoutMap } from "./map-layout.ts";
import { describeRun } from "./run-copy.ts";

const dist = (file: string) => new URL(`../../../dist/${file}`, import.meta.url).href;
const { ManagementService } = (await import(
  dist("app/management-service.js")
)) as typeof Management;
const { WorkflowDatabase } = (await import(dist("store/database.js"))) as typeof Database;
const { ScriptedAgentAdapter } = (await import(
  dist("test-support/scripted-agent.js")
)) as typeof Scripted;

const FLOW = `version: 1
name: History fixture
project: {root: .}
tasks:
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
    prompt: Work on {{task.text}}
    outcomes: [complete, blocked]
    on:
      complete: {goto: finish}
      blocked: {pause: true}
  finish:
    kind: task.complete
    on:
      complete: {goto: pick}
  done: {kind: end, label: All tasks done}
`;

it("shows the latest settled invocation's diagnostics without carrying earlier stderr into a clean correction", () => {
  const event = (eventId: number, type: EventRow["type"], data: EventRow["data"]): EventRow => ({
    eventId,
    type,
    data,
    runId: "run-correction",
    attemptId: "attempt-correction",
    revisionId: 1,
    timestamp: new Date(eventId * 1000).toISOString(),
  });
  const events = [
    event(1, "attempt_started", { stepId: "work" }),
    event(2, "invocation_settled", {
      invocation: 0,
      exitCode: 0,
      timedOut: false,
      diagnostics: { stderr: "Earlier diagnostic", stdoutTruncated: true, stderrTruncated: true },
    }),
    event(3, "invocation_settled", { invocation: 1, exitCode: 0, timedOut: false }),
  ];
  assert.equal((buildHistory(events.slice(0, 2), [])[0] as StepItem).stderr, "Earlier diagnostic");
  const corrected = buildHistory(events, [])[0] as StepItem;
  assert.equal(corrected.stderr, null);
  assert.equal(corrected.exitCode, 0);
  assert.equal(corrected.timedOut, false);
  assert.equal(corrected.stdoutTruncated, false);
  assert.equal(corrected.stderrTruncated, false);
  assert.ok(
    corrected.events.some((entry) => entry.data.diagnostics),
    "earlier evidence is retained",
  );
});

describe("run history from real engine events", { timeout: 30_000 }, () => {
  it("groups by task, records your actions, redacts private paths and draws the path", async (t) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wf-ui-history-"));
    writeFileSync(path.join(root, "tasks.md"), "- [ ] First task\n- [ ] Second task\n");
    const database = new WorkflowDatabase(":memory:");
    const adapter = new ScriptedAgentAdapter([
      { mode: "report", outcome: "blocked" },
      { mode: "report", outcome: "complete" },
    ]);
    const management = new ManagementService(
      database,
      path.join(root, "logs"),
      new Map([["codex", adapter]]),
    );
    t.after(async () => {
      await management.shutdown();
      database.close();
      rmSync(root, { recursive: true, force: true });
    });
    const handle = (request: Parameters<typeof management.handle>[0]) => management.handle(request);
    const status = () => handle({ op: "status", runId }) as Promise<BrowserRunStatus>;
    const until = async (state: string) => {
      const deadline = Date.now() + 15_000;
      for (;;) {
        const current = await status();
        if (current.run.status === state && !current.activeAttempt) return current;
        if (Date.now() > deadline) throw new Error(`run did not reach ${state}`);
        await delay(20);
      }
    };
    const history = async () => {
      const page = (await handle({ op: "events", runId, after: 0, limit: 1000 })) as {
        events: EventRow[];
      };
      const reports = (await handle({ op: "reports", runId })) as ReportRow[];
      return { events: page.events, items: buildHistory(page.events, reports) };
    };

    const { runId } = (await handle({ op: "create", workflowText: FLOW, workflowDir: root })) as {
      runId: string;
    };
    const ready = await status();
    assert.match(describeRun(ready, []).headline, /^Ready to start/);
    await handle({ op: "start", runId, expectedEventId: ready.expectedEventId });
    const paused = await until("paused");

    let { events, items } = await history();
    const work = items.find((i): i is StepItem => i.type === "step" && i.stepId === "work");
    assert.ok(work);
    assert.equal(work.outcome, "blocked");
    assert.equal(work.decision, "pause");
    assert.equal(work.report?.summary, "Fake agent result");
    assert.equal(work.taskId, paused.run.activeTaskId);
    assert.equal(describeRun(paused, items).headline, "Paused — Work needs your decision");
    assert.match(describeRun(paused, items).detail, /Work reported “blocked”: Fake agent result/);
    const pick = items.find((i): i is StepItem => i.type === "step" && i.stepId === "pick");
    assert.equal(pick?.to, "work");
    assert.equal(
      pick?.taskId,
      paused.run.activeTaskId,
      "the pick that activated a task belongs to it",
    );

    // Raw evidence includes the attempt log location, which the browser must never show.
    const logDir = path.join(root, "logs");
    assert.ok(JSON.stringify(events).includes(logDir));
    assert.ok(!JSON.stringify(events.map((e) => redact(e.data))).includes(logDir));

    await handle({
      op: "override",
      runId,
      expectedEventId: paused.expectedEventId,
      edit: { action: "skip", outcome: "complete", reason: "Done by hand" },
    });
    const skipped = await status();
    ({ items } = await history());
    const mine = items.at(-1) as StepItem;
    assert.equal(mine.type, "step");
    assert.equal(mine.byYou, true);
    assert.equal(mine.outcome, "complete");
    assert.equal(mine.to, "finish");
    assert.equal(describeRun(skipped, items).headline, "Paused — next step is Finish");

    await handle({ op: "resume", runId, expectedEventId: skipped.expectedEventId, reason: "go" });
    const completed = await until("completed");
    ({ events, items } = await history());
    assert.equal(describeRun(completed, items).headline, "Completed — All tasks done");

    const groups = groupHistory(items);
    const [first, second] = completed.tasks;
    assert.deepEqual(
      groups.map((g) => g.taskId),
      [null, first?.taskId, second?.taskId, null],
      "run notes, task 1, task 2, then the final pick and finish",
    );
    const resumed = items.find((i): i is NoteItem => i.type === "note" && i.kind === "resumed");
    assert.equal(resumed?.reason, "go");
    const seen = new Set(items.flatMap((i) => i.events.map((e) => e.eventId)));
    assert.deepEqual(
      events.filter((e) => !seen.has(e.eventId)).map((e) => e.type),
      [],
    );
    // Every event lands in exactly one item.
    assert.equal(
      items.reduce((n, i) => n + i.events.length, 0),
      events.length,
    );

    const { counts, edges } = walked(items);
    assert.equal(counts.get("work"), 2, "the skip is not counted as a run");
    assert.equal(counts.get("pick"), 3);
    assert.equal(edges.get("work|complete|finish"), 2);
    assert.equal(edges.get("pick|exhausted|done"), 1);

    const draft = (await import(
      dist("app/browser-service.js")
    )) as typeof import("../../../src/app/browser-service.ts");
    const browser = new draft.BrowserService(management);
    const inspected = (await browser.handle({
      op: "draft",
      workflowText: FLOW,
      workflowDir: root,
    })) as {
      document: { steps: Record<string, { kind: string }>; start: string };
      transitions: Parameters<typeof layoutMap>[0]["transitions"];
    };
    const layout = layoutMap({
      start: inspected.document.start,
      steps: Object.entries(inspected.document.steps).map(([id, s]) => ({
        id,
        kind: s.kind,
        detail: "",
      })),
      transitions: inspected.transitions,
    });
    const byRoute = new Map(layout.edges.map((e) => [`${e.from}>${e.to}`, e]));
    assert.equal(byRoute.get("pick>work")?.side, "straight");
    assert.equal(byRoute.get("pick>done")?.side, "right");
    assert.equal(byRoute.get("finish>pick")?.side, "left");
    assert.deepEqual(layout.ports.get("work"), [{ outcome: "blocked", action: "pause" }]);
    for (const edge of layout.edges)
      for (const key of edge.keys) assert.ok(edges.has(key) || key.startsWith("work|system"), key);
  });
});
