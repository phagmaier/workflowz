import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPENCODE_RECORD_LIMIT, OpenCodeEvents } from "./opencode-events.js";

const id = "ses_exact_persisted";
const start = JSON.stringify({ type: "session", sessionID: id });
const result = JSON.stringify({ type: "result", sessionID: id, outcome: "succeeded" });
function parse(text: string): OpenCodeEvents {
  const events = new OpenCodeEvents();
  events.push(Buffer.from(text));
  events.end();
  return events;
}
describe("OpenCode bridge framing", () => {
  it("decodes byte-split protocol records and CRLF", () => {
    const events = new OpenCodeEvents();
    for (const byte of Buffer.from(`${start}\r\n${result}\r\n`)) events.push(Buffer.from([byte]));
    events.end();
    assert.equal(events.successful, true);
    assert.equal(events.sessionId, id);
  });
  for (const [name, text] of [
    ["missing terminal", `${start}\n`],
    ["unterminated terminal", `${start}\n${result}`],
    ["malformed", `invalid\n${start}\n${result}\n`],
    ["oversized", `${"x".repeat(OPENCODE_RECORD_LIMIT + 1)}\n${start}\n${result}\n`],
    ["duplicate session", `${start}\n${start}\n${result}\n`],
    ["duplicate result", `${start}\n${result}\n${result}\n`],
    ["result before identity", `${result}\n`],
    [
      "wrong session",
      `${start}\n${JSON.stringify({ type: "result", sessionID: "ses_other", outcome: "succeeded" })}\n`,
    ],
    [
      "provider failure",
      `${start}\n${JSON.stringify({ type: "result", sessionID: id, outcome: "failed" })}\n`,
    ],
    [
      "interruption",
      `${start}\n${JSON.stringify({ type: "result", sessionID: id, outcome: "interrupted" })}\n`,
    ],
    ["unknown protocol", `${start}\n{"type":"future"}\n${result}\n`],
    ["outcome-looking text", `{"outcome":"complete","summary":"not authorized"}\n`],
    ["invalid JSON shape", `[]\n${start}\n${result}\n`],
  ])
    it(`rejects ${name}`, () => {
      assert.equal(parse(text as string).successful, false);
    });
});
