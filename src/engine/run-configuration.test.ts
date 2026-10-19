import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { taskOverrideEditSchema, workflowRevisionSchema } from "../contracts/run-configuration.js";
import { WorkflowDatabase } from "../store/database.js";
import { RunStore } from "../store/run-store.js";
import { RunCoordinator } from "./run-coordinator.js";

const FLOW = `version: 1
name: Config fixture
project: { root: . }
tasks:
  source: { kind: markdown_checklist, path: tasks.md }
start: pick
limits: { max_step_executions: 100 }
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
    prompt: 'Work {{task.text}}'
    outcomes: [complete, blocked]
    on:
      complete: { goto: check }
      blocked: { pause: true }
  check:
    kind: command
    argv: [echo, ok]
    on:
      complete: { goto: finish }
      failed: { pause: true }
  finish:
    kind: task.complete
    on:
      complete: { goto: pick }
  done:
    kind: end
`;
const TASKS = [0, 1, 2].map((sourceOrder) => ({
  sourceOrder,
  sourceIdentity: `tasks.md:${sourceOrder + 1}`,
  title: `task ${sourceOrder}`,
}));

function fixture(t: TestContext, text = FLOW) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-config-"));
  const file = path.join(root, "state.sqlite");
  const database = new WorkflowDatabase(file);
  t.after(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  const coordinator = new RunCoordinator(database);
  const runId = coordinator.createRun({ workflowText: text, workflowDir: root, tasks: TASKS });
  const tasks = coordinator.tasks(runId);
  const first = tasks[0]?.taskId;
  assert.ok(first);
  return { root, file, database, coordinator, runId, first, tasks };
}
function dispatch(c: RunCoordinator, id: string) {
  const result = c.advance(id);
  assert.equal(result.kind, "attempt");
  if (result.kind !== "attempt") throw new Error("no attempt");
  return result.attemptId;
}
function pauseAtWork(f: ReturnType<typeof fixture>) {
  f.coordinator.start(f.runId);
  const attemptId = dispatch(f.coordinator, f.runId);
  f.coordinator.settle(attemptId, { kind: "outcome", outcome: "blocked" });
  return attemptId;
}
const edit = (overrides: unknown) => ({ overrides, reason: "task-specific choice" });
const revision = (workflowText: string, cursorStepId?: string) => ({
  workflowText,
  reason: "revise remaining work",
  ...(cursorStepId === undefined ? {} : { cursorStepId }),
});

describe("strict run configuration contracts", () => {
  it("accepts only model, prompt, declared skip selection and transition parameters", () => {
    assert.ok(
      taskOverrideEditSchema.safeParse(
        edit({
          steps: {
            work: {
              model: "custom",
              prompt: "new",
              skip: { outcome: "complete" },
              on: { complete: { goto: "finish" } },
            },
          },
        }),
      ).success,
    );
    for (const overrides of [
      { steps: { work: { harness: "pi" } } },
      { steps: { work: { session: "fresh" } } },
      { steps: { work: { outcomes: ["other"] } } },
      { steps: { work: { prompt_file: "x" } } },
      { steps: { work: { skip: true } } },
      { steps: { work: { skip: { outcome: "system.error" } } } },
      { steps: { work: { on: { complete: { goto: "done", pause: true } } } } },
      { steps: { work: { model: "" } } },
      JSON.parse('{"steps":{"__proto__":{}}}'),
      JSON.parse('{"steps":{"work":{"on":{"__proto__":{"pause":true}}}}}'),
    ])
      assert.equal(
        taskOverrideEditSchema.safeParse(edit(overrides)).success,
        false,
        JSON.stringify(overrides),
      );
    assert.equal(
      workflowRevisionSchema.safeParse({ ...revision(FLOW), unexpected: true }).success,
      false,
    );
    assert.equal(
      workflowRevisionSchema.safeParse({ workflowText: FLOW, reason: " " }).success,
      false,
    );
  });
});

