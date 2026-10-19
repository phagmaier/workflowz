/**
 * `validate`: checks a workflow file without starting anything.
 *
 * Exit codes: 0 when the workflow compiles (warnings allowed), 1 when it has errors, 2 when the file
 * cannot be read. Diagnostics go to stdout in editor-style `file:line:column` form.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { type Diagnostic, formatDiagnostic, hasErrors } from "../contracts/diagnostics.js";
import { checkWorkflowText } from "../engine/check.js";
import { checkReferencedPaths, type PathKind } from "../engine/paths.js";

const file = process.argv[2];
if (file === undefined) {
  console.error("usage: validate <workflow.yaml>");
  process.exit(2);
}

let text: string;
try {
  text = readFileSync(file, "utf8");
} catch (error) {
  console.error(`cannot read ${file}: ${(error as NodeJS.ErrnoException).code ?? "unknown error"}`);
  process.exit(2);
}

const result = checkWorkflowText(text, { workflowDir: path.dirname(path.resolve(file)) });
const diagnostics: Diagnostic[] = [...result.diagnostics];
if (result.compiled !== undefined && !hasErrors(diagnostics)) {
  diagnostics.push(...checkReferencedPaths(result.compiled, statKind, result.locate));
}
for (const diagnostic of diagnostics) {
  console.log(formatDiagnostic(diagnostic, file));
}

if (hasErrors(diagnostics) || result.compiled === undefined) {
  console.log(
    `${file}: invalid (${diagnostics.filter((d) => d.severity === "error").length} error(s))`,
  );
  process.exit(1);
}
const warnings = diagnostics.filter((d) => d.severity === "warning").length;
console.log(
  `${file}: valid (${result.compiled.steps.size} steps, ${warnings} warning(s), sha256 ${result.sourceSha256.slice(0, 12)})`,
);

function statKind(absolutePath: string): PathKind | undefined {
  try {
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      return "directory";
    }
    return stats.isFile() ? "file" : undefined;
  } catch {
    return undefined;
  }
}
