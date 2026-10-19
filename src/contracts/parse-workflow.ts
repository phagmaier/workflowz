/**
 * Strict YAML loader for workflow v1 documents.
 *
 * Order of checks: YAML-level problems (duplicate keys, multiple documents, syntax), then aliases
 * (they make a file's meaning depend on a distant anchor), then the typed shape schema. Every
 * diagnostic carries a 1-based source location so an editor can jump to the exact field.
 *
 * The YAML 1.2 core schema is used, so an unquoted `on:` key stays the string "on" instead of
 * becoming a boolean as it would under YAML 1.1.
 */
import { createHash } from "node:crypto";
import {
  type Document,
  isMap,
  isNode,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  visit,
} from "yaml";
import {
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticPath,
  errorDiagnostic,
  type SourceLocation,
} from "./diagnostics.js";
import { isIdentifier } from "./identifiers.js";
import {
  STEP_KINDS,
  STEP_SCHEMAS,
  type WorkflowDocument,
  type WorkflowStep,
  workflowHeaderSchema,
} from "./workflow-schema.js";

export interface ParsedWorkflow {
  /** Present only when the source has no errors. */
  readonly document?: WorkflowDocument;
  readonly diagnostics: readonly Diagnostic[];
  /** SHA-256 of the exact source text; identifies the workflow revision a run was started from. */
  readonly sourceSha256: string;
  /** Maps a document path (from a later semantic check) to its line and column in the source. */
  readonly locate: (path: DiagnosticPath) => SourceLocation | undefined;
}

/** Issue before a source location is attached. */
interface Issue {
  readonly path: DiagnosticPath;
  readonly code: DiagnosticCode;
  readonly message: string;
  /** Character offset into the source, for issues that have no document path (YAML-level). */
  readonly offset?: number | undefined;
}

/** Subset of zod's issue shape that this module consumes. */
interface ZodIssueLike {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly message: string;
  readonly keys?: readonly string[] | undefined;
  readonly params?: Record<string, unknown> | undefined;
}

const UNRECOGNIZED_KEYS = "unrecognized_keys";

/** Parses and validates workflow text. Bad user input yields diagnostics, never exceptions. */
export function parseWorkflowText(text: string): ParsedWorkflow {
  const sourceSha256 = createHash("sha256").update(text).digest("hex");
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: true });
  const locator = new Locator(doc, lineCounter);
  const locate = (path: DiagnosticPath) => locator.locate(path);

  const issues: Issue[] = doc.errors.map((error) => ({
    path: [],
    code: yamlErrorCode(error.code),
    message: yamlErrorMessage(error.code, error.message),
    offset: error.pos[0],
  }));
  if (issues.length === 0) {
    visit(doc, {
      Alias(_key, node) {
        issues.push({
          path: [],
          code: "alias_not_allowed",
          message: "YAML aliases (*name) are not supported in workflow files; write the value out",
          offset: node.range?.[0],
        });
      },
    });
  }
  if (issues.length === 0 && (doc.contents === null || doc.contents === undefined)) {
    issues.push({ path: [], code: "empty_document", message: "the workflow file is empty" });
  }
  if (issues.length > 0) {
    return { diagnostics: toDiagnostics(issues, locator), sourceSha256, locate };
  }

  const raw: unknown = doc.toJS({ maxAliasCount: 0 });
  if (!isPlainObject(raw)) {
    issues.push({
      path: [],
      code: "invalid_field",
      message: "the workflow must be a mapping of fields",
    });
    return { diagnostics: toDiagnostics(issues, locator), sourceSha256, locate };
  }

  const header = workflowHeaderSchema.safeParse(raw);
  if (!header.success) {
    issues.push(...header.error.issues.flatMap((issue) => mapZodIssue(issue, raw, [])));
  }

  const steps = validateSteps(raw.steps, issues);
  if (isPlainObject(raw.steps) && Object.keys(raw.steps).length === 0) {
    issues.push({
      path: ["steps"],
      code: "invalid_field",
      message: "at least one step is required",
    });
  }

  const diagnostics = toDiagnostics(issues, locator);
  if (issues.length > 0 || !header.success) {
    return { diagnostics, sourceSha256, locate };
  }
  const { steps: _rawSteps, ...fields } = header.data;
  return { document: { ...fields, steps }, diagnostics, sourceSha256, locate };
}

