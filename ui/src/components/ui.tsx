import { useCallback, useState } from "react";
import { STATUS } from "../lib/run-copy.ts";
import type { RunStatus } from "../types.ts";

export function StatusChip({ status }: { status: RunStatus }) {
  const { label, tone } = STATUS[status];
  return <span className={`chip chip-${tone}`}>{label}</span>;
}

export type FeedbackState = { kind: "pending" | "ok" | "error" | "unknown"; text: string } | null;

/** Result text shown right beside the control that caused it. */
export function Feedback({ value, id }: { value: FeedbackState; id?: string }) {
  if (!value) return <span id={id} className="fb" role="status" aria-live="polite" />;
  const alert = value.kind === "error" || value.kind === "unknown";
  return (
    <span
      id={id}
      className={`fb fb-${value.kind}`}
      role={alert ? "alert" : "status"}
      aria-live={alert ? "assertive" : "polite"}
    >
      {value.kind === "pending" ? <span className="spinner" aria-hidden="true" /> : null}
      {value.text}
    </span>
  );
}

// Typed text and choices outlive refreshes, status changes and tab switches for this page load.
const drafts = new Map<string, string>();
export const rememberDraft = (key: string, value: string) => drafts.set(key, value);
export const forgetDraft = (key: string) => drafts.delete(key);
export function useDraft(key: string, initial = ""): [string, (value: string) => void] {
  const [value, setValue] = useState(() => drafts.get(key) ?? initial);
  const update = useCallback(
    (next: string) => {
      drafts.set(key, next);
      setValue(next);
    },
    [key],
  );
  return [value, update];
}
