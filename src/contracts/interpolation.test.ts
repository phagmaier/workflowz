import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scanPlaceholders } from "./interpolation.js";

describe("scanPlaceholders", () => {
  it("returns no placeholders for plain text", () => {
    assert.deepEqual(scanPlaceholders("no braces here"), []);
  });

  it("parses each whitelisted reference", () => {
    const refs = scanPlaceholders(
      "{{task.id}} {{task.text}} {{task.index}} {{project.root}} {{run.id}} {{run.cwd}} {{reports.review.summary}} {{reports.review.issue}} {{reports.review.handoff}} {{steps.commit.stdout}}",
    ).map((placeholder) => placeholder.ref);
    assert.deepEqual(refs, [
      { kind: "task", field: "id" },
      { kind: "task", field: "text" },
      { kind: "task", field: "index" },
      { kind: "project", field: "root" },
      { kind: "run", field: "id" },
      { kind: "run", field: "cwd" },
      { kind: "report", step: "review", field: "summary" },
      { kind: "report", step: "review", field: "issue" },
      { kind: "report", step: "review", field: "handoff" },
      { kind: "command_output", step: "commit", field: "stdout" },
    ]);
  });

  it("tolerates whitespace inside the braces", () => {
    assert.deepEqual(scanPlaceholders("{{ task.id }}")[0]?.ref, { kind: "task", field: "id" });
  });

  it("rejects unknown fields and references instead of producing empty strings", () => {
    for (const text of [
      "{{task.bogus}}",
      "{{env.HOME}}",
      "{{reports.review.body}}",
      "{{reports.Bad-Step.summary}}",
      "{{steps.commit.stderr}}",
      "{{task}}",
    ]) {
      assert.equal(scanPlaceholders(text)[0]?.error?.code, "unknown_placeholder", text);
    }
  });

  it("rejects empty and unterminated placeholders", () => {
    assert.equal(scanPlaceholders("{{}}")[0]?.error?.code, "invalid_template");
    assert.equal(scanPlaceholders("{{task.id")[0]?.error?.code, "invalid_template");
    assert.equal(scanPlaceholders("oops }}")[0]?.error?.code, "invalid_template");
  });

  it("does not evaluate expressions or nested braces", () => {
    assert.equal(scanPlaceholders("{{ task.id + 1 }}")[0]?.error?.code, "unknown_placeholder");
    assert.equal(scanPlaceholders("{{{task.id}}}")[0]?.error?.code, "invalid_template");
  });
});
