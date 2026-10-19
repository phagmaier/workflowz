import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InterpolationError, type InterpolationValues, interpolate } from "./interpolate.js";

const values: InterpolationValues = {
  task: { id: "run_1.t0", text: "write tests", index: 1 },
  projectRoot: "/work/project",
  runId: "run_1",
  runCwd: "/work/project",
  commandStdout: (stepId) => (stepId === "announce" ? "announced\n" : undefined),
  report: () => undefined,
};

describe("interpolate", () => {
  it("substitutes task, project, run, and command output values", () => {
    assert.equal(
      interpolate(
        "{{task.id}} {{task.text}} #{{task.index}} in {{project.root}} ({{run.id}}, {{run.cwd}})",
        values,
      ),
      "run_1.t0 write tests #1 in /work/project (run_1, /work/project)",
    );
    assert.equal(interpolate("[{{steps.announce.stdout}}]", values), "[announced\n]");
  });

  it("leaves text without placeholders unchanged", () => {
    assert.equal(interpolate("plain text", values), "plain text");
  });

  it("errors when a value is not available, rather than substituting an empty string", () => {
    assert.throws(() => interpolate("{{steps.build.stdout}}", values), InterpolationError);
    assert.throws(() => interpolate("{{reports.review.summary}}", values), /no value/);
    const noTask = { ...values, task: undefined };
    assert.throws(() => interpolate("{{task.id}}", noTask), InterpolationError);
  });

  it("rejects unknown and malformed placeholders", () => {
    assert.throws(() => interpolate("{{task.bogus}}", values), InterpolationError);
    assert.throws(() => interpolate("{{{task.id}}}", values), InterpolationError);
  });
});
