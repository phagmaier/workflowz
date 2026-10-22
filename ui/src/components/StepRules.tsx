import { type FormEvent, useState } from "react";
import { humanize, outcomeLabel } from "../lib/format.ts";
import {
  addOutcome,
  describeAction,
  hasSharedRule,
  OUTCOME_HELP,
  type OutcomeRow,
  removeOutcome,
  setRule,
  sourceLabel,
} from "../lib/workflow-edit.ts";
import type { WorkflowStep } from "../types.ts";
import { type Ctx, fieldId, focusField } from "./editor-fields.tsx";
import { RuleDestination } from "./RuleDestination.tsx";
import { Feedback, type FeedbackState } from "./ui.tsx";

export function RuleRow({
  ctx,
  stepId,
  row,
  failure,
  onNewStep,
}: {
  ctx: Ctx;
  stepId: string;
  row: OutcomeRow;
  failure: boolean;
  onNewStep: (id: string) => void;
}) {
  const { doc, session } = ctx;
  const step = doc.steps[stepId] as Exclude<WorkflowStep, { kind: "end" }>;
  const shared = hasSharedRule(doc, row.outcome);
  const inherited =
    !row.own && row.effective
      ? `Use ${row.effective.source.level === "built_in_pause" ? "the built-in rule" : "the shared rule"}: ${describeAction(doc, row.effective.action)}`
      : row.own
        ? shared
          ? "Use the shared rule instead"
          : failure
            ? "Use inherited or built-in rule"
            : null
        : shared && !row.missing
          ? "Use the shared rule"
          : failure
            ? "Use the default"
            : null;
  const id = fieldId(stepId, row.outcome);
  const help = failure ? null : step.kind === "agent" ? null : OUTCOME_HELP[row.outcome];
  return (
    <li className={`rule-row ${row.missing ? "missing" : ""}`}>
      <div className="rule-when">
        {failure ? (
          <span>
            {(row.outcome === "system.error"
              ? "any technical failure (fallback)"
              : outcomeLabel(row.outcome)
            ).replace(/^./, (c) => c.toUpperCase())}
          </span>
        ) : (
          <code>{row.outcome}</code>
        )}
        {help ? <span className="muted small">{help}</span> : null}
      </div>
      <span className="rule-arrow" aria-hidden="true">
        →
      </span>
      <div className="rule-then">
        <label className="sr-only" htmlFor={id}>
          {failure ? `If ${outcomeLabel(row.outcome)}` : `When the outcome is ${row.outcome}`}, then
        </label>
        <RuleDestination
          doc={doc}
          id={id}
          stepId={stepId}
          rule={row.own ?? null}
          inherited={inherited}
          invalid={row.missing}
          allowNew={!failure}
          onChange={(nextDoc, rule) =>
            session.edit(() => setRule(nextDoc, stepId, row.outcome, rule))
          }
          onNewStep={onNewStep}
        />
        {row.missing ? (
          <span className="field-err" id={`${id}-why`}>
            Not connected yet: when {humanize(stepId)} finishes with “{row.outcome}”, the run has
            nowhere to go. Choose a destination.
          </span>
        ) : !row.own && row.effective && row.effective.source.level !== "step" ? (
          <span className="hint rule-source">
            {sourceLabel(doc, row.effective.source)}
            {row.effective.viaSystemError ? " · via “any technical failure”" : ""}
          </span>
        ) : null}
      </div>
      {step.kind === "agent" && !failure ? (
        <button
          type="button"
          className="btn-icon"
          aria-label={`Remove outcome ${row.outcome}`}
          title={`Remove outcome ${row.outcome}`}
          disabled={step.outcomes.length <= 1}
          onClick={() => session.edit((d) => removeOutcome(d, stepId, row.outcome))}
        >
          ✕
        </button>
      ) : (
        <span />
      )}
    </li>
  );
}

export function AddResult({ ctx, stepId }: { ctx: Ctx; stepId: string }) {
  const [name, setName] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const id = fieldId(stepId, "new-outcome");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = addOutcome(ctx.doc, stepId, name);
    if (typeof result === "string") return setFeedback({ kind: "error", text: result });
    ctx.session.edit(() => result);
    const added = name
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    setName("");
    setFeedback({ kind: "ok", text: `Added “${added}”. Choose what happens after it.` });
    focusField(fieldId(stepId, added));
  };
  return (
    <form className="row add-result" onSubmit={submit}>
      <label className="sr-only" htmlFor={id}>
        New outcome name
      </label>
      <input
        id={id}
        value={name}
        placeholder="New outcome, e.g. needs_info"
        onChange={(event) => {
          setName(event.target.value);
          setFeedback(null);
        }}
      />
      <button type="submit" className="btn btn-sm">
        Add outcome
      </button>
      <Feedback value={feedback} />
      <span className="hint full">The agent is told these names and must report one of them.</span>
    </form>
  );
}
