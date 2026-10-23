import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RUN_STATUSES } from "../../../src/contracts/run-state.ts";
import { parseRoute, runHref, runsHref } from "../route.ts";
import type { BrowserRunStatus, EventRow, ResolvedTransition, RunStatus } from "../types.ts";
import { duration, humanize } from "./format.ts";
import { buildHistory, type StepItem } from "./history.ts";
import { layoutMap } from "./map-layout.ts";
import {
  attemptActivity,
  describeRun,
  feedbackCurrent,
  needsAttention,
  pausedMs,
  RUN_GROUPS,
  STATUS,
  statusTime,
  taskPhase,
} from "./run-copy.ts";

const goto = (outcome: string, target: string, level = "step"): ResolvedTransition =>
  ({
    outcome,
    action: { kind: "goto", target },
    source: { level },
    viaSystemError: false,
  }) as ResolvedTransition;

function status(state: RunStatus, extra: Partial<BrowserRunStatus["run"]> = {}): BrowserRunStatus {
  return {
    run: {
      runId: "run_1",
      revisionId: 3,
      projectRoot: "/p",
      status: state,
      cursorStepId: "review",
      activeTaskId: null,
      createdAt: "2026-10-20T10:00:00.000Z",
      updatedAt: "2026-10-20T10:00:00.000Z",
      startTime: "2026-10-20T10:00:00.000Z",
      endTime: null,
      retryNotBefore: null,
      ...extra,
    },
    expectedEventId: 9,
    activeAttempt: null,
    current: { kind: "agent", harness: "opencode", model: "opencode/deepseek-v4.1-flash-free" },
    configuredPermissions: [],
    elapsedMs: 125_000,
    progress: null,
    tasks: [],
    latestReport: null,
    attention: [],
    driveFailure: null,
  };
}

describe("hash routes", () => {
  it("parses run views and rejects unknown paths", () => {
    assert.deepEqual(parseRoute(""), { view: "runs", group: null });
    assert.deepEqual(parseRoute(runsHref()), { view: "runs", group: null });
    assert.deepEqual(parseRoute("#/workflows"), { view: "workflows" });
    assert.deepEqual(parseRoute(runHref("run a/b")), {
      view: "run",
      runId: "run a/b",
      tab: "details",
    });
    assert.deepEqual(parseRoute(runHref("r1", "map")), { view: "run", runId: "r1", tab: "map" });
    assert.equal(parseRoute("#/runs/r1/raw").view, "missing");
    assert.equal(parseRoute("#/settings").view, "missing");
  });

  it("links each Runs group without taking a run ID and rejects unknown groups", () => {
    for (const group of RUN_GROUPS) {
      assert.deepEqual(parseRoute(runsHref(group.id)), { view: "runs", group: group.id });
      assert.deepEqual(parseRoute(runHref(group.id)), {
        view: "run",
        runId: group.id,
        tab: "details",
      });
    }
    assert.equal(parseRoute("#/runs?group=unknown").view, "missing");
    assert.deepEqual(parseRoute(runHref("r?group=ready")), {
      view: "run",
      runId: "r?group=ready",
      tab: "details",
    });
  });
});

describe("map layout", () => {
  it("draws the next step straight, skips on the right, loops on the left in nested lanes", () => {
    const steps = ["a", "b", "c", "d"].map((id) => ({ id, kind: "command", detail: "" }));
    const layout = layoutMap({
      start: "a",
      steps,
      transitions: {
        a: [goto("complete", "b"), goto("failed", "d"), goto("system.error", "d")],
        b: [goto("complete", "c"), goto("failed", "a", "tag_policy")],
        c: [goto("complete", "d"), goto("failed", "a")],
        d: [],
      },
    });
    const edge = (from: string, to: string) =>
      layout.edges.find((e) => e.from === from && e.to === to);
    assert.equal(edge("a", "b")?.side, "straight");
    assert.equal(edge("a", "d")?.side, "right");
    assert.equal(edge("a", "d")?.label, "failed, technical failure");
    assert.deepEqual(edge("a", "d")?.keys, ["a|failed|d", "a|system|d"]);
    assert.equal(edge("b", "a")?.shared, true);
    // The shorter loop takes the inner lane, so lanes never cross.
    assert.equal(edge("b", "a")?.lane, 0);
    assert.equal(edge("c", "a")?.lane, 1);
    for (const e of layout.edges) assert.ok(e.labelX >= 0 && e.labelX <= layout.width, e.label);
  });
});

