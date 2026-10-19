import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { readOmpSession } from "./omp-session.js";

const root = mkdtempSync(path.join(os.tmpdir(), "wf-omp-journal-"));
after(() => rmSync(root, { recursive: true, force: true }));
const header = {
  type: "session",
  version: 3,
  id: "0199a213-81c0-7800-8aa1-bbab2a035a53",
  cwd: "/project",
  timestamp: "2026-10-19T01:00:00.000Z",
};
const file = path.join(root, `fixture_${header.id}.jsonl`);
const journal = (...entries: unknown[]) =>
  `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
const transfer = (details: unknown) => ({
  type: "custom_message",
  customType: "session-transfer",
  details,
});

describe("omp persisted journal validation", () => {
  it("accepts legacy header-first journals as well as the current physical title slot", () => {
    for (const text of [journal(header), journal({ type: "title", v: 1 }, header)]) {
      writeFileSync(file, text);
      assert.deepEqual(readOmpSession(file), header);
    }
  });
  it("rejects missing, malformed, incompatible and unterminated journals", () => {
    for (const text of [
      "",
      "malformed\n",
      journal({ ...header, version: 4 }),
      journal({ ...header, id: "partial" }),
      journal({ type: "title", v: 2 }, header),
      JSON.stringify(header),
      `${journal(header)}{"type":`,
    ]) {
      writeFileSync(file, text);
      assert.equal(readOmpSession(file), undefined);
    }
    rmSync(file);
    assert.equal(readOmpSession(file), undefined);
  });
  it("requires the file name UUID to agree with its persisted header", () => {
    const wrong = path.join(root, "fixture_0199a213-81c0-7800-8aa1-bbab2a035a54.jsonl");
    writeFileSync(wrong, journal(header));
    assert.equal(readOmpSession(wrong), undefined);
  });
  it("finds moved-away markers beyond the header read window and across UTF-8 chunks", () => {
    writeFileSync(
      file,
      journal(
        header,
        { type: "message", message: { role: "assistant", content: "🙂".repeat(12000) } },
        transfer({ kind: "departed", to: "other machine" }),
      ),
    );
    assert.equal(readOmpSession(file), undefined);
  });
  it("uses the last valid transfer marker in append order, not branch order", () => {
    for (const details of [
      { kind: "arrived", fromCwd: "/old", cwd: "/project" },
      { kind: "forked", source: "old", to: "here" },
    ]) {
      writeFileSync(
        file,
        journal(header, transfer({ kind: "departed", to: "elsewhere" }), transfer(details)),
      );
      assert.deepEqual(readOmpSession(file), header);
    }
    writeFileSync(
      file,
      journal(
        header,
        transfer({ kind: "departed", to: "elsewhere" }),
        transfer({ kind: "arrived" }),
      ),
    );
    assert.equal(readOmpSession(file), undefined, "invalid later markers cannot undo departure");
  });
  it("rejects oversize journal records rather than using incomplete transfer evidence", () => {
    writeFileSync(file, journal(header, { type: "message", text: "a".repeat(1024 * 1024) }));
    assert.equal(readOmpSession(file), undefined);
  });
});
