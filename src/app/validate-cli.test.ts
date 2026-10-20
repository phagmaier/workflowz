import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { INVALID_FIXTURES, OVERNIGHT_WORKFLOW, REPO_ROOT } from "../test-support/paths.js";

const CLI = path.join(REPO_ROOT, "dist", "app", "validate-cli.js");

function validate(file: string) {
  return spawnSync(process.execPath, [CLI, file], { encoding: "utf8" });
}

describe("validate CLI (process boundary)", () => {
  it("exits 0 and reports the example as valid", () => {
    const run = validate(OVERNIGHT_WORKFLOW);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /overnight\.yaml: valid \(8 steps, 0 warning\(s\)/);
  });

  for (const file of readdirSync(path.join(REPO_ROOT, "examples")).filter((name) =>
    name.endsWith(".yaml"),
  )) {
    it(`validates examples/${file} through the CLI with zero warnings`, () => {
      const run = validate(path.join(REPO_ROOT, "examples", file));
      assert.equal(run.status, 0, run.stderr || run.stdout);
      assert.match(run.stdout, /: valid \(\d+ steps, 0 warning\(s\),/);
      assert.doesNotMatch(run.stdout + run.stderr, /(?:error|warning) \[/);
    });
  }

  it("exits 1 and prints file:line:column diagnostics for an invalid workflow", () => {
    const file = path.join(INVALID_FIXTURES, "duplicate-step-key.yaml");
    const run = validate(file);
    assert.equal(run.status, 1);
    assert.match(run.stdout, /duplicate-step-key\.yaml:9:3: error \[duplicate_key\]/);
  });

  it("exits 2 when the file cannot be read", () => {
    const run = validate(path.join(INVALID_FIXTURES, "does-not-exist.yaml"));
    assert.equal(run.status, 2);
    assert.match(run.stderr, /cannot read/);
  });

  it("exits 1 when the project root is missing even without other path references", (context) => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "wf-validate-"));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, "workflow.yaml");
    writeFileSync(
      file,
      "version: 1\nname: x\nproject:\n  root: missing\nstart: done\nsteps:\n  done:\n    kind: end\n",
    );
    const run = validate(file);
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stdout, /workflow\.yaml:4:3: error \[missing_path\] project.root:/);
  });
});
