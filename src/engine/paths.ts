/**
 * Checks that files and directories a workflow names exist (spec §3.4, todo 1.5).
 *
 * The check is separate from `compileWorkflow` so the compiler stays free of filesystem access.
 * The caller supplies `stat`, so tests can use an in-memory map and the CLI can use the disk.
 * Values that still contain placeholders (such as `{{project.root}}`) are skipped, because they
 * only resolve at run time.
 */
import path from "node:path";
import type { Diagnostic, DiagnosticPath, SourceLocation } from "../contracts/diagnostics.js";
import { errorDiagnostic } from "../contracts/diagnostics.js";
import type { CompiledWorkflow } from "./model.js";

export type PathKind = "file" | "directory";

/** Returns what an absolute path is, or `undefined` when it does not exist. */
export type StatFn = (absolutePath: string) => PathKind | undefined;

export function checkReferencedPaths(
  compiled: CompiledWorkflow,
  stat: StatFn,
  locate?: (diagnosticPath: DiagnosticPath) => SourceLocation | undefined,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const report = (diagnosticPath: DiagnosticPath, message: string) => {
    const diagnostic = errorDiagnostic("missing_path", message, diagnosticPath);
    const location = locate?.(diagnosticPath);
    diagnostics.push(location ? { ...diagnostic, location } : diagnostic);
  };
  const expectFile = (absolutePath: string, diagnosticPath: DiagnosticPath, label: string) => {
    if (stat(absolutePath) !== "file") {
      report(diagnosticPath, `${label} '${absolutePath}' does not exist or is not a file`);
    }
  };

  if (stat(compiled.projectRoot) !== "directory") {
    report(
      ["project", "root"],
      `project root '${compiled.projectRoot}' does not exist or is not a directory`,
    );
  }

  if (compiled.tasksSourcePath !== undefined) {
    expectFile(compiled.tasksSourcePath, ["tasks", "source", "path"], "task source");
  }
  compiled.instructions.forEach((absolutePath, index) => {
    expectFile(absolutePath, ["project", "instructions", index], "instruction file");
  });

  for (const step of compiled.steps.values()) {
    const base: DiagnosticPath = ["steps", step.id];
    const spec = step.spec;
    if (spec.kind === "agent") {
      if (spec.prompt_file !== undefined && !hasPlaceholder(spec.prompt_file)) {
        expectFile(
          path.resolve(compiled.projectRoot, spec.prompt_file),
          [...base, "prompt_file"],
          "prompt file",
        );
      }
      (spec.instructions ?? []).forEach((file, index) => {
        if (!hasPlaceholder(file)) {
          expectFile(
            path.resolve(compiled.projectRoot, file),
            [...base, "instructions", index],
            "instruction file",
          );
        }
      });
    }
    const cwd = spec.kind === "agent" || spec.kind === "command" ? spec.cwd : undefined;
    if (cwd !== undefined && !hasPlaceholder(cwd)) {
      const absolute = path.resolve(compiled.projectRoot, cwd);
      if (stat(absolute) !== "directory") {
        report(
          [...base, "cwd"],
          `working directory '${absolute}' does not exist or is not a directory`,
        );
      }
    }
  }
  return diagnostics;
}

function hasPlaceholder(value: string): boolean {
  return value.includes("{{");
}
