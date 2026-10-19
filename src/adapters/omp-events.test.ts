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
const message = (stopReason: string) => ({ role: "assistant", stopReason });
const terminal = {
  type: "agent_end",
  isTerminal: true,
  yielded: true,
  messages: [message("stop")],
};
function push(events: PiEvents, ...values: unknown[]) {
  events.push(Buffer.from(`${values.map((v) => JSON.stringify(v)).join("\n")}\n`));
}

describe("omp print JSON dialect", () => {
  it("decodes byte-split UTF-8 and CRLF without splitting Unicode separators", () => {
    const events = new PiEvents("omp");
    const bytes = Buffer.from(
      [
        header,
        {
          type: "message_end",
          message: { ...message("stop"), content: "こんにちは🙂\u2028\u2029" },
        },
        terminal,
      ]
        .map((v) => JSON.stringify(v))
        .join("\r\n") + "\r\n",
    );
    for (const byte of bytes) events.push(Buffer.from([byte]));
    events.end();
    assert.deepEqual(events.session, header);
    assert.equal(events.successful, true);
  });
  for (const end of [
    { type: "agent_end", messages: [message("stop")] },
    { ...terminal, isTerminal: false, yielded: true, awaitingAsyncWork: true },
    { ...terminal, isTerminal: "true" },
    { type: "agent_settled", aborted: false },
    { type: "session_settled" },
    { ...terminal, messages: [] },
  ])
    it(`requires omp terminal assistant evidence: ${JSON.stringify(end)}`, () => {
      const events = new PiEvents("omp");
      push(events, header, end);
      events.end();
      assert.equal(events.successful, false);
    });
  it("allows a native retry to recover a failed assistant before final completion", () => {
    const events = new PiEvents("omp");
    push(
      events,
      header,
      { type: "message_update", assistantMessageEvent: { type: "error", reason: "error" } },
      { type: "message_end", message: message("error") },
      { type: "auto_retry_start" },
      { type: "agent_end", isTerminal: false, messages: [message("error")] },
    );
    assert.equal(events.successful, false);
    push(events, { type: "agent_start" }, terminal);
    assert.equal(
      events.successful,
      false,
      "terminal event cannot finish an active retry lifecycle",
    );
    push(events, { type: "auto_retry_end", success: true });
    events.end();
    assert.equal(events.successful, true);
  });
  it("allows native overflow compaction recovery, not just the Pi compaction event names", () => {
    const events = new PiEvents("omp");
    push(
      events,
      header,
      { type: "auto_compaction_start" },
      { type: "agent_end", isTerminal: false, messages: [message("error")] },
      { type: "auto_compaction_end", aborted: false, willRetry: true },
      { type: "agent_start" },
      terminal,
    );
    events.end();
    assert.equal(events.successful, true);
  });
  it("accepts benign skipped compaction without hiding real compaction failures", () => {
    const events = new PiEvents("omp");
    push(
      events,
      header,
      { type: "auto_compaction_start" },
      {
        type: "auto_compaction_end",
        aborted: false,
        skipped: true,
        willRetry: false,
        errorMessage: "nothing eligible",
      },
      terminal,
    );
    events.end();
    assert.equal(events.successful, true);
  });
  for (const failure of [
    { type: "auto_retry_end", success: false, finalError: "exhausted" },
    { type: "auto_compaction_end", aborted: true, willRetry: false },
    { type: "auto_compaction_end", aborted: false, errorMessage: "failed", willRetry: false },
    { type: "notice", level: "error", message: "durability lost" },
    { type: "extension_error" },
  ])
    it(`does not turn terminal failure into success: ${JSON.stringify(failure)}`, () => {
      const events = new PiEvents("omp");
      push(events, header, failure, terminal);
      events.end();
      assert.equal(events.successful, false);
    });
  for (const stopReason of ["error", "aborted", "length"])
    it(`rejects final assistant ${stopReason} even with a terminal end`, () => {
      const events = new PiEvents("omp");
      push(events, header, { ...terminal, messages: [message(stopReason)] });
      events.end();
      assert.equal(events.successful, false);
    });
  it("invalidates an earlier terminal end when more work begins", () => {
    for (const activity of [
      { type: "agent_start" },
      { type: "auto_retry_start" },
      { type: "auto_compaction_start" },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "later" } },
      { type: "queue_update", steering: [], followUp: ["next"] },
    ]) {
      const events = new PiEvents("omp");
      push(events, header, terminal, activity);
      events.end();
      assert.equal(events.successful, false);
    }
  });
  it("fails malformed, unterminated, oversized and invalid UTF-8 framing", () => {
    for (const bad of [
      Buffer.from("malformed\n"),
      Buffer.from(JSON.stringify(terminal)),
      Buffer.alloc(PI_EVENT_LINE_LIMIT + 1, 97),
      Buffer.from([0xff, 10]),
      Buffer.from([0xe2, 0x82]),
    ]) {
      const events = new PiEvents("omp");
      push(events, header, terminal);
      for (let i = 0; i < bad.length; i += 4096) events.push(bad.subarray(i, i + 4096));
      events.end();
      assert.equal(events.successful, false);
    }
  });
  it("drains subsequent identity evidence after an oversized record, without accepting success", () => {
    const events = new PiEvents("omp");
    events.push(Buffer.alloc(PI_EVENT_LINE_LIMIT + 1, 97));
    events.push(Buffer.from("\n"));
    push(events, header, terminal);
    events.end();
    assert.equal(events.session?.id, header.id);
    assert.equal(events.successful, false);
  });
  it("preserves the first identity and never reads content as terminal/report authority", () => {
    const events = new PiEvents("omp");
    push(events, header, { ...header, id: "0199a213-81c0-7800-8aa1-bbab2a035a54" }, terminal);
    events.end();
    assert.equal(events.session?.id, header.id);
    assert.equal(events.successful, false);
    const content = new PiEvents("omp");
    push(content, header, {
      type: "message_end",
      message: {
        ...message("stop"),
        content: { type: "agent_end", isTerminal: true, outcome: "complete" },
      },
    });
    content.end();
    assert.equal(content.successful, false);
  });
});