describe("control feedback", () => {
  it("keeps a success message only while the run is where the message describes", () => {
    const at = (status: RunStatus, cursor: string) => ({ status, cursor });
    // Start: shown while the first step starts and runs, gone once a later step runs.
    assert.equal(feedbackCurrent(at("ready", "build"), at("ready", "build")), true);
    assert.equal(feedbackCurrent(at("ready", "build"), at("running", "build")), true);
    assert.equal(feedbackCurrent(at("ready", "build"), at("running", "test")), false);
    // Pause: shown while pausing after the step, gone once paused.
    assert.equal(feedbackCurrent(at("running", "build"), at("pausing", "build")), true);
    assert.equal(feedbackCurrent(at("running", "build"), at("paused", "build")), false);
    assert.equal(feedbackCurrent(at("running", "build"), at("paused", "test")), false);
    // Resume: the resumed step runs again or next; a later step or pause makes it history.
    assert.equal(feedbackCurrent(at("paused", "build"), at("running", "build")), true);
    assert.equal(feedbackCurrent(at("paused", "pick"), at("running", "integrate")), false);
    assert.equal(feedbackCurrent(at("paused", "build"), at("paused", "build")), true);
    assert.equal(feedbackCurrent(at("paused", "build"), at("interrupted", "build")), false);
    // Apply keeps the run paused even when it moves the next step.
    assert.equal(feedbackCurrent(at("paused", "build"), at("paused", "deploy")), true);
    // A stopped or completed run keeps its final result.
    assert.equal(feedbackCurrent(at("running", "build"), at("stopped", "build")), true);
    assert.equal(feedbackCurrent(at("paused", "build"), at("completed", "done")), true);
  });
});

