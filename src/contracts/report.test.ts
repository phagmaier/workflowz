import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReportRejected, validateReport } from "./report.js";

const valid = {
  outcome: "complete",
  summary: "done",
  issue: null,
  handoff: "details",
  data: { nested: [1, true, null] },
};
describe("bounded report v1", () => {
  it("accepts only declared outcomes and preserves bounded structured content", () => {
    assert.deepEqual(validateReport(valid, ["complete"]), valid);
  });
  for (const [name, body] of Object.entries({
    missing: { outcome: "complete" },
    empty: { outcome: "complete", summary: " \n" },
    reserved: { ...valid, outcome: "system.timeout" },
    undeclared: { ...valid, outcome: "blocked" },
    authoritative_id: { ...valid, attempt_id: "other" },
    transition: { ...valid, goto: "done" },
    summary: { ...valid, summary: "x".repeat(4097) },
    unicode: { ...valid, summary: "🍋".repeat(1025) },
    issue: { ...valid, issue: "x".repeat(4097) },
    handoff: { ...valid, handoff: "x".repeat(65537) },
    data_size: { ...valid, data: { text: "x".repeat(32768) } },
    data_array: { ...valid, data: [] },
    non_json: { ...valid, data: { bad: undefined } },
    non_finite: { ...valid, data: { bad: Number.NaN } },
    depth: {
      ...valid,
      data: { nested: Array.from({ length: 20 }).reduce<unknown>((v) => ({ v }), null) },
    },
    nodes: { ...valid, data: { many: Array(4097).fill(null) } },
  })) {
    it(`rejects ${name} without echoing untrusted contents`, () => {
      assert.throws(
        () => validateReport(body, ["complete"]),
        (error: unknown) =>
          error instanceof ReportRejected &&
          error.status === 422 &&
          /Allowed outcomes: complete/.test(error.message),
      );
    });
  }
  it("rejects silently discarded data keys", () => {
    const body: unknown = JSON.parse(
      '{"outcome":"complete","summary":"done","data":{"__proto__":{"x":1}}}',
    );
    assert.throws(() => validateReport(body, ["complete"]), ReportRejected);
  });
  it("rejects cycles and class instances", () => {
    const cycle: Record<string, unknown> = {};
    cycle["self"] = cycle;
    assert.throws(() => validateReport({ ...valid, data: cycle }, ["complete"]), ReportRejected);
    assert.throws(
      () => validateReport({ ...valid, data: { date: new Date() } }, ["complete"]),
      ReportRejected,
    );
  });
});
