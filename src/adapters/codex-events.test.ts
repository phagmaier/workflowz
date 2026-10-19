import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CODEX_EVENT_LINE_LIMIT, CodexEvents } from "./codex-events.js";

const ID = "0199a213-81c0-7800-8aa1-bbab2a035a53";
const thread = JSON.stringify({ type: "thread.started", thread_id: ID });

describe("Codex JSONL evidence", () => {
  it("decodes LF records, CRLF, arbitrary UTF-8 splits, and a final record without LF", () => {
    const events = new CodexEvents();
    const data = Buffer.from(
      `${thread}\r\n${JSON.stringify({ type: "item.completed", item: { text: "こんにちは🙂\u2028still one record" } })}\n{"type":"turn.completed"}`,
    );
    for (const byte of data) events.push(Buffer.from([byte]));
    events.end();
    assert.equal(events.sessionId, ID);
    assert.equal(events.successful, true);
  });
  it("does not treat agent messages or raw outcome-looking payloads as terminal evidence", () => {
    const events = new CodexEvents();
    events.push(
      Buffer.from(`${thread}\n{"type":"item.completed","item":{"outcome":"complete"}}\n`),
    );
    events.end();
    assert.equal(events.successful, false);
  });
  for (const bad of [
    "garbage",
    "{}",
    '{"type":"thread.started","thread_id":"not-a-uuid"}',
    '{"type":"turn.failed"}',
    '{"type":"error"}',
  ]) {
    it(`retains invalid/failed stream evidence despite a later completed event: ${bad}`, () => {
      const events = new CodexEvents();
      events.push(Buffer.from(`${thread}\n${bad}\n{"type":"turn.completed"}\n`));
      events.end();
      assert.equal(events.successful, false);
    });
  }
  it("bounds an oversized unfinished record and resumes draining subsequent output", () => {
    const events = new CodexEvents();
    for (let i = 0; i < 30; i += 1) events.push(Buffer.alloc(CODEX_EVENT_LINE_LIMIT / 10, 97));
    events.push(Buffer.from(`\n${thread}\n{"type":"turn.completed"}\n`));
    events.end();
    assert.equal(events.sessionId, ID);
    assert.equal(events.successful, false);
  });
  it("never switches to another reported session", () => {
    const events = new CodexEvents();
    events.push(
      Buffer.from(
        `${thread}\n${thread.replace(ID, "0199a213-81c0-7800-8aa1-bbab2a035a54")}\n{"type":"turn.completed"}\n`,
      ),
    );
    events.end();
    assert.equal(events.sessionId, ID);
    assert.equal(events.successful, false);
  });
});