describe("per-task settings and deterministic skips", () => {
  it("inline prompt overrides replace prompt_file, and clearing settings restores the original", (t) => {
    const f = fixture(t, FLOW.replace("prompt: 'Work {{task.text}}'", "prompt_file: original.md"));
    f.coordinator.setTaskOverrides(
      f.runId,
      f.first,
      edit({ steps: { work: { prompt: "inline" } } }),
    );
    f.coordinator.start(f.runId);
    const id = dispatch(f.coordinator, f.runId);
    const attempt = f.coordinator.activeAttempt(f.runId);
    assert.ok(attempt);
    const overridden = f.coordinator.workflowForAttempt(attempt).steps.get("work")?.spec;
    assert.equal(overridden?.kind === "agent" ? overridden.prompt_file : "wrong kind", undefined);
    f.coordinator.settle(id, { kind: "outcome", outcome: "blocked" });
    f.coordinator.setTaskOverrides(f.runId, f.first, edit({ steps: {} }));
    assert.equal(
      f.coordinator.workflowForAttempt(attempt).steps.get("work")?.spec.kind,
      "agent",
      "past effective settings still compile",
    );
    f.coordinator.resume(f.runId);
    dispatch(f.coordinator, f.runId);
    const next = f.coordinator.activeAttempt(f.runId);
    assert.ok(next);
    const restored = f.coordinator.workflowForAttempt(next).steps.get("work")?.spec;
    assert.equal(restored?.kind === "agent" ? restored.prompt_file : undefined, "original.md");
  });

  it("routes selected system overrides and keeps observed failures separate from retry exhaustion", (t) => {
    const f = fixture(t);
    f.coordinator.setTaskOverrides(
      f.runId,
      f.first,
      edit({
        steps: {
          work: {
            on: {
              "system.spawn_error": { retry: { max_attempts: 2 } },
              "system.retry_exhausted": { goto: "finish" },
            },
          },
        },
      }),
    );
    f.coordinator.start(f.runId);
    for (let i = 0; i < 2; i += 1) {
      f.coordinator.settle(dispatch(f.coordinator, f.runId), {
        kind: "system",
        code: "system.spawn_error",
      });
    }
    const state = f.coordinator.inspect(f.runId);
    assert.equal(state.run.cursorStepId, "finish");
    assert.deepEqual(
      state.attempts.map((row) => row.errorCode),
      ["system.spawn_error", "system.spawn_error"],
    );
    assert.equal(state.transitions.at(-1)?.outcome, "system.retry_exhausted");
    assert.deepEqual(
      state.events
        .filter((event) => event.type === "attempt_settled")
        .map((event) => event.data.outcome),
      ["system.spawn_error", "system.spawn_error"],
    );
  });

  it("specializes one task, keeps YAML reusable, and freezes settings on dispatch", (t) => {
    const f = fixture(t);
    const originalRevision = f.coordinator.run(f.runId).revisionId;
    f.coordinator.setTaskOverrides(
      f.runId,
      f.first,
      edit({
        steps: {
          work: {
            model: "task-model",
            prompt: "Special {{task.text}}",
            on: { complete: { goto: "finish" } },
          },
        },
      }),
    );
    f.coordinator.start(f.runId);
    const id = dispatch(f.coordinator, f.runId);
    const attempt = f.coordinator.activeAttempt(f.runId);
    assert.ok(attempt);
    const step = f.coordinator.workflowForAttempt(attempt).steps.get("work")?.spec;
    assert.equal(step?.kind === "agent" ? step.model : undefined, "task-model");
    assert.equal(attempt.revisionId, originalRevision);
    assert.equal(
      new RunStore(f.database, () => "t").getRevision(originalRevision).definitionYaml,
      FLOW,
    );
    f.coordinator.settle(id, { kind: "outcome", outcome: "complete" });
    dispatch(f.coordinator, f.runId);
    const next = f.coordinator.activeAttempt(f.runId);
    assert.ok(next);
    assert.equal(next.taskId, f.tasks[1]?.taskId);
    assert.deepEqual(next.taskOverrides, { steps: {} });
    assert.equal(f.coordinator.workflowForAttempt(next).steps.get("work")?.spec.kind, "agent");
    assert.equal(f.coordinator.tasks(f.runId)[0]?.state, "completed");
  });

  it("skips only the configured task's step, audits it, and leaves task completion to the graph", (t) => {
    const f = fixture(t);
    f.coordinator.setTaskOverrides(
      f.runId,
      f.first,
      edit({
        steps: { work: { skip: { outcome: "complete" }, on: { complete: { goto: "finish" } } } },
      }),
    );
    f.coordinator.start(f.runId);
    dispatch(f.coordinator, f.runId);
    const state = f.coordinator.inspect(f.runId);
    assert.equal(state.attempts.length, 1);
    assert.equal(state.attempts[0]?.taskId, f.tasks[1]?.taskId);
    assert.equal(state.tasks[0]?.state, "completed");
    assert.equal(state.transitions.find((row) => row.fromStepId === "work")?.attemptId, null);
    assert.equal(state.events.filter((e) => e.type === "step_skipped").length, 1);
  });

  it("a skipped blocking outcome pauses with task still active and no report/attempt", (t) => {
    const f = fixture(t);
    f.coordinator.setTaskOverrides(
      f.runId,
      f.first,
      edit({ steps: { work: { skip: { outcome: "blocked" } } } }),
    );
    f.coordinator.start(f.runId);
    assert.deepEqual(f.coordinator.advance(f.runId), { kind: "not_running", status: "paused" });
    assert.equal(f.coordinator.inspect(f.runId).attempts.length, 0);
    assert.equal(f.coordinator.tasks(f.runId)[0]?.state, "active");
    f.coordinator.setTaskOverrides(f.runId, f.first, edit({ steps: {} }));
    f.coordinator.resume(f.runId);
    dispatch(f.coordinator, f.runId);
  });

  it("bounds skip cycles, and does not retry an unexecuted step", (t) => {
    const f = fixture(t);
    const c = new RunCoordinator(f.database, { maxEngineStepsPerAdvance: 3 });
    c.setTaskOverrides(
      f.runId,
      f.first,
      edit({
        steps: { work: { skip: { outcome: "complete" }, on: { complete: { goto: "work" } } } },
      }),
    );
    c.start(f.runId);
    c.advance(f.runId);
    assert.equal(c.inspect(f.runId).attention.at(-1)?.category, "engine_loop");
    c.setTaskOverrides(
      f.runId,
      f.first,
      edit({
        steps: {
          work: { skip: { outcome: "complete" }, on: { complete: { retry: { max_attempts: 2 } } } },
        },
      }),
    );
    c.resume(f.runId);
    c.advance(f.runId);
    assert.equal(
      c.inspect(f.runId).attention.at(-1)?.category,
      "retry_unsupported_for_engine_step",
    );
  });

  it("validates executable kinds, outcomes, references, placeholders and model capability before mutation", (t) => {
    const f = fixture(t);
    const before = f.coordinator.inspect(f.runId);
    for (const steps of [
      { missing: { prompt: "hello" } },
      { pick: { on: { task_ready: { goto: "done" } } } },
      { done: { skip: { outcome: "complete" } } },
      { check: { model: "wrong" } },
      { work: { skip: { outcome: "typo" } } },
      { work: { on: { complete: { goto: "missing" } } } },
      { work: { on: { undeclared: { pause: true } } } },
      { work: { on: { "system.typo": { pause: true } } } },
      { work: { model: "{{task.id}}" } },
      { work: { prompt: "{{unsupported}}" } },
      { work: { prompt: "{{reports.check.summary}}" } },
    ])
      assert.throws(
        () => f.coordinator.setTaskOverrides(f.runId, f.first, edit({ steps })),
        Error,
        JSON.stringify(steps),
      );
    assert.deepEqual(f.coordinator.inspect(f.runId), before);
    assert.throws(
      () => f.coordinator.setTaskOverrides(f.runId, "foreign", edit({ steps: {} })),
      /unfinished/,
    );
  });

  it("restricts edits to ready/paused with no active attempt and unfinished owned tasks", (t) => {
    const f = fixture(t);
    f.coordinator.start(f.runId);
    const apply = () => f.coordinator.setTaskOverrides(f.runId, f.first, edit({ steps: {} }));
    assert.throws(apply, /ready or paused/);
    const id = dispatch(f.coordinator, f.runId);
    assert.throws(apply, /ready or paused/);
    f.coordinator.requestPause(f.runId);
    assert.throws(apply, /ready or paused/);
    f.coordinator.settle(id, { kind: "outcome", outcome: "blocked" });
    f.coordinator.markTaskComplete(f.runId, f.first, "manual completion");
    assert.throws(apply, /unfinished/);
    f.coordinator.recordStop(f.runId, "stop");
    assert.throws(apply, /ready or paused/);
  });

  it("applies manual skip using the effective per-task route", (t) => {
    const f = fixture(t);
    pauseAtWork(f);
    f.coordinator.setTaskOverrides(
      f.runId,
      f.first,
      edit({ steps: { work: { on: { complete: { goto: "finish" } } } } }),
    );
    f.coordinator.skipCurrentStep(f.runId, "complete", "take task route");
    assert.equal(f.coordinator.run(f.runId).cursorStepId, "finish");
  });
});

