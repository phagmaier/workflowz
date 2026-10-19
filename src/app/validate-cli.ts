/**
 * `validate`: checks a workflow file without starting anything.
 *
 * Exit codes: 0 when the workflow compiles (warnings allowed), 1 when it has errors, 2 when the file
 * cannot be read. Diagnostics go to stdout in editor-style `file:line:column` form.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { formatDiagnostic } from "../contracts/diagnostics.js";
import { validateWorkflow } from "./workflow-validation.js";

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

const result = validateWorkflow({
  workflowText: text,
  workflowDir: path.dirname(path.resolve(file)),
});
const diagnostics = result.diagnostics;
for (const diagnostic of diagnostics) {
  console.log(formatDiagnostic(diagnostic, file));
}

if (!result.valid) {
  console.log(
    `${file}: invalid (${diagnostics.filter((d) => d.severity === "error").length} error(s))`,
  );
  process.exit(1);
}
const warnings = diagnostics.filter((d) => d.severity === "warning").length;
console.log(
  `${file}: valid (${result.steps} steps, ${warnings} warning(s), sha256 ${result.sourceSha256.slice(0, 12)})`,
);
