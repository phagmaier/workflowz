import type { SessionState } from "../editor-session.ts";
import { humanize, plural } from "../lib/format.ts";
import { type Doc, stepSummary } from "../lib/workflow-edit.ts";

const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = Object.keys(a).sort(),
    right = Object.keys(b).sort();
  return (
    left.length === right.length &&
    left.every(
      (k, i) =>
        k === right[i] &&
        equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  );
};

export function revisionChanges(before: Doc, after: Doc): string[] {
  const changes: string[] = [];
  for (const [field, label] of [
    ["name", "Workflow name"],
    ["project", "Project settings"],
    ["tasks", "Task list"],
    ["start", "First step"],
    ["policies", "Shared rules"],
    ["defaults", "Workflow defaults"],
    ["limits", "Safety limits"],
  ] as const)
    if (!equal(before[field], after[field])) changes.push(`${label} changed.`);
  for (const [id, step] of Object.entries(before.steps)) {
    const next = after.steps[id];
    if (!next) changes.push(`${humanize(id)} removed.`);
    else if (!equal(step, next)) {
      const fields = [...new Set([...Object.keys(step), ...Object.keys(next)])].filter(
        (k) =>
          !equal(
            (step as unknown as Record<string, unknown>)[k],
            (next as unknown as Record<string, unknown>)[k],
          ),
      );
      changes.push(
        `${humanize(id)} changed: ${fields.map((f) => ({ on: "destinations", argv: "command", prompt: "prompt", prompt_file: "prompt file", kind: "step kind" })[f] ?? f.replaceAll("_", " ")).join(", ")}.`,
      );
    }
  }
  for (const [id, step] of Object.entries(after.steps))
    if (!before.steps[id]) changes.push(`${humanize(id)} added. ${stepSummary(step)}`);
  if (
    Object.keys(before.steps).join(",") !== Object.keys(after.steps).join(",") &&
    Object.keys(before.steps).length === Object.keys(after.steps).length &&
    Object.keys(before.steps).every((id) => after.steps[id])
  )
    changes.push("Step list reordered. Destinations determine execution order.");
  return changes;
}

export function RevisionChanges({ state }: { state: SessionState }) {
  const changes =
    state.originalModel && state.model && (state.mode !== "text" || state.draft?.document)
      ? revisionChanges(state.originalModel, state.model)
      : null;
  return (
    <details className="disclosure revision-changes">
      <summary>
        Changes against revision {state.run?.revisionId}
        {changes ? ` · ${plural(changes.length, "change")}` : ""}
      </summary>
      {changes?.length ? (
        <ul>
          {changes.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      ) : (
        <p className="hint">
          {changes
            ? state.text === state.run?.workflowText
              ? "The draft matches the run’s current definition."
              : "Only YAML formatting or comments changed."
            : "Fix the YAML to compare the workflow fields."}
        </p>
      )}
      <div className="source-compare">
        <section>
          <h3 className="h3">Run’s current revision</h3>
          <pre className="yaml">{state.run?.workflowText}</pre>
        </section>
        <section>
          <h3 className="h3">Your draft</h3>
          <pre className="yaml">{state.text}</pre>
        </section>
      </div>
    </details>
  );
}
