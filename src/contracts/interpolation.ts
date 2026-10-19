/**
 * Fixed placeholder grammar for `{{...}}` in workflow strings (spec §3.4).
 *
 * This is deliberately not a template language: there are no expressions, filters, loops, or
 * file reads. Every placeholder must match one of the whitelisted references below; anything
 * else is a validation error, never an empty string.
 */
import { isIdentifier } from "./identifiers.js";

export type PlaceholderRef =
  | { readonly kind: "task"; readonly field: "id" | "text" | "index" }
  | { readonly kind: "project"; readonly field: "root" }
  | { readonly kind: "run"; readonly field: "id" | "cwd" }
  | {
      readonly kind: "report";
      readonly step: string;
      readonly field: "summary" | "issue" | "handoff";
    }
  | { readonly kind: "command_output"; readonly step: string; readonly field: "stdout" };

export interface ScannedPlaceholder {
  readonly raw: string;
  readonly ref?: PlaceholderRef;
  readonly error?: {
    readonly code: "invalid_template" | "unknown_placeholder";
    readonly message: string;
  };
}

const PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g;
const TASK_FIELDS = new Set(["id", "text", "index"]);
const RUN_FIELDS = new Set(["id", "cwd"]);
const REPORT_FIELDS = new Set(["summary", "issue", "handoff"]);

/** Parses every placeholder in `text`. Returns an empty list when the text has none. */
export function scanPlaceholders(text: string): ScannedPlaceholder[] {
  if (text.includes("{{{") || text.includes("}}}")) {
    // Triple braces are ambiguous about which pair is the placeholder, so they are never accepted.
    return [
      {
        raw: text,
        error: {
          code: "invalid_template",
          message: "ambiguous '{{{' or '}}}'; write a single placeholder such as {{task.id}}",
        },
      },
    ];
  }
  const results: ScannedPlaceholder[] = [];
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    results.push(parsePlaceholder(match[1] ?? ""));
  }
  const withoutPlaceholders = text.replace(PLACEHOLDER_PATTERN, "");
  if (withoutPlaceholders.includes("{{") || withoutPlaceholders.includes("}}")) {
    results.push({
      raw: text,
      error: {
        code: "invalid_template",
        message: "unterminated or stray '{{' / '}}' — placeholders must look like {{task.id}}",
      },
    });
  }
  return results;
}

function parsePlaceholder(inner: string): ScannedPlaceholder {
  const raw = `{{${inner}}}`;
  const body = inner.trim();
  if (body.length === 0) {
    return { raw, error: { code: "invalid_template", message: "empty placeholder '{{}}'" } };
  }
  const segments = body.split(".");
  const [head, second, third, ...rest] = segments;
  const unknown = {
    raw,
    error: { code: "unknown_placeholder" as const, message: `unknown placeholder '${raw}'` },
  };

  if (head === "task" && segments.length === 2 && TASK_FIELDS.has(second ?? "")) {
    return { raw, ref: { kind: "task", field: second as "id" | "text" | "index" } };
  }
  if (head === "project" && segments.length === 2 && second === "root") {
    return { raw, ref: { kind: "project", field: "root" } };
  }
  if (head === "run" && segments.length === 2 && RUN_FIELDS.has(second ?? "")) {
    return { raw, ref: { kind: "run", field: second as "id" | "cwd" } };
  }
  if (head === "reports" && segments.length === 3 && rest.length === 0) {
    if (isIdentifier(second ?? "") && REPORT_FIELDS.has(third ?? "")) {
      return {
        raw,
        ref: {
          kind: "report",
          step: second as string,
          field: third as "summary" | "issue" | "handoff",
        },
      };
    }
    return unknown;
  }
  if (head === "steps" && segments.length === 3 && rest.length === 0) {
    if (isIdentifier(second ?? "") && third === "stdout") {
      return { raw, ref: { kind: "command_output", step: second as string, field: "stdout" } };
    }
    return unknown;
  }
  return unknown;
}
