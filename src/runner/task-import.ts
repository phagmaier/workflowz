/** Filesystem seam for read-only task import; canonical tasks are written only by the coordinator. */
import { readFileSync } from "node:fs";
import { previewMarkdownTasks, type TaskImportSnapshot } from "../contracts/task-import.js";
import { checkWorkflowText } from "../engine/check.js";
import { WorkflowInvalidError } from "../engine/run-coordinator.js";

export function readTaskImport(input: {
  workflowText: string;
  workflowDir: string;
  includeCompleted?: boolean;
}) {
  const checked = checkWorkflowText(input.workflowText, { workflowDir: input.workflowDir });
  if (!checked.compiled) throw new WorkflowInvalidError(checked.diagnostics);
  const sourcePath = checked.compiled.tasksSourcePath;
  if (sourcePath === undefined) return undefined;
  let markdown: string;
  try {
    markdown = readFileSync(sourcePath, "utf8");
  } catch (error) {
    throw new Error(
      `cannot import task checklist '${sourcePath}': ${(error as NodeJS.ErrnoException).code ?? "read failed"}`,
    );
  }
  const snapshot: TaskImportSnapshot = {
    sourcePath,
    markdown,
    includeCompleted: input.includeCompleted ?? false,
  };
  return { snapshot, preview: previewMarkdownTasks(snapshot) };
}
