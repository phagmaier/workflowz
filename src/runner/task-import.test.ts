import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { WorkflowDatabase } from "../store/database.js";
import { ScriptedAgentAdapter } from "../test-support/scripted-agent.js";
import { workflowText } from "../test-support/workflows.js";
import { RunService } from "./run-service.js";

const FLOW = workflowText(`tasks:
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
    prompt: "Implement {{task.text}}"
    outcomes: [complete]
    on:
      complete: { goto: finish }
  finish:
    kind: task.complete
    on:
      complete: { goto: pick }
  done:
    kind: end
`);

async function fixture(
  work: (f: {
    root: string;
    database: WorkflowDatabase;
    service: RunService;
    file: string;
  }) => Promise<void>,
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-import-"));
  const file = path.join(root, "state.sqlite");
  const database = new WorkflowDatabase(file);
  try {
    const service = new RunService(database, {
      agents: new Map([["codex", new ScriptedAgentAdapter([])]]),
      logDir: path.join(root, "logs"),
    });
    await work({ root, database, service, file });
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
}

describe("immutable Markdown import through the headless runner", () => {
  it("previews, snapshots and finishes a nested ordered checklist without writing it back", async () =>
    fixture(async (f) => {
      const source = "# Work\n- [x] prechecked\n- [ ] parent\n    - [ ] child\n- [ ] last\n";
      const taskFile = path.join(f.root, "tasks.md");
      writeFileSync(taskFile, source);
      const input = { workflowText: FLOW, workflowDir: f.root };
      assert.equal(f.service.previewTasks(input)?.runnableCount, 3);
      const runId = f.service.createRun(input);
      const before = f.service.coordinator.inspect(runId);
      assert.deepEqual(
        before.tasks.map((t) => [t.title, t.state, t.sourceChecked]),
        [
          ["parent", "pending", false],
          ["child", "pending", false],
          ["last", "pending", false],
        ],
      );
      assert.equal(before.taskImport?.markdown, source);
      assert.equal(before.taskImport?.sourceSha256.length, 64);
      assert.deepEqual(
        before.tasks.map((t) => t.sourceLine),
        [3, 4, 5],
      );
      writeFileSync(taskFile, "- [ ] external edit after import\n");
      f.service.coordinator.start(runId);
      await f.service.drive(runId);
      const after = f.service.coordinator.inspect(runId);
      assert.equal(after.run.status, "completed");
      assert.deepEqual(
        after.tasks.map((t) => t.taskId),
        before.tasks.map((t) => t.taskId),
      );
      assert.ok(after.tasks.every((t) => t.state === "completed"));
      assert.equal(after.attempts.length, 3);
      assert.deepEqual(
        after.attempts.map((a) => a.taskId),
        after.tasks.map((t) => t.taskId),
      );
      assert.equal(readFileSync(taskFile, "utf8"), "- [ ] external edit after import\n");
      const observer = new WorkflowDatabase(f.file);
      try {
        const reopened = new RunService(observer, {
          agents: new Map(),
          logDir: path.join(f.root, "logs"),
        });
        assert.deepEqual(reopened.coordinator.inspect(runId), after);
      } finally {
        observer.close();
      }
    }));

  it("can explicitly queue prechecked items and handles an empty runnable checklist", async () =>
    fixture(async (f) => {
      writeFileSync(path.join(f.root, "tasks.md"), "- [x] done\n");
      const input = { workflowText: FLOW, workflowDir: f.root };
      const emptyRun = f.service.createRun(input);
      f.service.coordinator.start(emptyRun);
      await f.service.drive(emptyRun);
      assert.equal(f.service.coordinator.inspect(emptyRun).tasks.length, 0);
      assert.equal(f.service.coordinator.inspect(emptyRun).run.status, "completed");
      const included = f.service.createRun({ ...input, includeCompleted: true });
      assert.equal(f.service.coordinator.tasks(included)[0]?.sourceChecked, true);
      assert.equal(f.service.coordinator.tasks(included)[0]?.state, "pending");
    }));

  it("a missing checklist fails before a run is created, and preview does not mutate the database", async () =>
    fixture(async (f) => {
      const input = { workflowText: FLOW, workflowDir: f.root };
      assert.throws(() => f.service.createRun(input), /cannot import task checklist.*ENOENT/);
      assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM runs").get()?.["n"], 0);
      writeFileSync(path.join(f.root, "tasks.md"), "- [ ] one\n");
      assert.equal(f.service.previewTasks(input)?.total, 1);
      assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM runs").get()?.["n"], 0);
    }));

  it("task records, immutable source and import event commit or roll back together", async () =>
    fixture(async (f) => {
      writeFileSync(path.join(f.root, "tasks.md"), "- [ ] one\n");
      f.database
        .prepare(
          "CREATE TRIGGER fail_import BEFORE INSERT ON events WHEN NEW.type = 'tasks_imported' BEGIN SELECT RAISE(ABORT, 'import event failure'); END",
        )
        .run();
      assert.throws(
        () => f.service.createRun({ workflowText: FLOW, workflowDir: f.root }),
        /import event failure/,
      );
      for (const table of ["runs", "tasks", "task_imports", "events", "workflow_revisions"]) {
        assert.equal(f.database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.["n"], 0);
      }
    }));
});