describe("status copy", () => {
  it("describes a transport failure as technical and keeps its safe cause beside the headline", () => {
    const entries: [EventRow["type"], EventRow["data"]][] = [
      ["attempt_started", { stepId: "review" }],
      [
        "invocation_settled",
        {
          exitCode: 1,
          diagnostics: { stderr: "OpenCode bridge failed (ECONNRESET)." },
        },
      ],
      ["attempt_settled", { status: "failed", outcome: "system.process_error" }],
      [
        "transition_committed",
        {
          from: "review",
          outcome: "system.process_error",
          decision: "pause",
          reason: "outcome_pause",
        },
      ],
      ["run_paused", { reason: "outcome_pause" }],
    ];
    const events: EventRow[] = entries.map(([type, data], index) => ({
      eventId: index + 1,
      runId: "run_1",
      revisionId: 3,
      attemptId: type === "run_paused" ? null : "attempt_1",
      timestamp: new Date(index * 1000).toISOString(),
      type,
      data,
    }));
    const copy = describeRun(status("paused"), buildHistory(events, []));
    assert.match(copy.detail, /technical failure/i);
    assert.match(copy.detail, /ECONNRESET/);
    assert.doesNotMatch(copy.detail, /reported/);
  });

  it("has a headline for every status and counts attention", () => {
    for (const state of Object.keys(STATUS) as RunStatus[]) {
      const copy = describeRun(status(state), []);
      assert.ok(copy.headline.length > 0 && copy.detail.length > 0, state);
    }
    assert.equal(describeRun(status("running"), []).headline, "Running — Review");
    assert.match(describeRun(status("running"), []).detail, /OpenCode \(opencode\/deepseek/);
    assert.match(describeRun(status("stopped"), []).detail, /not rolled back/);
    assert.match(describeRun(status("interrupted"), []).detail, /never reruns/);
    assert.deepEqual((Object.keys(STATUS) as RunStatus[]).filter(needsAttention), [
      "paused",
      "interrupted",
    ]);
    const retry = status("running", { retryNotBefore: "2999-01-01T00:00:00.000Z" });
    assert.match(describeRun(retry, []).headline, /waiting to retry Review/);
  });

  it("puts every status in exactly one sidebar group, attention first", () => {
    const grouped = RUN_GROUPS.flatMap((group) => group.statuses);
    assert.deepEqual([...grouped].sort(), [...RUN_STATUSES].sort());
    assert.equal(new Set(grouped).size, grouped.length);
    assert.deepEqual(RUN_GROUPS[0]?.statuses.filter(needsAttention), RUN_GROUPS[0]?.statuses);
  });
});

const at = (second: number) => new Date(Date.UTC(2026, 9, 20, 10, 0, second)).toISOString();
const events = (entries: [number, EventRow["type"], EventRow["data"]][], attempt = "attempt_1") =>
  entries.map(
    ([second, type, data], index): EventRow => ({
      eventId: index + 1,
      runId: "run_1",
      revisionId: 3,
      attemptId: type.startsWith("run_") ? null : attempt,
      timestamp: at(second),
      type,
      data,
    }),
  );
const tasks = (...states: ("pending" | "active" | "completed")[]) =>
  states.map((state, index) => ({
    taskId: `task_${index + 1}`,
    runId: "run_1",
    sourceOrder: index,
    sourceIdentity: `t${index}`,
    title: `Task ${index + 1}`,
    body: "",
    headingPath: [],
    state,
    sourceLine: null,
    sourceColumn: null,
    sourceChecked: null,
    sourceIndent: null,
  }));
const withTasks = (
  state: RunStatus,
  list: ReturnType<typeof tasks>,
  activeTaskId: string | null = null,
): BrowserRunStatus => ({
  ...status(state, { activeTaskId }),
  tasks: list,
  progress: {
    completed: list.filter((t) => t.state === "completed").length,
    total: list.length,
  },
});

describe("progress and timing", () => {
  it("separates the task phase from whether the run has finished", () => {
    assert.deepEqual(taskPhase(status("running")), { label: "No task list", note: null });
    assert.equal(taskPhase(withTasks("running", [])).label, "No tasks imported");
    assert.equal(
      taskPhase(withTasks("ready", tasks("pending", "pending"))).label,
      "None started yet",
    );
    assert.equal(
      taskPhase(withTasks("running", tasks("pending", "pending"))).label,
      "None started yet",
    );
    assert.equal(
      taskPhase(withTasks("running", tasks("completed", "active"), "task_2")).label,
      "2 of 2 · Task 2",
    );
    assert.equal(
      taskPhase(withTasks("paused", tasks("completed", "pending"))).label,
      "1 of 2 done · none active",
    );
    for (const state of ["running", "pausing", "paused", "interrupted"] as const)
      assert.deepEqual(taskPhase(withTasks(state, tasks("completed", "completed"))), {
        label: "All 2 done",
        note: "Run not finished yet",
      });
    assert.deepEqual(taskPhase(withTasks("completed", tasks("completed", "completed"))), {
      label: "All 2 done",
      note: null,
    });
    assert.equal(
      taskPhase(withTasks("stopped", tasks("pending", "pending"))).label,
      "0 of 2 done · none active",
    );
  });

  it("says when all tasks are done but the workflow continues, and how long it paused", () => {
    const running = describeRun(withTasks("running", tasks("completed", "completed")), []);
    assert.match(
      running.detail,
      /All 2 imported tasks are done; the workflow continues with Review\./,
    );
    const one = describeRun(withTasks("running", tasks("completed")), []);
    assert.match(one.detail, /The imported task is done; the workflow continues with Review\./);
    const active = withTasks("running", tasks("completed", "active"), "task_2");
    assert.doesNotMatch(describeRun(active, []).detail, /continues with/);

    const history = buildHistory(
      events([
        [0, "run_started", {}],
        [10, "run_paused", { reason: "user_pause" }],
        [70, "run_resumed", {}],
        [125, "run_completed", {}],
      ]),
      [],
    );
    const completed = withTasks("completed", tasks("completed", "completed"));
    completed.run = { ...completed.run, endTime: at(125) };
    assert.equal(
      describeRun(completed, history).detail,
      "Finished in 2m 05s, including 1m 00s paused. 2 of 2 tasks done.",
    );
    assert.equal(
      describeRun(completed, buildHistory(events([[0, "run_started", {}]]), [])).detail,
      "Finished in 2m 05s. 2 of 2 tasks done.",
    );
  });

  it("counts only recorded pauses, up to a resume, a stop or the status read", () => {
    const history = buildHistory(
      events([
        [0, "run_started", {}],
        [10, "run_paused", { reason: "user_pause" }],
        [40, "run_resumed", {}],
        [50, "run_paused", { reason: "outcome_pause" }],
        [80, "run_stopped", { reason: "enough" }],
      ]),
      [],
    );
    assert.equal(pausedMs(history, at(80)), 60_000);
    assert.equal(pausedMs(history.slice(0, 4), at(65)), 45_000, "an ongoing pause counts to now");
    assert.equal(pausedMs(history.slice(0, 1), at(65)), 0);
    assert.equal(pausedMs(history.slice(0, 2), null), 0, "no clock, no guess");
    // The read's clock comes from the daemon: its start plus elapsed, or the recorded end.
    assert.equal(statusTime(status("paused")), at(125));
    assert.equal(statusTime(status("stopped", { endTime: at(80) })), at(80));
    assert.equal(statusTime(status("ready", { startTime: null })), null);
  });

  it("names the attempt's last recorded stage without claiming provider activity", () => {
    const stages = (
      kind: string | undefined,
      entries: [number, EventRow["type"], EventRow["data"]][],
    ) =>
      entries.map((_, index) => {
        const item = buildHistory(events(entries.slice(0, index + 1)), [])[0] as StepItem;
        return attemptActivity(item, kind);
      });
    assert.deepEqual(
      stages("agent", [
        [0, "attempt_started", { stepId: "review" }],
        [1, "attempt_prepared", {}],
        [1, "invocation_dispatching", { invocation: 0 }],
        [2, "invocation_started", { invocation: 0 }],
        [300, "invocation_settled", { invocation: 0, exitCode: 0 }],
        [300, "correction_requested", { invocation: 1 }],
        [301, "invocation_dispatching", { invocation: 1 }],
        [302, "invocation_started", { invocation: 1 }],
        [320, "report_accepted", { reportId: 1, outcome: "complete" }],
        [325, "invocation_settled", { invocation: 1, exitCode: 0 }],
      ]),
      [
        "Preparing",
        "Preparing",
        "Starting the agent",
        "Agent running",
        "Process finished; recording the result",
        "Asking the agent for its missing report",
        "Asking the agent for its missing report",
        "Asking the agent for its missing report",
        "Report received; waiting for the agent to exit",
        "Process finished; recording the result",
      ],
    );
    assert.deepEqual(
      stages("command", [
        [0, "attempt_started", { stepId: "check" }],
        [1, "invocation_dispatching", { invocation: 0 }],
        [2, "invocation_started", { invocation: 0 }],
      ]),
      ["Preparing", "Starting the command", "Command running"],
    );
  });
});

describe("formatting", () => {
  it("formats ids and durations", () => {
    assert.equal(humanize("pick_task"), "Pick task");
    assert.equal(duration(125_000), "2m 05s");
    assert.equal(duration(400), "<1s");
    assert.equal(duration(3_720_000), "1h 02m");
    assert.equal(duration(null), "—");
  });
});
