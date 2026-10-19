import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PI_EVENT_LINE_LIMIT, PiEvents } from "./pi-events.js";

const header = {
  type: "session",
  version: 3,
  id: "0199a213-81c0-7800-8aa1-bbab2a035a53",
  cwd: "/project",
  timestamp: "2026-10-19T01:00:00.000Z",
};
const settled = { type: "agent_settled", aborted: false };
const message = (stopReason: string) => ({ role: "assistant", stopReason });
function push(events: PiEvents, ...values: unknown[]) {
  events.push(Buffer.from(values.map((v) => JSON.stringify(v)).join("\n") + "\n"));
}

describe("Pi LF JSONL evidence", () => {
  it("decodes CRLF and byte-split UTF-8 without splitting Unicode separators", () => {
    const events = new PiEvents();
    const data = Buffer.from(
      [
        header,
        {
          type: "message_end",
          message: { ...message("stop"), content: "こんにちは🙂\u2028\u2029" },
        },
        { type: "future_event" },
        settled,
      ]
        .map((v) => JSON.stringify(v))
        .join("\r\n") + "\r\n",
    );
    for (const byte of data) events.push(Buffer.from([byte]));
    events.end();
    assert.deepEqual(events.session, header);
    assert.equal(events.successful, true);
  });
  it("waits past agent_end, failures, retries, and compaction recovery for final settlement", () => {
    const events = new PiEvents();
    push(
      events,
      header,
      { type: "message_end", message: message("error") },
      { type: "agent_end", messages: [message("error")], willRetry: true },
    );
    assert.equal(events.successful, false);
    push(
      events,
      { type: "auto_retry_start" },
      { type: "agent_start" },
      { type: "compaction_start" },
      { type: "compaction_end", aborted: false, willRetry: true },
      { type: "message_end", message: message("stop") },
      { type: "auto_retry_end", success: true },
    );
    assert.equal(events.successful, false);
    push(events, settled);
    events.end();
    assert.equal(events.successful, true);
  });
  for (const failure of [
    { type: "agent_settled", aborted: true },
    { type: "auto_retry_end", success: false, finalError: "overloaded" },
    { type: "message_end", message: message("error") },
    { type: "message_update", assistantMessageEvent: { type: "error", reason: "error" } },
    { type: "turn_end", message: message("aborted") },
    { type: "agent_end", messages: [message("length")], willRetry: false },
    { type: "compaction_end", errorMessage: "compaction failed", aborted: false },
    { type: "extension_error" },
    {},
    { type: "session", id: "bad" },
  ])
    it(`does not call terminal failure successful: ${JSON.stringify(failure)}`, () => {
      const events = new PiEvents();
      push(events, header, ...(failure.type === "agent_settled" ? [failure] : [failure, settled]));
      events.end();
      assert.equal(events.successful, false);
    });
  it("rejects malformed, oversized and truncated records even after a settled event", () => {
    for (const bad of [
      "malformed\n",
      JSON.stringify(settled),
      "a".repeat(PI_EVENT_LINE_LIMIT + 1) + "\n",
    ]) {
      const events = new PiEvents();
      push(events, header, settled);
      for (let i = 0; i < bad.length; i += 4096) events.push(Buffer.from(bad.slice(i, i + 4096)));
      events.end();
      assert.equal(events.successful, false);
    }
  });
  it("drains later records after an oversized record", () => {
    const events = new PiEvents();
    events.push(Buffer.alloc(PI_EVENT_LINE_LIMIT + 1, 97));
    events.push(Buffer.from("\n"));
    push(events, header, settled);
    events.end();
    assert.equal(events.session?.id, header.id);
    assert.equal(events.successful, false);
  });
  it("invalidates earlier settlement if automatic work starts afterward", () => {
    for (const activity of [
      { type: "agent_start" },
      { type: "auto_retry_start" },
      { type: "queue_update", steering: [], followUp: ["next"] },
    ]) {
      const events = new PiEvents();
      push(events, header, settled, activity);
      events.end();
      assert.equal(events.successful, false);
    }
  });
  it("never replaces a captured session or treats content as settlement", () => {
    const events = new PiEvents();
    push(events, header, { ...header, id: "0199a213-81c0-7800-8aa1-bbab2a035a54" }, settled);
    events.end();
    assert.equal(events.session?.id, header.id);
    assert.equal(events.successful, false);
    const content = new PiEvents();
    push(content, header, {
      type: "message_end",
      message: { ...message("stop"), content: { outcome: "complete", type: "agent_settled" } },
    });
    content.end();
    assert.equal(content.successful, false);
  });
});
