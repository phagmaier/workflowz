import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { WorkflowDatabase } from "../store/database.js";
import { ScriptedAgentAdapter } from "../test-support/scripted-agent.js";
import { RunService } from "./run-service.js";

const FLOW = `version: 1
name: Context fixture
project:
  root: .
  instructions: [global.md]
tasks:
  source:
    kind: markdown_checklist
    path: tasks.md
start: pick
steps:
  pick:
    kind: task.next
    on:
      task_ready: { goto: work }
      exhausted: { goto: done }
  work:
    kind: agent
    harness: codex
    session: fresh
    prompt: "Work {{task.text}}"
    context:
      include_reports: [review]
    outcomes: [complete]
    on:
      complete: { goto: private }
  private:
    kind: agent
    harness: codex
    session: fresh
    prompt: private context
    outcomes: [complete]
    on:
      complete: { goto: review }
  review:
    kind: agent
    harness: codex
    session: fresh
    instructions: [review.md]
    prompt_file: prompt.md
    context:
      include_reports: [work]
    outcomes: [complete]
    on:
      complete: { goto: finish }
  finish:
    kind: task.complete
    on:
      complete: { goto: pick }
  done:
    kind: end
`;

async function fixture(
  work: (f: { root: string; database: WorkflowDatabase; service: RunService }) => Promise<void>,
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-context-"));
  const database = new WorkflowDatabase(path.join(root, "state.sqlite"));
  try {
    writeFileSync(path.join(root, "global.md"), "Global guidance with literal {{braces}}");
    writeFileSync(path.join(root, "review.md"), "Review guidance");
    writeFileSync(path.join(root, "prompt.md"), "Review {{task.text}}: {{reports.work.summary}}");
    writeFileSync(
      path.join(root, "tasks.md"),
      "# Work\n- [ ] one\n  first body\n- [ ] two\n  second body\n",
    );
    const service = new RunService(database, {
      agents: new Map([["codex", new ScriptedAgentAdapter([])]]),
      logDir: path.join(root, "logs"),
    });
    await work({ root, database, service });
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
}

describe("explicit agent context and immutable attempt inputs", () => {
  it("assembles ordered instruction content, full task context and only selected same-task reports", async () =>
    fixture(async (f) => {
      const runId = f.service.createRun({ workflowText: FLOW, workflowDir: f.root });
      f.service.coordinator.start(runId);
      await f.service.drive(runId);
      const state = f.service.coordinator.inspect(runId);
      assert.equal(state.run.status, "completed");
      const [firstWork, , firstReview, secondWork, , secondReview] = state.attempts;
      assert.ok(firstWork && firstReview && secondWork && secondReview);
      const work = f.service.coordinator.attemptInput(firstWork.attemptId);
      const review = f.service.coordinator.attemptInput(firstReview.attemptId);
      const nextWork = f.service.coordinator.attemptInput(secondWork.attemptId);
      const nextReview = f.service.coordinator.attemptInput(secondReview.attemptId);
      assert.ok(work && review && nextWork && nextReview);
      assert.deepEqual(work.context.task?.headingPath, ["Work"]);
      assert.equal(work.context.task?.body, "  first body");
      assert.equal(nextWork.context.task?.body, "  second body");
      assert.deepEqual(Object.keys(work.context.reports), []);
      assert.deepEqual(
        Object.keys(nextWork.context.reports),
        [],
        "does not reuse the previous task's review",
      );
      assert.deepEqual(Object.keys(review.context.reports), ["work"]);
      assert.deepEqual(Object.keys(nextReview.context.reports), ["work"]);
      assert.deepEqual(
        review.context.instructions.map((instruction) => instruction.content),
        ["Global guidance with literal {{braces}}", "Review guidance"],
      );
      assert.match(review.prompt, /Review one: Fake agent result/);
      assert.match(nextReview.prompt, /Review two: Fake agent result/);
      assert.match(review.prompt, /first body/);
      assert.equal(JSON.stringify(review).includes("WF_REPORT_TOKEN"), false);
      writeFileSync(path.join(f.root, "global.md"), "later change");
      assert.equal(
        f.service.coordinator.attemptInput(firstReview.attemptId)?.context.instructions[0]?.content,
        "Global guidance with literal {{braces}}",
      );
      const observer = new WorkflowDatabase(path.join(f.root, "state.sqlite"));
      try {
        const reopened = new RunService(observer, {
          agents: new Map(),
          logDir: path.join(f.root, "logs"),
        });
        assert.deepEqual(reopened.coordinator.attemptInput(firstReview.attemptId), review);
      } finally {
        observer.close();
      }
    }));

  it("a missing instruction or explicit report value fails before that process launches", async () =>
    fixture(async (f) => {
      for (const [name, text] of [
        ["instruction", FLOW.replace("instructions: [global.md]", "instructions: [missing.md]")],
        [
          "report",
          FLOW.replace('prompt: "Work {{task.text}}"', 'prompt: "Work {{reports.review.summary}}"'),
        ],
      ] as const) {
        const runId = f.service.createRun({ workflowText: text, workflowDir: f.root });
        f.service.coordinator.start(runId);
        await f.service.drive(runId);
        const state = f.service.coordinator.inspect(runId);
        assert.equal(state.run.status, "paused", name);
        assert.equal(state.transitions.at(-1)?.outcome, "system.internal_error");
        assert.equal(state.events.filter((e) => e.type === "invocation_started").length, 0);
        f.service.coordinator.recordStop(runId, "finish failure test");
      }
    }));

  it("input snapshots and attempt_prepared events are atomic, and cannot be overwritten", async () =>
    fixture(async (f) => {
      const runId = f.service.createRun({ workflowText: FLOW, workflowDir: f.root });
      f.service.coordinator.start(runId);
      f.database
        .prepare(
          "CREATE TRIGGER fail_input_event BEFORE INSERT ON events WHEN NEW.type = 'attempt_prepared' BEGIN SELECT RAISE(ABORT, 'input event failure'); END",
        )
        .run();
      await assert.rejects(f.service.drive(runId), /input event failure/);
      const state = f.service.coordinator.inspect(runId);
      assert.ok(state.activeAttempt);
      assert.equal(f.service.coordinator.attemptInput(state.activeAttempt.attemptId), undefined);
      assert.equal(state.events.filter((e) => e.type === "invocation_started").length, 0);
      f.database.prepare("DROP TRIGGER fail_input_event").run();
      const snapshot = {
        cwd: f.root,
        prompt: "saved",
        context: { instructions: [], reports: {} },
        allowedOutcomes: ["complete"],
      };
      f.service.coordinator.recordInput(state.activeAttempt.attemptId, snapshot);
      assert.throws(
        () =>
          f.service.coordinator.recordInput(state.activeAttempt?.attemptId ?? "", {
            ...snapshot,
            prompt: "changed",
          }),
        /UNIQUE/,
      );
      assert.deepEqual(f.service.coordinator.attemptInput(state.activeAttempt.attemptId), snapshot);
    }));
});