describe("paused and pre-start immutable workflow revisions", () => {
  it("preserves completed progress, history and old revision association across SQLite reopen", (t) => {
    const f = fixture(t);
    f.coordinator.start(f.runId);
    const firstWork = dispatch(f.coordinator, f.runId);
    const input = {
      cwd: f.root,
      prompt: "old input",
      context: { instructions: [], reports: {} },
      allowedOutcomes: ["complete", "blocked"],
    };
    f.coordinator.recordInput(firstWork, input);
    const report = f.coordinator.acceptReport(firstWork, {
      outcome: "complete",
      summary: "old report",
    });
    f.coordinator.settle(firstWork, { kind: "outcome", outcome: "complete" });
    f.coordinator.settle(dispatch(f.coordinator, f.runId), {
      kind: "outcome",
      outcome: "complete",
    });
    const secondWork = dispatch(f.coordinator, f.runId);
    f.coordinator.recordInvocation(secondWork, 0, "started", {
      pid: null,
      sessionId: "persisted-old-session",
    });
    f.coordinator.settle(secondWork, { kind: "outcome", outcome: "blocked" });
    const before = f.coordinator.inspect(f.runId);
    const revisionId = f.coordinator.reviseWorkflow(
      f.runId,
      revision(
        FLOW.replace("session: fresh", "session: resume").replace(
          "Work {{task.text}}",
          "Revised {{task.text}}",
        ),
      ),
    );
    assert.notEqual(revisionId, before.run.revisionId);
    assert.deepEqual(f.coordinator.inspect(f.runId).tasks, before.tasks);
    assert.deepEqual(f.coordinator.inspect(f.runId).attempts, before.attempts);
    assert.deepEqual(f.coordinator.inspect(f.runId).transitions, before.transitions);
    assert.deepEqual(f.coordinator.attemptInput(firstWork), input);
    assert.deepEqual(f.coordinator.reportFor(firstWork), report);
    const db = new WorkflowDatabase(f.file);
    try {
      const c = new RunCoordinator(db);
      assert.equal(c.run(f.runId).revisionId, revisionId);
      assert.equal(
        new RunStore(db, () => "t").getRevision(before.run.revisionId).definitionYaml,
        FLOW,
      );
      assert.deepEqual(c.attemptInput(firstWork), input);
      assert.deepEqual(c.reportFor(firstWork), report);
      c.resume(f.runId);
      dispatch(c, f.runId);
      const active = c.activeAttempt(f.runId);
      assert.ok(active);
      assert.equal(active.revisionId, revisionId);
      assert.equal(
        c.priorSession(active),
        undefined,
        "old revision session is deliberately invalidated",
      );
    } finally {
      db.close();
    }
  });

  it("preserves same-revision session scope through parameter edits", (t) => {
    const f = fixture(t, FLOW.replace("session: fresh", "session: resume"));
    f.coordinator.start(f.runId);
    const first = dispatch(f.coordinator, f.runId);
    f.coordinator.recordInvocation(first, 0, "started", {
      pid: null,
      sessionId: "same-revision-session",
    });
    f.coordinator.settle(first, { kind: "outcome", outcome: "blocked" });
    f.coordinator.setTaskOverrides(
      f.runId,
      f.first,
      edit({ steps: { work: { prompt: "follow up", model: "new-model" } } }),
    );
    f.coordinator.resume(f.runId);
    dispatch(f.coordinator, f.runId);
    const next = f.coordinator.activeAttempt(f.runId);
    assert.ok(next);
    assert.equal(f.coordinator.priorSession(next), "same-revision-session");
  });

  it("requires an explicit compatible cursor after removal or kind changes", (t) => {
    const f = fixture(t);
    pauseAtWork(f);
    const renamed = FLOW.replaceAll("work", "implement");
    const before = f.coordinator.inspect(f.runId);
    assert.throws(
      () => f.coordinator.reviseWorkflow(f.runId, revision(renamed)),
      /explicit valid cursor/,
    );
    assert.throws(
      () => f.coordinator.reviseWorkflow(f.runId, revision(renamed, "absent")),
      /explicit valid cursor/,
    );
    assert.throws(
      () => f.coordinator.reviseWorkflow(f.runId, revision(renamed, "pick")),
      /incompatible/,
    );
    assert.deepEqual(f.coordinator.inspect(f.runId), before);
    f.coordinator.reviseWorkflow(f.runId, revision(renamed, "implement"));
    assert.equal(f.coordinator.run(f.runId).cursorStepId, "implement");
    const command = renamed
      .replace(
        /kind: agent\n {4}harness: codex\n {4}session: fresh\n {4}prompt: 'Work {{task.text}}'\n {4}outcomes: \[complete, blocked\]/,
        "kind: command\n    argv: [echo, revised]",
      )
      .replace("      blocked: { pause: true }", "      failed: { pause: true }");
    assert.throws(() => f.coordinator.reviseWorkflow(f.runId, revision(command)), /changes cursor/);
    f.coordinator.reviseWorkflow(f.runId, revision(command, "implement"));
  });

  it("validates task compatibility even for an explicit cursor", (t) => {
    const f = fixture(t);
    assert.throws(
      () => f.coordinator.reviseWorkflow(f.runId, revision(FLOW, "finish")),
      /incompatible/,
    );
    assert.throws(
      () => f.coordinator.reviseWorkflow(f.runId, revision(FLOW, "work")),
      /requires an active task/,
    );
    f.coordinator.reviseWorkflow(
      f.runId,
      revision(FLOW.replace("name: Config fixture", "name: Pre-start")),
    );
    assert.equal(f.coordinator.run(f.runId).status, "ready");
  });

  it("validates pending overrides against revisions and preserves completed settings as history", (t) => {
    const f = fixture(t);
    f.coordinator.setTaskOverrides(f.runId, f.first, edit({ steps: { work: { model: "old" } } }));
    const renamed = FLOW.replaceAll("work", "implement");
    assert.throws(
      () => f.coordinator.reviseWorkflow(f.runId, revision(renamed)),
      /existing agent or command/,
    );
    pauseAtWork(f);
    f.coordinator.markTaskComplete(f.runId, f.first, "done manually");
    f.coordinator.reviseWorkflow(f.runId, revision(renamed, "pick"));
    assert.equal(f.coordinator.taskOverrides(f.runId, f.first).steps["work"]?.model, "old");
  });

  it("rejects invalid definitions, source changes, and edits while running/pausing/interrupted", (t) => {
    const f = fixture(t);
    for (const text of [
      "nonsense",
      FLOW.replace("root: .", "root: elsewhere"),
      FLOW.replace("path: tasks.md", "path: other.md"),
    ])
      assert.throws(() => f.coordinator.reviseWorkflow(f.runId, revision(text)));
    f.coordinator.start(f.runId);
    assert.throws(() => f.coordinator.reviseWorkflow(f.runId, revision(FLOW)), /ready or paused/);
    dispatch(f.coordinator, f.runId);
    f.coordinator.requestPause(f.runId);
    assert.throws(() => f.coordinator.reviseWorkflow(f.runId, revision(FLOW)), /ready or paused/);
    f.coordinator.reconcileAfterRestart(f.runId);
    assert.throws(() => f.coordinator.reviseWorkflow(f.runId, revision(FLOW)), /ready or paused/);
  });

  for (const type of ["task_overrides_changed", "workflow_revised"] as const) {
    it(`${type} rolls back all writes if the audit event fails, even inside a caught nested transaction`, (t) => {
      const f = fixture(t);
      const before = f.coordinator.inspect(f.runId);
      f.database
        .prepare(
          `CREATE TRIGGER fail_edit BEFORE INSERT ON events WHEN NEW.type = '${type}' BEGIN SELECT RAISE(ABORT, 'audit failed'); END`,
        )
        .run();
      assert.throws(
        () =>
          f.database.transaction(() => {
            try {
              if (type === "task_overrides_changed")
                f.coordinator.setTaskOverrides(
                  f.runId,
                  f.first,
                  edit({ steps: { work: { model: "new" } } }),
                );
              else
                f.coordinator.reviseWorkflow(
                  f.runId,
                  revision(FLOW.replace("Config fixture", "Changed")),
                );
            } catch {
              /* outer transaction must still fail */
            }
          }),
        /audit failed/,
      );
      assert.deepEqual(f.coordinator.inspect(f.runId), before);
      assert.deepEqual(f.coordinator.taskOverrides(f.runId, f.first), { steps: {} });
      assert.equal(
        (f.database.prepare("SELECT COUNT(*) AS n FROM workflow_revisions").get() as { n: number })
          .n,
        1,
      );
      f.database.prepare("DROP TRIGGER fail_edit").run();
      // A rolled-back revision id/cache entry cannot poison a later, different definition.
      f.coordinator.reviseWorkflow(
        f.runId,
        revision(FLOW.replace("Config fixture", "After rollback")),
      );
      assert.equal(f.coordinator.workflowFor(f.runId).name, "After rollback");
    });
  }
});
