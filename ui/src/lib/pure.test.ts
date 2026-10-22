import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RUN_STATUSES } from "../../../src/contracts/run-state.ts";
import { parseRoute, runHref } from "../route.ts";
import type { BrowserRunStatus, ResolvedTransition, RunStatus } from "../types.ts";
import { duration, humanize } from "./format.ts";
import { layoutMap } from "./map-layout.ts";
import { describeRun, needsAttention, RUN_GROUPS, STATUS } from "./run-copy.ts";

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
    assert.deepEqual(parseRoute(""), { view: "runs" });
    assert.deepEqual(parseRoute("#/runs"), { view: "runs" });
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

describe("status copy", () => {
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

describe("formatting", () => {
  it("formats ids and durations", () => {
    assert.equal(humanize("pick_task"), "Pick task");
    assert.equal(duration(125_000), "2m 05s");
    assert.equal(duration(400), "<1s");
    assert.equal(duration(3_720_000), "1h 02m");
    assert.equal(duration(null), "—");
  });
});
