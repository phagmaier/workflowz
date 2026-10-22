import { useState } from "react";
import { saveEffortPreferences, useEffortPreferences } from "../editor-preferences.ts";
import { EFFORT_SUGGESTIONS, rememberEffort } from "../lib/effort-preferences.ts";
import { harnessLabel } from "../lib/format.ts";
import { HARNESSES } from "../lib/workflow-edit.ts";
import { type Ctx, errAttrs, FieldProblems, fieldId } from "./editor-fields.tsx";

export function EffortField({
  ctx,
  stepId,
  harness,
  value,
  onValue,
}: {
  ctx: Ctx;
  stepId: string;
  harness: string;
  value: string;
  onValue: (value: string) => void;
}) {
  const { prefs, persistent } = useEffortPreferences();
  const [feedback, setFeedback] = useState("");
  const id = fieldId(stepId, "reasoning_effort");
  const savedDefault = (prefs.defaults[harness] ?? "").trim();
  const suggestions = [
    ...new Set([
      ...(EFFORT_SUGGESTIONS[harness] ?? []),
      ...(prefs.recent[harness] ?? []),
      savedDefault,
      value,
    ]),
  ].filter(Boolean);
  return (
    <div className="block effort-field">
      <label htmlFor={id}>Reasoning effort</label>
      <input
        id={id}
        list={`${id}-options`}
        value={value}
        placeholder="Harness default"
        {...errAttrs(ctx, stepId, "reasoning_effort")}
        onChange={(event) => onValue(event.target.value.trim())}
        onBlur={() => saveEffortPreferences(rememberEffort(prefs, harness, value))}
      />
      <datalist id={`${id}-options`}>
        {suggestions.map((effort) => (
          <option key={effort} value={effort} />
        ))}
      </datalist>
      <FieldProblems ctx={ctx} stepId={stepId} field="reasoning_effort" />
      <span className="hint">
        {harness === "opencode"
          ? "A variant supported by this provider/model. Leave empty for its default."
          : "Empty uses the harness default."}
      </span>
      {savedDefault !== value ? (
        <button type="button" className="link small" onClick={() => onValue(savedDefault)}>
          Use my {harnessLabel(harness)} default{savedDefault ? ` (${savedDefault})` : ""}
        </button>
      ) : null}
      <details className="effort-defaults">
        <summary>Effort defaults</summary>
        <p className="hint">
          Used for new agent steps in this browser. Empty lets each harness choose. Changing these
          leaves existing steps as they are.
        </p>
        {HARNESSES.map((h) => (
          <div className="block" key={h}>
            <label htmlFor={`${id}-default-${h}`}>{harnessLabel(h)} default effort</label>
            <input
              id={`${id}-default-${h}`}
              list={`${id}-default-options-${h}`}
              value={prefs.defaults[h] ?? ""}
              placeholder="Harness default"
              onChange={(event) => {
                saveEffortPreferences({
                  ...prefs,
                  defaults: { ...prefs.defaults, [h]: event.target.value },
                });
                setFeedback("Effort defaults saved in this browser.");
              }}
              onBlur={() =>
                saveEffortPreferences(rememberEffort(prefs, h, prefs.defaults[h] ?? ""))
              }
            />
            <datalist id={`${id}-default-options-${h}`}>
              {[...new Set([...(EFFORT_SUGGESTIONS[h] ?? []), ...(prefs.recent[h] ?? [])])].map(
                (effort) => (
                  <option key={effort} value={effort} />
                ),
              )}
            </datalist>
          </div>
        ))}
        <span className="hint" role="status">
          {persistent
            ? feedback
            : "This browser could not save preferences. They are kept for this tab."}
        </span>
      </details>
    </div>
  );
}
