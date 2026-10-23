import assert from "node:assert/strict";
import { it } from "node:test";
import type { EventRow } from "../types.ts";
import { technicalFailure } from "./failure.ts";
import { buildHistory, type StepItem } from "./history.ts";

function attempt(entries: [EventRow["type"], EventRow["data"]][]): StepItem {
  const events = entries.map(
    ([type, data], index): EventRow => ({
      type,
      data,
      eventId: index + 1,
      runId: "run-failure",
      revisionId: 1,
      attemptId: "attempt-failure",
      timestamp: new Date(index * 1000).toISOString(),
    }),
  );
  return buildHistory(events, [])[0] as StepItem;
}
function failed(stderr: string): StepItem {
  return attempt([
    ["attempt_started", { stepId: "work" }],
    ["invocation_settled", { exitCode: 1, diagnostics: { stderr } }],
    ["attempt_settled", { status: "failed", outcome: "system.process_error" }],
  ]);
}

it("promotes only a fixed bridge diagnostic and leaves surrounding private text in Output", () => {
  const item = failed(
    "private diagnostic\nOpenCode bridge failed (ECONNRESET).\nprivate path/token",
  );
  assert.equal(
    technicalFailure(item, "opencode")?.cause,
    "The OpenCode bridge connection was reset (ECONNRESET).",
  );
  assert.equal(
    item.stderr?.includes("private path/token"),
    true,
    "saved Output evidence is retained",
  );
  for (const text of [
    "private diagnostic",
    "OpenCode bridge failed (PRIVATE_TOKEN).",
    "OpenCode bridge failed (ECONNRESET). private suffix",
    "private prefix OpenCode bridge failed (ECONNRESET).",
  ])
    assert.equal(
      technicalFailure(failed(text), "opencode")?.cause,
      "The process exited with status 1.",
    );
  assert.equal(technicalFailure(item, "codex")?.cause, "The process exited with status 1.");
});

it("keeps normal declared results distinct even when stderr resembles a bridge failure", () => {
  for (const outcome of ["failed", "blocked", "complete"]) {
    const item = failed("OpenCode bridge failed (ECONNRESET).");
    item.outcome = outcome;
    assert.equal(technicalFailure(item, "opencode"), null);
  }
});

it("presents historical provider blame as unconfirmed execution while preserving raw evidence", () => {
  const item = attempt([
    ["attempt_started", { stepId: "work" }],
    ["invocation_settled", { exitCode: 0 }],
    [
      "attempt_settled",
      { status: "failed", outcome: "system.process_error", detail: "the agent provider failed" },
    ],
  ]);
  const failure = technicalFailure(item);
  assert.equal(failure?.detail, "the harness did not confirm successful execution");
  assert.match(failure?.cause ?? "", /harness did not confirm successful execution/);
  assert.equal(item.events.at(-1)?.data.detail, "the agent provider failed");
});

it("explains a failed correction's timeout without carrying over an earlier bridge diagnostic", () => {
  const item = attempt([
    ["attempt_started", { stepId: "work" }],
    [
      "invocation_settled",
      {
        invocation: 0,
        exitCode: 0,
        diagnostics: { stderr: "OpenCode bridge failed (ECONNRESET)." },
      },
    ],
    ["invocation_settled", { invocation: 1, exitCode: null, timedOut: true }],
    ["attempt_settled", { status: "failed", outcome: "system.report_error" }],
  ]);
  assert.equal(technicalFailure(item)?.cause, "The step exceeded its configured time limit.");
  assert.equal(item.stderr, null);
  assert.equal(item.events[1]?.data.diagnostics !== undefined, true);
});

it("keeps timeout precedence visible when a bridge error preceded stalled server shutdown", () => {
  const item = failed("OpenCode bridge failed (ECONNRESET).");
  item.outcome = "system.timeout";
  item.timedOut = true;
  assert.equal(
    technicalFailure(item, "opencode")?.cause,
    "The step exceeded its configured time limit. The OpenCode bridge connection was reset (ECONNRESET).",
  );
});
