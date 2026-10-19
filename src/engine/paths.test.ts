import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { OVERNIGHT_WORKFLOW } from "../test-support/paths.js";
import { compileOk, workflowText } from "../test-support/workflows.js";
import { checkWorkflowText } from "./check.js";
import { checkReferencedPaths, type PathKind, type StatFn } from "./paths.js";

/** An in-memory filesystem: absolute path -> kind. Anything absent does not exist. */
function fakeFs(entries: Record<string, PathKind>): StatFn {
  return (absolutePath) => entries[absolutePath];
}

describe("checkReferencedPaths", () => {
  it("accepts a workflow whose files and directories all exist", () => {
    const compiled = compileOk(
      workflowText(
        "tasks:\n  source:\n    kind: markdown_checklist\n    path: todo.md\nstart: a\nsteps:\n  a:\n    kind: agent\n    harness: codex\n    session: fresh\n    prompt_file: prompts/go.md\n    cwd: src\n    outcomes: [complete]\n    on:\n      complete: { goto: b }\n  b:\n    kind: end\n",
      ),
    );
    const stat = fakeFs({
      [path.join(compiled.projectRoot, "todo.md")]: "file",
      [path.join(compiled.projectRoot, "prompts", "go.md")]: "file",
      [path.join(compiled.projectRoot, "src")]: "directory",
    });
    assert.deepEqual(checkReferencedPaths(compiled, stat), []);
  });

  it("reports a missing task source, prompt file, and working directory with locations", () => {
    const text = workflowText(
      "tasks:\n  source:\n    kind: markdown_checklist\n    path: todo.md\nstart: a\nsteps:\n  a:\n    kind: agent\n    harness: codex\n    session: fresh\n    prompt_file: prompts/go.md\n    cwd: nowhere\n    outcomes: [complete]\n    on:\n      complete: { goto: b }\n  b:\n    kind: end\n",
    );
    const result = checkWorkflowText(text, { workflowDir: "/elsewhere" });
    assert.ok(result.compiled, JSON.stringify(result.diagnostics));
    const diagnostics = checkReferencedPaths(result.compiled, fakeFs({}), result.locate);
    assert.deepEqual(
      diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path.join(".")]),
      [
        ["missing_path", "tasks.source.path"],
        ["missing_path", "steps.a.prompt_file"],
        ["missing_path", "steps.a.cwd"],
      ],
    );
    assert.ok(diagnostics.every((diagnostic) => diagnostic.location !== undefined));
  });

  it("skips values that still contain placeholders, since they resolve only at run time", () => {
    const compiled = compileOk(
      workflowText(
        'start: a\nsteps:\n  a:\n    kind: command\n    argv: [echo]\n    cwd: "{{project.root}}"\n    on:\n      complete: { goto: b }\n      failed: { pause: true }\n  b:\n    kind: end\n',
      ),
    );
    assert.deepEqual(checkReferencedPaths(compiled, fakeFs({})), []);
  });

  it("accepts the example's instruction files and checklist when they exist", () => {
    const result = checkWorkflowText(readFileSync(OVERNIGHT_WORKFLOW, "utf8"), {
      workflowDir: path.dirname(OVERNIGHT_WORKFLOW),
    });
    assert.ok(result.compiled);
    const everything: StatFn = (absolutePath) =>
      path.extname(absolutePath) ? "file" : "directory";
    assert.deepEqual(checkReferencedPaths(result.compiled, everything), []);
  });
});
