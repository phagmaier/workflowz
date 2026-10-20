import { statSync } from "node:fs";
import { hasErrors } from "../contracts/diagnostics.js";
import { checkWorkflowText } from "../engine/check.js";
import { checkReferencedPaths, type PathKind } from "../engine/paths.js";

export function validateWorkflow(
  input: { workflowText: string; workflowDir: string },
  options?: { taskSourceConsumed?: boolean },
) {
  return inspectWorkflow(input, options).validation;
}

/** Share one parse/compile/path pass between summaries and the canonical browser draft. */
export function inspectWorkflow(
  input: { workflowText: string; workflowDir: string },
  options?: { taskSourceConsumed?: boolean },
) {
  const checked = checkWorkflowText(input.workflowText, { workflowDir: input.workflowDir });
  const diagnostics = [...checked.diagnostics];
  if (checked.compiled)
    diagnostics.push(...checkReferencedPaths(checked.compiled, statKind, checked.locate, options));
  return {
    checked,
    validation: {
      valid: !!checked.compiled && !hasErrors(diagnostics),
      diagnostics,
      steps: checked.compiled?.steps.size ?? 0,
      sourceSha256: checked.sourceSha256,
    },
  };
}

function statKind(file: string): PathKind | undefined {
  try {
    const stat = statSync(file);
    return stat.isDirectory() ? "directory" : stat.isFile() ? "file" : undefined;
  } catch {
    return undefined;
  }
}
