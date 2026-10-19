/**
 * Resolves `{{...}}` placeholders at run time (spec §3.4). Values come from the caller, and this
 * module only substitutes them. A placeholder with no value is an error, never an empty string.
 */
import {
  type PlaceholderRef,
  parsePlaceholder,
  scanPlaceholders,
} from "../contracts/interpolation.js";

export interface InterpolationValues {
  readonly task?:
    | { readonly id: string; readonly text: string; readonly index: number }
    | undefined;
  readonly projectRoot: string;
  readonly runId: string;
  readonly runCwd: string;
  /** stdout of the latest successful run of a command step, if there is one. */
  readonly commandStdout: (stepId: string) => string | undefined;
  /** A field of the latest explicitly referenced report for the current task. */
  readonly report: (stepId: string, field: "summary" | "issue" | "handoff") => string | undefined;
}

export class InterpolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InterpolationError";
  }
}

export function interpolate(template: string, values: InterpolationValues): string {
  const scanned = scanPlaceholders(template);
  const bad = scanned.find((placeholder) => placeholder.error !== undefined);
  if (bad?.error) {
    throw new InterpolationError(bad.error.message);
  }
  return template.replace(/\{\{([^{}]*)\}\}/g, (_match, inner: string) => {
    const parsed = parsePlaceholder(inner);
    if (!parsed.ref) {
      throw new InterpolationError(`unknown placeholder '${parsed.raw}'`);
    }
    const value = resolve(parsed.ref, values);
    if (value === undefined) {
      throw new InterpolationError(
        `placeholder '${parsed.raw}' has no value at this point in the run`,
      );
    }
    return value;
  });
}

function resolve(ref: PlaceholderRef, values: InterpolationValues): string | undefined {
  switch (ref.kind) {
    case "task": {
      const task = values.task;
      if (!task) {
        return undefined;
      }
      if (ref.field === "id") return task.id;
      if (ref.field === "text") return task.text;
      return String(task.index);
    }
    case "project":
      return values.projectRoot;
    case "run":
      return ref.field === "id" ? values.runId : values.runCwd;
    case "report":
      return values.report(ref.step, ref.field);
    case "command_output":
      return values.commandStdout(ref.step);
  }
}