function validateSteps(rawSteps: unknown, issues: Issue[]): Record<string, WorkflowStep> {
  const steps: Record<string, WorkflowStep> = {};
  if (!isPlainObject(rawSteps)) {
    return steps;
  }
  for (const [stepId, rawStep] of Object.entries(rawSteps)) {
    const path: DiagnosticPath = ["steps", stepId];
    if (!isIdentifier(stepId)) {
      issues.push({
        path,
        code: "invalid_field",
        message:
          "step IDs must be 1-64 characters: a lowercase letter, then lowercase letters, digits or '_'",
      });
      continue;
    }
    if (!isPlainObject(rawStep)) {
      issues.push({ path, code: "invalid_field", message: "a step must be a mapping of fields" });
      continue;
    }
    const kind = rawStep.kind;
    if (kind === undefined) {
      issues.push({
        path: [...path, "kind"],
        code: "missing_field",
        message: "required field is missing",
      });
      continue;
    }
    if (typeof kind !== "string" || !(STEP_KINDS as readonly string[]).includes(kind)) {
      issues.push({
        path: [...path, "kind"],
        code: "unknown_step_kind",
        message: `unknown step kind ${JSON.stringify(kind)}; expected one of ${STEP_KINDS.join(", ")}`,
      });
      continue;
    }
    const parsed = STEP_SCHEMAS[kind as keyof typeof STEP_SCHEMAS].safeParse(rawStep);
    if (parsed.success) {
      steps[stepId] = parsed.data as WorkflowStep;
    } else {
      issues.push(...parsed.error.issues.flatMap((issue) => mapZodIssue(issue, rawStep, path)));
    }
  }
  return steps;
}

/**
 * Converts one zod issue into a diagnostic. `base` is the path of the object that was validated
 * (for example `["steps", "implement"]`), and `root` is that object's raw value.
 */
function mapZodIssue(issue: ZodIssueLike, root: unknown, base: DiagnosticPath): Issue[] {
  const relative = issue.path.map((segment) =>
    typeof segment === "number" ? segment : String(segment),
  );
  const path: DiagnosticPath = [...base, ...relative];

  if (issue.code === UNRECOGNIZED_KEYS && issue.keys) {
    return issue.keys.map((key) => ({
      path: [...path, key],
      code: "unknown_field",
      message: `unknown field '${key}'`,
    }));
  }
  const explicit = issue.params?.diagnosticCode;
  if (typeof explicit === "string") {
    return [{ path, code: explicit as DiagnosticCode, message: issue.message }];
  }
  if (path.length === 1 && path[0] === "version") {
    return [{ path, code: "unsupported_version", message: issue.message }];
  }
  if (issue.code === "invalid_type" && valueAt(root, relative) === undefined) {
    return [{ path, code: "missing_field", message: "required field is missing" }];
  }
  return [{ path, code: "invalid_field", message: issue.message }];
}

function valueAt(root: unknown, path: readonly (string | number)[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

function toDiagnostics(issues: readonly Issue[], locator: Locator): Diagnostic[] {
  return issues.map((issue) => {
    const diagnostic = errorDiagnostic(issue.code, issue.message, issue.path);
    const location =
      issue.offset === undefined ? locator.locate(issue.path) : locator.locateOffset(issue.offset);
    return location ? { ...diagnostic, location } : diagnostic;
  });
}

function yamlErrorCode(code: string): DiagnosticCode {
  switch (code) {
    case "DUPLICATE_KEY":
      return "duplicate_key";
    case "MULTIPLE_DOCS":
      return "multiple_documents";
    default:
      return "yaml_syntax";
  }
}

/**
 * The yaml library appends a code frame and a position to its messages; the position is already
 * carried by the diagnostic location, so only the first sentence is kept.
 */
function yamlErrorMessage(code: string, message: string): string {
  if (code === "DUPLICATE_KEY") {
    return "duplicate key: each key may appear only once in a mapping";
  }
  if (code === "MULTIPLE_DOCS") {
    return "the file contains multiple YAML documents; a workflow must be a single document";
  }
  const firstLine = message.split("\n")[0] ?? message;
  return firstLine.replace(/\s+at line \d+, column \d+:?$/, "").trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Finds the YAML node behind a diagnostic path so the location points at the offending key. */
class Locator {
  constructor(
    private readonly doc: Document,
    private readonly lineCounter: LineCounter,
  ) {}

  locateOffset(offset: number): SourceLocation {
    const position = this.lineCounter.linePos(offset);
    return { line: position.line, column: position.col };
  }

  locate(path: DiagnosticPath): SourceLocation | undefined {
    let node: unknown = this.doc.contents;
    let offset: number | undefined = isNode(node) ? node.range?.[0] : undefined;
    for (const segment of path) {
      if (isMap(node)) {
        const pair = node.items.find(
          (item) => isScalar(item.key) && String(item.key.value) === String(segment),
        );
        if (!pair) {
          break;
        }
        offset = isScalar(pair.key) ? pair.key.range?.[0] : offset;
        node = pair.value;
      } else if (isSeq(node) && typeof segment === "number") {
        const item: unknown = node.items[segment];
        if (!isNode(item)) {
          break;
        }
        node = item;
        offset = item.range?.[0];
      } else {
        break;
      }
    }
    if (offset === undefined) {
      return undefined;
    }
    const position = this.lineCounter.linePos(offset);
    return { line: position.line, column: position.col };
  }
}
