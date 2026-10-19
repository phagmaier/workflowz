/**
 * Entry point for "is this workflow runnable?": parse the text, then compile it, with every
 * diagnostic carrying its source location. Callers (CLI, UI, run start) use this rather than
 * wiring the parser and compiler together themselves.
 */
import type { Diagnostic, DiagnosticPath, SourceLocation } from "../contracts/diagnostics.js";
import { hasErrors } from "../contracts/diagnostics.js";
import { parseWorkflowText } from "../contracts/parse-workflow.js";
import { type CompileOptions, compileWorkflow } from "./compile.js";
import type { CompiledWorkflow } from "./model.js";

export interface CheckResult {
  readonly compiled?: CompiledWorkflow;
  readonly diagnostics: readonly Diagnostic[];
  readonly sourceSha256: string;
  /** Maps a diagnostic path to a source position, for follow-up checks such as missing files. */
  readonly locate: (path: DiagnosticPath) => SourceLocation | undefined;
}

export function checkWorkflowText(
  text: string,
  options: Omit<CompileOptions, "locate">,
): CheckResult {
  const parsed = parseWorkflowText(text);
  if (!parsed.document) {
    return {
      diagnostics: parsed.diagnostics,
      sourceSha256: parsed.sourceSha256,
      locate: parsed.locate,
    };
  }
  const outcome = compileWorkflow(parsed.document, { ...options, locate: parsed.locate });
  const diagnostics = [...parsed.diagnostics, ...outcome.diagnostics];
  if (hasErrors(diagnostics) || !outcome.compiled) {
    return { diagnostics, sourceSha256: parsed.sourceSha256, locate: parsed.locate };
  }
  return {
    compiled: outcome.compiled,
    diagnostics,
    sourceSha256: parsed.sourceSha256,
    locate: parsed.locate,
  };
}
