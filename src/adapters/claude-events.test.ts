import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLAUDE_EVENT_LINE_LIMIT, ClaudeEvents } from "./claude-events.js";

const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const init = { type: "system", subtype: "init", session_id: id };
const result = {
  type: "result",
  subtype: "success",
  is_error: false,
  session_id: id,
  result: "done",
};
function parse(values: unknown[], suffix = "\n") {
  const events = new ClaudeEvents();
  events.push(Buffer.from(values.map((v) => JSON.stringify(v)).join("\n") + suffix));
  events.end();
  return events;
}

describe("Claude stream-json framing and terminal evidence", () => {
  it("decodes LF/CRLF and byte-split UTF-8 without splitting Unicode separators", () => {
    const events = new ClaudeEvents();
    const text =
      [init, { type: "assistant", message: { text: "🙂こんにちは\u2028\u2029" } }, result]
        .map((v) => JSON.stringify(v))
        .join("\r\n") + "\r\n";
    for (const byte of Buffer.from(text)) events.push(Buffer.from([byte]));
    events.end();
    assert.equal(events.successful, true);
    assert.equal(events.sessionId, id);
  });
  it("allows startup events before init, retries and unknown future events before result", () => {
    assert.equal(
      parse([
        { type: "system", subtype: "hook_started" },
        init,
        { type: "system", subtype: "api_retry" },
        { type: "future" },
        result,
      ]).successful,
      true,
    );
  });
  it("can capture identity from result alone, including errors without init", () => {
    assert.equal(parse([result]).sessionId, id);
    const missing = parse([
      {
        ...result,
        subtype: "error_during_execution",
        is_error: true,
        errors: [`No conversation found with session ID: ${id}`],
      },
    ]);
    assert.equal(missing.successful, false);
    assert.equal(missing.resumeUnavailable, true);
  });
  it("does not confuse other provider errors with unavailable resume", () => {
    assert.equal(
      parse([
        { ...result, subtype: "error_during_execution", is_error: true, errors: ["rate limit"] },
      ]).resumeUnavailable,
      false,
    );
  });
  it("missing session evidence cannot authorize correction", () => {
    const events = parse([{ type: "result", subtype: "success", is_error: false }]);
    assert.equal(events.successful, true);
    assert.equal(events.sessionId, undefined);
  });
  for (const [name, values] of [
    ["assistant alone", [init, { type: "assistant", message: { stop_reason: "end_turn" } }]],
    ["is_error on success", [init, { ...result, is_error: true }]],
    ["missing error status", [init, { ...result, is_error: undefined }]],
    ["execution failure", [{ ...result, subtype: "error_during_execution", is_error: true }]],
    ["turn limit", [{ ...result, subtype: "error_max_turns", is_error: true }]],
    ["budget limit", [{ ...result, subtype: "error_max_budget_usd", is_error: true }]],
    [
      "structured output retry exhaustion",
      [{ ...result, subtype: "error_max_structured_output_retries", is_error: true }],
    ],
    ["unknown result subtype", [{ ...result, subtype: "future" }]],
    ["invalid UUID", [{ ...result, session_id: "latest" }]],
    ["mismatched init/result", [init, { ...result, session_id: other }]],
    ["duplicate init", [init, init, result]],
    ["duplicate result", [result, result]],
    ["events after result", [result, { type: "assistant" }]],
    ["root error", [{ type: "error" }, result]],
    ["non-event JSON", [[], result]],
  ] as const)
    it(`rejects ${name}`, () => assert.equal(parse([...values]).successful, false));
  it("rejects malformed, oversized and unterminated records even with a valid terminal result", () => {
    for (const text of ["invalid\n", `${"x".repeat(CLAUDE_EVENT_LINE_LIMIT + 1)}\n`, "[]\n"]) {
      const events = new ClaudeEvents();
      events.push(Buffer.from(text + JSON.stringify(result) + "\n"));
      events.end();
      assert.equal(events.successful, false);
    }
    assert.equal(parse([result], "").successful, false);
    const events = new ClaudeEvents();
    events.push(Buffer.from(JSON.stringify(result) + "\n{"));
    events.end();
    assert.equal(events.successful, false);
  });
});
