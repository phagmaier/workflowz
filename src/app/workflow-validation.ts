import { statSync } from "node:fs";
import { hasErrors } from "../contracts/diagnostics.js";
import { checkWorkflowText } from "../engine/check.js";
import { checkReferencedPaths, type PathKind } from "../engine/paths.js";

export function validateWorkflow(
  input: { workflowText: string; workflowDir: string },
  options?: { taskSourceConsumed?: boolean },
) {
  const checked = checkWorkflowText(input.workflowText, { workflowDir: input.workflowDir });
  const diagnostics = [...checked.diagnostics];
  if (checked.compiled)
    diagnostics.push(...checkReferencedPaths(checked.compiled, statKind, checked.locate, options));
  return {
    valid: !!checked.compiled && !hasErrors(diagnostics),
    diagnostics,
    steps: checked.compiled?.steps.size ?? 0,
    sourceSha256: checked.sourceSha256,
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
