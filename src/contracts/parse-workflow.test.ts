import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { INVALID_FIXTURES, OVERNIGHT_WORKFLOW } from "../test-support/paths.js";
import { parseWorkflowText } from "./parse-workflow.js";

function errorCodes(text: string): string[] {
  return parseWorkflowText(text)
    .diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code);
}

describe("parseWorkflowText", () => {
  it("parses the overnight example into a typed document", () => {
    const parsed = parseWorkflowText(readFileSync(OVERNIGHT_WORKFLOW, "utf8"));
    assert.deepEqual(parsed.diagnostics, []);
    assert.ok(parsed.document);
    assert.equal(parsed.document.start, "pick_task");
    assert.equal(parsed.document.steps.implement?.kind, "agent");
    assert.equal(parsed.document.steps.done?.kind, "end");
    assert.equal(parsed.document.policies?.length, 1);
  });

  it("hashes the exact source text so revisions can be identified", () => {
    const text = readFileSync(OVERNIGHT_WORKFLOW, "utf8");
    assert.equal(parseWorkflowText(text).sourceSha256, parseWorkflowText(text).sourceSha256);
    assert.notEqual(
      parseWorkflowText(text).sourceSha256,
      parseWorkflowText(`${text}\n`).sourceSha256,
    );
  });

  it("reads an unquoted `on:` key as a string, not a boolean (YAML 1.2)", () => {
    const parsed = parseWorkflowText(
      'version: 1\nname: x\nproject:\n  root: "."\nstart: a\nsteps:\n  a:\n    kind: command\n    argv: [echo]\n    on:\n      complete: { goto: b }\n      failed: { pause: true }\n  b:\n    kind: end\n',
    );
    assert.deepEqual(parsed.diagnostics, []);
    assert.equal(parsed.document?.steps.a?.kind, "command");
  });

  it("rejects duplicate YAML keys, pointing at the second occurrence", () => {
    const parsed = parseWorkflowText(
      readFileSync(path.join(INVALID_FIXTURES, "duplicate-step-key.yaml"), "utf8"),
    );
    const [diagnostic] = parsed.diagnostics;
    assert.equal(diagnostic?.code, "duplicate_key");
    assert.equal(parsed.document, undefined);
    assert.deepEqual(diagnostic?.location, { line: 9, column: 3 });
  });

  it("rejects unknown fields at every level, not just the top", () => {
    const codes = parseWorkflowText(
      readFileSync(path.join(INVALID_FIXTURES, "unknown-step-field.yaml"), "utf8"),
    ).diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path.join(".")]);
    assert.deepEqual(codes, [["unknown_field", "steps.a.lable"]]);
  });

  it("rejects aliases so a value cannot depend on a distant anchor", () => {
    assert.deepEqual(
      errorCodes(
        'version: 1\nname: &n x\nproject:\n  root: "."\nstart: a\nsteps:\n  a:\n    kind: end\n    label: *n\n',
      ),
      ["alias_not_allowed"],
    );
  });

  it("reports empty files and multiple documents", () => {
    assert.deepEqual(errorCodes("# only a comment\n"), ["empty_document"]);
    assert.deepEqual(errorCodes("version: 1\n---\nversion: 1\n"), ["multiple_documents"]);
  });

  it("reports YAML syntax errors at the offending line", () => {
    const parsed = parseWorkflowText(
      readFileSync(path.join(INVALID_FIXTURES, "yaml-syntax.yaml"), "utf8"),
    );
    assert.equal(parsed.diagnostics[0]?.code, "yaml_syntax");
    assert.equal(parsed.diagnostics[0]?.location?.line, 8);
  });

  it("reports a missing required field by path", () => {
    const parsed = parseWorkflowText(
      readFileSync(path.join(INVALID_FIXTURES, "missing-start.yaml"), "utf8"),
    );
    const [diagnostic] = parsed.diagnostics;
    assert.equal(diagnostic?.code, "missing_field");
    assert.deepEqual(diagnostic?.path, ["start"]);
  });

  it("rejects an unsupported workflow version with its own code", () => {
    assert.deepEqual(
      errorCodes(
        'version: 2\nname: x\nproject:\n  root: "."\nstart: a\nsteps:\n  a:\n    kind: end\n',
      ),
      ["unsupported_version"],
    );
  });

  it("rejects an unknown step kind and lists the valid kinds", () => {
    const [diagnostic] = parseWorkflowText(
      readFileSync(path.join(INVALID_FIXTURES, "unknown-step-kind.yaml"), "utf8"),
    ).diagnostics;
    assert.equal(diagnostic?.code, "unknown_step_kind");
    assert.match(diagnostic?.message ?? "", /agent, command, task\.next, task\.complete, end/);
  });

  it("rejects a transition that declares two actions", () => {
    assert.deepEqual(
      parseWorkflowText(
        readFileSync(path.join(INVALID_FIXTURES, "two-actions-in-transition.yaml"), "utf8"),
      ).diagnostics.map((diagnostic) => diagnostic.code),
      ["invalid_field"],
    );
  });

  it("requires exactly one of prompt or prompt_file on agent steps", () => {
    assert.deepEqual(
      errorCodes(readFileSync(path.join(INVALID_FIXTURES, "missing-prompt.yaml"), "utf8")),
      ["invalid_field"],
    );
    assert.deepEqual(
      errorCodes(readFileSync(path.join(INVALID_FIXTURES, "both-prompt-fields.yaml"), "utf8")),
      ["invalid_field"],
    );
  });

  it("rejects declaring a reserved system outcome", () => {
    assert.deepEqual(
      errorCodes(readFileSync(path.join(INVALID_FIXTURES, "reserved-outcome.yaml"), "utf8")),
      ["reserved_outcome"],
    );
  });

  it("rejects a retry that cannot retry", () => {
    assert.deepEqual(
      errorCodes(readFileSync(path.join(INVALID_FIXTURES, "bad-retry.yaml"), "utf8")),
      ["invalid_field"],
    );
  });

  it("rejects a policy with more than one selector", () => {
    const text = `version: 1
name: x
project:
  root: "."
start: a
policies:
  - match: { tags: [t], all: true }
    on:
      failed: { pause: true }
steps:
  a:
    kind: end
`;
    assert.deepEqual(errorCodes(text), ["invalid_field"]);
  });
});
