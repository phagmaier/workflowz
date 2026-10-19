import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileOk, workflowText } from "../test-support/workflows.js";
import {
  completeActiveTask,
  routeAttempt,
  routeEngineStep,
  selectNextTask,
  type TaskSnapshot,
} from "./reducer.js";

const TASKS: TaskSnapshot[] = [
  { taskId: "t2", sourceOrder: 2, state: "pending" },
  { taskId: "t0", sourceOrder: 0, state: "completed" },
  { taskId: "t1", sourceOrder: 1, state: "pending" },
];

describe("task selection", () => {
  it("picks the first unfinished task in source order, skipping completed ones", () => {
    assert.deepEqual(selectNextTask(TASKS, null), { outcome: "task_ready", taskId: "t1" });
  });

  it("reports exhaustion when every task is completed", () => {
    const done = TASKS.map((task) => ({ ...task, state: "completed" as const }));
    assert.deepEqual(selectNextTask(done, null), { outcome: "exhausted" });
  });

  it("never skips an active task silently; asking for another is a state error", () => {
    assert.deepEqual(selectNextTask(TASKS, "t1"), { outcome: "system.task_state_error" });
  });

  it("completes the active task, and treats completing with no active task as a state error", () => {
    assert.deepEqual(completeActiveTask("t1"), { outcome: "complete", taskId: "t1" });
    assert.deepEqual(completeActiveTask(null), { outcome: "system.task_state_error" });
  });
});

describe("attempt routing", () => {
  const workflow = compileOk(
    workflowText(
      `tasks:\n  source:\n    kind: markdown_checklist\n    path: todo.md\ndefaults:\n  on:\n    system.retry_exhausted: { goto: done }\nstart: build\nsteps:\n  build:\n    kind: command\n    argv: [echo]\n    on:\n      complete: { goto: done }\n      failed: { retry: { max_attempts: 3 } }\n  pick:\n    kind: task.next\n    on:\n      task_ready: { goto: done }\n      exhausted: { goto: done }\n      system.task_state_error: { retry: { max_attempts: 2 } }\n  done:\n    kind: end\n`,
    ),
  );

  it("follows a goto", () => {
    assert.equal(routeAttempt(workflow, "build", "complete", 1).kind, "goto");
  });

  it("retries while attempts remain, and routes system.retry_exhausted once they run out", () => {
    assert.equal(routeAttempt(workflow, "build", "failed", 1).kind, "retry");
    assert.equal(routeAttempt(workflow, "build", "failed", 2).kind, "retry");
    const exhausted = routeAttempt(workflow, "build", "failed", 3);
    assert.equal(exhausted.kind, "goto");
    assert.equal(exhausted.kind === "goto" ? exhausted.stepId : "", "done");
  });

  it("does not retry an engine-only step; it pauses and says why", () => {
    const decision = routeEngineStep(workflow, "pick", "system.task_state_error");
    assert.equal(decision.kind, "pause");
    assert.equal(
      decision.kind === "pause" ? decision.reason : "",
      "retry_unsupported_for_engine_step",
    );
  });

  it("pauses when retries run out and nothing routes system.retry_exhausted", () => {
    const bare = compileOk(
      workflowText(
        "start: build\nsteps:\n  build:\n    kind: command\n    argv: [echo]\n    on:\n      complete: { goto: done }\n      failed: { retry: { max_attempts: 2 } }\n  done:\n    kind: end\n",
      ),
    );
    const decision = routeAttempt(bare, "build", "failed", 2);
    assert.equal(decision.kind, "pause");
    assert.equal(decision.kind === "pause" ? decision.reason : "", "retry_exhausted");
  });
});
