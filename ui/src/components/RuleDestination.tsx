import { useState } from "react";
import { effortPreferences } from "../editor-preferences.ts";
import { applyEffortDefaults } from "../lib/effort-preferences.ts";
import { KIND_LABEL } from "../lib/format.ts";
import {
  addStep,
  type Doc,
  destinationOptions,
  destKey,
  type Rule,
  type StepKind,
} from "../lib/workflow-edit.ts";
import { focusField, useFocusOnMount } from "./editor-fields.tsx";

/** Shared by step results, workflow defaults and policies. Changes stay in the draft. */
export function RuleDestination({
  doc,
  id,
  stepId = "",
  rule,
  inherited = null,
  invalid = false,
  allowNew = true,
  onChange,
  onNewStep,
}: {
  doc: Doc;
  id: string;
  stepId?: string;
  rule: Rule | null;
  inherited?: string | null;
  invalid?: boolean;
  allowNew?: boolean;
  onChange: (doc: Doc, rule: Rule | null) => void;
  onNewStep?: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const options = destinationOptions(doc, stepId, inherited, !allowNew);
  const value = rule ? destKey(rule) : inherited ? "inherit" : "";
  const change = (key: string) => {
    setAdding(key === "new");
    if (key === "new") return;
    if (key === "inherit") onChange(doc, null);
    else if (key === "pause") onChange(doc, { pause: true });
    else if (key === "retry") onChange(doc, { retry: { max_attempts: 2, backoff_seconds: 0 } });
    else if (key === "finish-new") {
      const added = addStep(doc, "end", "Done", Object.keys(doc.steps).at(-1) ?? null);
      onChange(added.doc, { goto: added.id });
    } else if (key.startsWith("goto:")) onChange(doc, { goto: key.slice(5) });
  };
  return (
    <>
      <select
        id={id}
        value={adding ? "new" : value}
        className={invalid ? "invalid" : ""}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-why` : undefined}
        onChange={(event) => change(event.target.value)}
      >
        {value === "" ? (
          <option value="" disabled>
            Choose what happens…
          </option>
        ) : null}
        {value.startsWith("goto:") && !options.some((o) => o.value === value) ? (
          <option value={value}>Missing step: {value.slice(5)}</option>
        ) : null}
        {options
          .filter((o) => o.group === null)
          .map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        {(["Continue", "Finish", "Other"] as const).map((group) => (
          <optgroup key={group} label={group}>
            {options
              .filter((o) => o.group === group)
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {rule && "retry" in rule ? (
        <Retry key={`${id}-retry`} id={id} rule={rule} onChange={(next) => onChange(doc, next)} />
      ) : null}
      {adding ? (
        <NewStep
          id={id}
          doc={doc}
          after={stepId || null}
          onDone={(added) => {
            setAdding(false);
            if (added) {
              onChange(added.doc, { goto: added.id });
              onNewStep?.(added.id);
            } else focusField(id);
          }}
        />
      ) : null}
    </>
  );
}

function Retry({
  id,
  rule,
  onChange,
}: {
  id: string;
  rule: Extract<Rule, { retry: unknown }>;
  onChange: (rule: Rule) => void;
}) {
  const [max, setMax] = useState(String(rule.retry.max_attempts));
  const [wait, setWait] = useState(String(rule.retry.backoff_seconds ?? 0));
  const commit = (runs: string, seconds: string) =>
    onChange({
      retry: {
        max_attempts: /^\d+$/.test(runs) ? Number(runs) : Number.NaN,
        backoff_seconds: /^\d+$/.test(seconds) ? Number(seconds) : Number.NaN,
      },
    });
  return (
    <div className="retry-fields">
      <div className="block">
        <label htmlFor={`${id}-max`}>Runs in total (2–100)</label>
        <input
          id={`${id}-max`}
          inputMode="numeric"
          value={max}
          onChange={(event) => {
            setMax(event.target.value);
            commit(event.target.value, wait);
          }}
        />
      </div>
      <div className="block">
        <label htmlFor={`${id}-wait`}>Wait between runs (seconds)</label>
        <input
          id={`${id}-wait`}
          inputMode="numeric"
          value={wait}
          onChange={(event) => {
            setWait(event.target.value);
            commit(max, event.target.value);
          }}
        />
      </div>
      <span className="hint">After the last run, the run pauses for you.</span>
    </div>
  );
}

function NewStep({
  id,
  doc,
  after,
  onDone,
}: {
  id: string;
  doc: Doc;
  after: string | null;
  onDone: (added: ReturnType<typeof addStep> | null) => void;
}) {
  const [name, setName] = useState("");
  const input = useFocusOnMount<HTMLInputElement>();
  return (
    <fieldset className="newstep">
      <legend>New destination step</legend>
      <div className="block">
        <label htmlFor={`${id}-new`}>Name</label>
        <input
          id={`${id}-new`}
          ref={input}
          value={name}
          placeholder="e.g. Write tests"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onDone(null);
            }
          }}
        />
      </div>
      <div className="row">
        <span className="muted small">Add as:</span>
        {(["agent", "command", "task.complete", "end"] as StepKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            className="btn btn-sm"
            onClick={() => {
              const added = addStep(doc, kind, name.trim() || KIND_LABEL[kind] || kind, after);
              onDone({
                ...added,
                doc: applyEffortDefaults(added.doc, effortPreferences(), [added.id]),
              });
            }}
          >
            {KIND_LABEL[kind]}
          </button>
        ))}
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </fieldset>
  );
}
