/**
 * Diagnostics are the only error currency of the contract and compiler layers. Each one carries
 * a stable `code` (tests and UIs key off it), a path into the workflow document, and — once the
 * loader knows the source text — a 1-based line and column.
 */
export type DiagnosticPath = readonly (string | number)[];

export interface SourceLocation {
  readonly line: number;
  readonly column: number;
}

export const DIAGNOSTIC_CODES = [
  // Document / YAML level
  "yaml_syntax",
  "duplicate_key",
  "alias_not_allowed",
  "multiple_documents",
  "empty_document",
  "unknown_field",
  "missing_field",
  "invalid_field",
  "unsupported_version",
  // Steps and outcomes
  "unknown_step_kind",
  "unknown_step",
  "reserved_outcome",
  "invalid_outcome",
  "undeclared_outcome",
  "incomplete_transition",
  "invalid_transition",
  "unknown_transition_key",
  "unknown_outcome_in_policy",
  "conflicting_policy",
  "policy_matches_no_steps",
  // Harnesses
  "unknown_harness",
  "unsupported_capability",
  // Interpolation
  "invalid_template",
  "unknown_placeholder",
  "invalid_placeholder_reference",
  "placeholder_not_allowed",
  "tasks_required",
  // Referenced files and directories (checked against the filesystem by the caller)
  "missing_path",
  // Graph warnings
  "unreachable_step",
  "unbounded_cycle",
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

export interface Diagnostic {
  readonly severity: "error" | "warning";
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly path: DiagnosticPath;
  readonly location?: SourceLocation;
}

export function errorDiagnostic(
  code: DiagnosticCode,
  message: string,
  path: DiagnosticPath = [],
): Diagnostic {
  return { severity: "error", code, message, path };
}

export function warningDiagnostic(
  code: DiagnosticCode,
  message: string,
  path: DiagnosticPath = [],
): Diagnostic {
  return { severity: "warning", code, message, path };
}

export function formatPath(path: DiagnosticPath): string {
  if (path.length === 0) {
    return "<document>";
  }
  return path
    .map((segment, index) => {
      if (typeof segment === "number") {
        return `[${segment}]`;
      }
      return index === 0 ? segment : `.${segment}`;
    })
    .join("");
}

/** One line per diagnostic, in the shape editors and terminals can jump to. */
export function formatDiagnostic(diagnostic: Diagnostic, sourceName: string): string {
  const where = diagnostic.location
    ? `${sourceName}:${diagnostic.location.line}:${diagnostic.location.column}`
    : sourceName;
  return `${where}: ${diagnostic.severity} [${diagnostic.code}] ${formatPath(diagnostic.path)}: ${diagnostic.message}`;
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
