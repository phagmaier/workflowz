/** Small helpers for building workflow text in tests, so each test states only what it varies. */
import { type CheckResult, checkWorkflowText } from "../engine/check.js";
import type { CompiledWorkflow } from "../engine/model.js";

export function workflowText(body: string, name = "test"): string {
  return `version: 1\nname: ${name}\nproject:\n  root: "."\n${body}`;
}

/** Compiles inline workflow text, failing the calling test if the workflow has errors. */
export function compileOk(text: string): CompiledWorkflow {
  const result: CheckResult = checkWorkflowText(text, { workflowDir: process.cwd() });
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (!result.compiled) {
    throw new Error(`expected workflow to compile, got: ${JSON.stringify(errors)}`);
  }
  return result.compiled;
}
