import { useEffect, useRef, useState } from "react";
import type { Session, SessionState } from "../editor-session.ts";
import type { Doc, Problem } from "../lib/workflow-edit.ts";

export const TYPING = 400;
export const fieldId = (stepId: string, field: string) => `f-${stepId}-${field}`;

/** Moves focus to a field once the selected step's form has rendered. */
export function focusField(id: string, fallbackId?: string) {
  requestAnimationFrame(() => {
    const element =
      document.getElementById(id) ?? (fallbackId ? document.getElementById(fallbackId) : null);
    // Diagnostics can target fields inside Advanced or technical-failure disclosures.
    for (let parent = element?.parentElement; parent; parent = parent.parentElement)
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    element?.focus();
    element?.scrollIntoView({ block: "nearest" });
  });
}

export const lines = (text: string) => {
  const list = text.split("\n");
  while (list.length && list.at(-1)?.trim() === "") list.pop();
  return list;
};

/** Focuses the element when it first appears (an inline form that just opened). */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}

/** Text whose model value is derived (lists, numbers). Local text keeps the caret while typing. */
export function useLocalText(initial: string): [string, (value: string) => void] {
  const [text, setText] = useState(initial);
  return [text, setText];
}

export interface Ctx {
  session: Session;
  doc: Doc;
  state: SessionState;
  problems: readonly Problem[];
}

export function FieldProblems({ ctx, stepId, field }: { ctx: Ctx; stepId: string; field: string }) {
  const found = ctx.problems.filter((p) => p.stepId === stepId && p.field === field);
  if (!found.length) return null;
  return (
    <span className="field-err" id={`${fieldId(stepId, field)}-err`}>
      {found.map((p) => p.text.replace(/^[^:]+: /, "")).join(" ")}
    </span>
  );
}

export function errAttrs(ctx: Ctx, stepId: string, field: string) {
  const bad = ctx.problems.some(
    (p) => p.stepId === stepId && p.field === field && p.severity === "error",
  );
  return bad
    ? {
        "aria-invalid": true as const,
        "aria-describedby": `${fieldId(stepId, field)}-err`,
        className: "invalid",
      }
    : {};
}
