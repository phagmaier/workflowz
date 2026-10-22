import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { harnessLabel, humanize, KIND_LABEL } from "../lib/format.ts";
import {
  describeAction,
  HARNESSES,
  KIND_HINT,
  moveStep,
  outcomeRows,
  removeStep,
  renameStep,
  replaceStep,
  ruleToAction,
  stepSummary,
} from "../lib/workflow-edit.ts";
import type { WorkflowStep } from "../types.ts";
import {
  type Ctx,
  errAttrs,
  FieldProblems,
  fieldId,
  focusField,
  lines,
  TYPING,
  useLocalText,
} from "./editor-fields.tsx";
import { AddResult, RuleRow } from "./StepRules.tsx";

// ---------- step fields ----------

function LinesField({
  ctx,
  stepId,
  field,
  label,
  hint,
  value,
  commit,
  rows = 3,
  mono = true,
  separator = "\n",
}: {
  ctx: Ctx;
  stepId: string;
  field: string;
  label: string;
  hint?: ReactNode;
  value: readonly string[];
  commit: (list: string[]) => WorkflowStep;
  rows?: number;
  mono?: boolean;
  separator?: string;
}) {
  const [text, setText] = useLocalText(value.join(separator));
  const id = fieldId(stepId, field);
  return (
    <div className="block">
      <label htmlFor={id}>{label}</label>
      {separator === "\n" ? (
        <textarea
          id={id}
          rows={rows}
          className={mono ? "mono" : ""}
          value={text}
          {...errAttrs(ctx, stepId, field)}
          onChange={(event) => {
            setText(event.target.value);
            const list = lines(event.target.value);
            ctx.session.edit((d) => replaceStep(d, stepId, commit(list)), TYPING);
          }}
        />
      ) : (
        <input
          id={id}
          value={text}
          {...errAttrs(ctx, stepId, field)}
          onChange={(event) => {
            setText(event.target.value);
            const list = event.target.value
              .split(separator.trim())
              .map((s) => s.trim())
              .filter(Boolean);
            ctx.session.edit((d) => replaceStep(d, stepId, commit(list)), TYPING);
          }}
        />
      )}
      <FieldProblems ctx={ctx} stepId={stepId} field={field} />
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

function TextField({
  ctx,
  stepId,
  field,
  label,
  value,
  placeholder,
  onValue,
  mono = false,
  numeric = false,
}: {
  ctx: Ctx;
  stepId: string;
  field: string;
  label: string;
  value: string;
  placeholder?: string;
  onValue: (value: string) => WorkflowStep | null;
  mono?: boolean;
  numeric?: boolean;
}) {
  const [text, setText] = useLocalText(value);
  const id = fieldId(stepId, field);
  const bad = numeric && text.trim() !== "" && !/^\d+$/.test(text.trim());
  return (
    <div className="block">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={text}
        className={mono ? "mono" : ""}
        inputMode={numeric ? "numeric" : undefined}
        placeholder={placeholder}
        {...errAttrs(ctx, stepId, field)}
        onChange={(event) => {
          setText(event.target.value);
          const next = onValue(event.target.value);
          if (next) ctx.session.edit((d) => replaceStep(d, stepId, next), TYPING);
        }}
      />
      {bad ? (
        <span className="field-err">Enter a whole number of seconds, or leave it empty.</span>
      ) : null}
      <FieldProblems ctx={ctx} stepId={stepId} field={field} />
    </div>
  );
}

/** Returns a copy with `key` set, or removed when `value` is undefined or an empty list. */
function withField<T extends WorkflowStep>(step: T, key: string, value: unknown): T {
  const next = structuredClone(step) as Record<string, unknown>;
  if (value === undefined || (Array.isArray(value) && !value.length)) delete next[key];
  else next[key] = value;
  return next as T;
}
const seconds = (text: string) =>
  text.trim() === "" ? undefined : /^\d+$/.test(text.trim()) ? Number(text) : text;

function AgentFields({
  ctx,
  stepId,
  step,
}: {
  ctx: Ctx;
  stepId: string;
  step: Extract<WorkflowStep, { kind: "agent" }>;
}) {
  const { session } = ctx;
  const set = (key: string, value: unknown, delay = 0) =>
    session.edit((d) => replaceStep(d, stepId, withField(step, key, value)), delay);
  const fromFile = step.prompt_file !== undefined;
  const harnesses = HARNESSES.includes(step.harness as (typeof HARNESSES)[number])
    ? HARNESSES
    : [...HARNESSES, step.harness];
  return (
    <>
      <div className="grid2">
        <div className="block">
          <label htmlFor={fieldId(stepId, "harness")}>Agent</label>
          <select
            id={fieldId(stepId, "harness")}
            value={step.harness}
            {...errAttrs(ctx, stepId, "harness")}
            onChange={(event) => set("harness", event.target.value)}
          >
            {harnesses.map((h) => (
              <option key={h} value={h}>
                {harnessLabel(h)}
              </option>
            ))}
          </select>
          <FieldProblems ctx={ctx} stepId={stepId} field="harness" />
        </div>
        <TextField
          ctx={ctx}
          stepId={stepId}
          field="model"
          label="Model"
          value={step.model ?? ""}
          placeholder="The agent's default model"
          mono
          onValue={(value) => withField(step, "model", value.trim() || undefined)}
        />
        <TextField
          ctx={ctx}
          stepId={stepId}
          field="reasoning_effort"
          label="Reasoning effort"
          value={step.reasoning_effort ?? ""}
          placeholder="Agent default"
          onValue={(value) => withField(step, "reasoning_effort", value.trim() || undefined)}
        />
        <div className="block">
          <label htmlFor={fieldId(stepId, "session")}>Conversation</label>
          <select
            id={fieldId(stepId, "session")}
            value={step.session}
            onChange={(event) => set("session", event.target.value)}
          >
            <option value="fresh">Start a new conversation</option>
            <option value="resume">Continue this agent's previous conversation for the task</option>
          </select>
        </div>
      </div>
      <p className="perm">
        Agent steps run with <strong>unrestricted permissions</strong>: the agent can read and
        change any file your user can access. The run page lists the exact mode before you start.
      </p>
      <fieldset className="inline-choice">
        <legend>Prompt</legend>
        <label>
          <input
            type="radio"
            name={`${stepId}-prompt-source`}
            checked={!fromFile}
            onChange={() =>
              session.edit((d) =>
                replaceStep(
                  d,
                  stepId,
                  withField(withField(step, "prompt_file", undefined), "prompt", ""),
                ),
              )
            }
          />{" "}
          Write it here
        </label>
        <label>
          <input
            type="radio"
            name={`${stepId}-prompt-source`}
            checked={fromFile}
            onChange={() =>
              session.edit((d) =>
                replaceStep(
                  d,
                  stepId,
                  withField(withField(step, "prompt", undefined), "prompt_file", ""),
                ),
              )
            }
          />{" "}
          Read it from a file
        </label>
      </fieldset>
      {fromFile ? (
        <TextField
          key="file"
          ctx={ctx}
          stepId={stepId}
          field="prompt_file"
          label="Prompt file (relative to the project folder)"
          value={step.prompt_file ?? ""}
          mono
          onValue={(value) => withField(step, "prompt_file", value)}
        />
      ) : (
        <div className="block">
          <label htmlFor={fieldId(stepId, "prompt")} className="sr-only">
            Prompt text
          </label>
          <textarea
            id={fieldId(stepId, "prompt")}
            rows={7}
            value={step.prompt ?? ""}
            placeholder="Describe the work. Use {{task.text}} for the current task."
            {...errAttrs(ctx, stepId, "prompt")}
            onChange={(event) => set("prompt", event.target.value, TYPING)}
          />
          <FieldProblems ctx={ctx} stepId={stepId} field="prompt" />
          <span className="hint">
            You can use <code>{"{{task.text}}"}</code>, <code>{"{{task.id}}"}</code>,{" "}
            <code>{"{{project.root}}"}</code> and <code>{"{{reports.<step>.summary}}"}</code>.
          </span>
        </div>
      )}
    </>
  );
}

function CommandFields({
  ctx,
  stepId,
  step,
}: {
  ctx: Ctx;
  stepId: string;
  step: Extract<WorkflowStep, { kind: "command" }>;
}) {
  const shown = step.argv.map((a) => (a === "" || /\s/.test(a) ? JSON.stringify(a) : a)).join(" ");
  return (
    <LinesField
      ctx={ctx}
      stepId={stepId}
      field="argv"
      label="Command — one argument per line"
      rows={4}
      value={step.argv}
      commit={(list) => ({ ...step, argv: list })}
      hint={
        <>
          {shown ? (
            <>
              Runs as <code>{shown}</code>.{" "}
            </>
          ) : null}
          There is no shell, so pipes and <code>&amp;&amp;</code> aren't interpreted. For a shell,
          put <code>sh</code>, <code>-c</code> and the script on separate lines.
        </>
      }
    />
  );
}

function Advanced({
  ctx,
  stepId,
  step,
}: {
  ctx: Ctx;
  stepId: string;
  step: Exclude<WorkflowStep, { kind: "end" }>;
}) {
  const otherAgents = Object.entries(ctx.doc.steps).filter(
    ([id, s]) => s.kind === "agent" && id !== stepId,
  );
  const parts: string[] = [];
  if (step.kind === "agent" || step.kind === "command") parts.push("working folder", "time limit");
  if (step.kind === "agent") parts.push("instruction files", "reports");
  if (step.kind === "command") parts.push("environment");
  parts.push("tags");
  return (
    <details className="disclosure">
      <summary>
        Advanced <span className="muted">— {parts.join(", ")}</span>
      </summary>
      {step.kind === "agent" || step.kind === "command" ? (
        <div className="grid2">
          <TextField
            ctx={ctx}
            stepId={stepId}
            field="cwd"
            label="Working folder"
            value={step.cwd ?? ""}
            placeholder="The project folder"
            mono
            onValue={(value) => withField(step, "cwd", value.trim() || undefined)}
          />
          <TextField
            ctx={ctx}
            stepId={stepId}
            field="timeout_seconds"
            label="Time limit (seconds)"
            value={step.timeout_seconds?.toString() ?? ""}
            placeholder="No limit"
            numeric
            onValue={(value) => withField(step, "timeout_seconds", seconds(value))}
          />
        </div>
      ) : null}
      {step.kind === "agent" ? (
        <>
          <LinesField
            ctx={ctx}
            stepId={stepId}
            field="instructions"
            label="Instruction files for this step — one per line"
            value={step.instructions ?? []}
            commit={(list) => withField(step, "instructions", list)}
            hint="Given to the agent after the project's instruction files."
          />
          {otherAgents.length ? (
            <fieldset className="checks" id={fieldId(stepId, "context")} tabIndex={-1}>
              <legend>Give the agent the latest report from</legend>
              {otherAgents.map(([id]) => {
                const included = step.context?.include_reports?.includes(id) ?? false;
                return (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={() => {
                        const current = step.context?.include_reports ?? [];
                        const next = included ? current.filter((r) => r !== id) : [...current, id];
                        ctx.session.edit((d) =>
                          replaceStep(
                            d,
                            stepId,
                            withField(
                              step,
                              "context",
                              next.length ? { include_reports: next } : undefined,
                            ),
                          ),
                        );
                      }}
                    />{" "}
                    {humanize(id)}
                  </label>
                );
              })}
              <FieldProblems ctx={ctx} stepId={stepId} field="context" />
            </fieldset>
          ) : null}
        </>
      ) : null}
      {step.kind === "command" ? (
        <LinesField
          ctx={ctx}
          stepId={stepId}
          field="env"
          label="Environment variables — NAME=value, one per line"
          value={
            typeof step.env === "string"
              ? String(step.env).split("\n")
              : Object.entries(step.env ?? {}).map(([k, v]) => `${k}=${v}`)
          }
          commit={(list) => {
            // Keep incomplete input in the draft and let the daemon reject its shape. Silently
            // dropping a line without '=' would enable Save for a different environment.
            if (list.some((line) => line.trim() && line.indexOf("=") <= 0))
              return withField(step, "env", list.join("\n"));
            const env: Record<string, string> = {};
            for (const line of list) {
              const at = line.indexOf("=");
              if (at > 0) env[line.slice(0, at).trim()] = line.slice(at + 1);
            }
            return withField(step, "env", Object.keys(env).length ? env : undefined);
          }}
          hint="Saved in the workflow as plain text. Don't put secrets here."
        />
      ) : null}
      <LinesField
        ctx={ctx}
        stepId={stepId}
        field="tags"
        label="Tags — comma separated"
        value={step.tags ?? []}
        separator=", "
        commit={(list) => withField(step, "tags", list)}
      />
      <span className="hint">Shared rules can apply to every step with a tag.</span>
    </details>
  );
}

// ---------- the selected step ----------

function StepHead({
  ctx,
  stepId,
  index,
  count,
  onRenamed,
  onDeleted,
}: {
  ctx: Ctx;
  stepId: string;
  index: number;
  count: number;
  onRenamed: (id: string) => void;
  onDeleted: () => void;
}) {
  const step = ctx.doc.steps[stepId] as WorkflowStep;
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(humanize(stepId));
  const [error, setError] = useState<string | null>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const references = Object.entries(ctx.doc.steps).filter(
    ([id, s]) =>
      id !== stepId &&
      s.kind !== "end" &&
      Object.values(s.on ?? {}).some((r) => "goto" in r && r.goto === stepId),
  );
  const rename = (event: FormEvent) => {
    event.preventDefault();
    const result = renameStep(ctx.doc, stepId, name);
    if (typeof result === "string") return setError(result);
    setRenaming(false);
    setError(null);
    if (result.id !== stepId) {
      ctx.session.edit(() => result.doc);
      onRenamed(result.id);
    }
    focusField("step-title");
  };
  return (
    <div className="form-head">
      <div className="form-title">
        <div className="kind-label">{KIND_LABEL[step.kind]}</div>
        {renaming ? (
          <form className="row" onSubmit={rename}>
            <label className="sr-only" htmlFor="rename-step">
              Step name
            </label>
            <input
              id="rename-step"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button type="submit" className="btn btn-sm">
              Rename
            </button>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => {
                setRenaming(false);
                renameButton.current?.focus();
              }}
            >
              Cancel
            </button>
            {error ? <span className="field-err">{error}</span> : null}
          </form>
        ) : (
          <h2 tabIndex={-1} id="step-title">
            {humanize(stepId)}
            {ctx.doc.start === stepId ? <span className="tag">runs first</span> : null}
          </h2>
        )}
        <p className="summary">{stepSummary(step)}</p>
        <p className="muted small">
          {KIND_HINT[step.kind]} <span className="mono">id: {stepId}</span>
        </p>
      </div>
      <div className="form-tools">
        <button
          type="button"
          className="btn-icon"
          aria-label={`Move ${humanize(stepId)} up`}
          disabled={index === 0}
          onClick={() => ctx.session.edit((d) => moveStep(d, stepId, -1))}
        >
          ↑
        </button>
        <button
          type="button"
          className="btn-icon"
          aria-label={`Move ${humanize(stepId)} down`}
          disabled={index === count - 1}
          onClick={() => ctx.session.edit((d) => moveStep(d, stepId, 1))}
        >
          ↓
        </button>

        <button
          type="button"
          className="btn btn-sm btn-quiet"
          ref={renameButton}
          onClick={() => {
            setName(humanize(stepId));
            setRenaming(true);
            focusField("rename-step");
          }}
        >
          Rename
        </button>
        <button
          type="button"
          className="btn btn-sm btn-quiet btn-danger-text"
          onClick={() => setConfirmDelete(true)}
        >
          Delete
        </button>
      </div>
      {confirmDelete ? (
        <div className="confirm">
          <p>
            <strong>Delete {humanize(stepId)}?</strong>{" "}
            {references.length
              ? `${references.map(([id]) => humanize(id)).join(", ")} ${references.length === 1 ? "goes" : "go"} here and will need a new destination.`
              : "No other step goes here."}
          </p>
          <div className="row">
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => {
                ctx.session.edit((d) => removeStep(d, stepId));
                onDeleted();
              }}
            >
              Delete step
            </button>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => setConfirmDelete(false)}
            >
              Keep it
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export interface Origin {
  from: string;
  outcome: string;
  to: string;
}

export function StepForm({
  ctx,
  stepId,
  origin,
  onSelect,
  onCreated,
}: {
  ctx: Ctx;
  stepId: string;
  origin: Origin | null;
  onSelect: (id: string, focus?: boolean) => void;
  onCreated: (origin: Origin) => void;
}) {
  const { doc, state } = ctx;
  const step = doc.steps[stepId];
  const ids = Object.keys(doc.steps);
  if (!step) return null;
  const rows = outcomeRows(doc, state.draft, stepId);
  const failures = outcomeRows(doc, state.draft, stepId, true);
  const anyFailure = failures.find((f) => f.outcome === "system.error");
  const failureSummary = anyFailure?.own
    ? describeAction(doc, ruleToAction(anyFailure.own))
    : anyFailure?.effective
      ? describeAction(doc, anyFailure.effective.action)
      : "Pause and wait for me";
  const ownFailures = failures.filter((f) => f.own).length;
  return (
    <>
      {origin && doc.steps[origin.from] ? (
        <p className="result-line">
          New step, reached when {humanize(origin.from)}'s outcome is <code>{origin.outcome}</code>.{" "}
          <button type="button" className="link" onClick={() => onSelect(origin.from, true)}>
            Back to {humanize(origin.from)}
          </button>
        </p>
      ) : null}
      <StepHead
        key={stepId}
        ctx={ctx}
        stepId={stepId}
        index={ids.indexOf(stepId)}
        count={ids.length}
        onRenamed={(id) => onSelect(id)}
        onDeleted={() =>
          onSelect(ids[ids.indexOf(stepId) + 1] ?? ids[ids.indexOf(stepId) - 1] ?? "", true)
        }
      />
      {step.kind === "agent" ? <AgentFields ctx={ctx} stepId={stepId} step={step} /> : null}
      {step.kind === "command" ? <CommandFields ctx={ctx} stepId={stepId} step={step} /> : null}
      {step.kind === "end" ? (
        <TextField
          ctx={ctx}
          stepId={stepId}
          field="label"
          label="Finish label"
          value={step.label ?? ""}
          placeholder="Shown when the run completes"
          onValue={(value) => (value.trim() ? { kind: "end", label: value } : { kind: "end" })}
        />
      ) : null}
      {step.kind === "end" ? (
        <p className="hint">A finish step ends the run as completed. Nothing runs after it.</p>
      ) : (
        <section aria-labelledby={`${stepId}-next`}>
          <h3 className="h3" id={`${stepId}-next`} tabIndex={-1}>
            Outcomes
          </h3>
          <p className="hint">
            {step.kind === "agent"
              ? "The agent reports one of these outcomes. Choose where the run goes after each."
              : "Choose where the run goes after each outcome."}
          </p>
          <ul className="rules-edit">
            {rows.map((row) => (
              <RuleRow
                key={row.outcome}
                ctx={ctx}
                stepId={stepId}
                row={row}
                failure={false}
                onNewStep={(to) => onCreated({ from: stepId, outcome: row.outcome, to })}
              />
            ))}
          </ul>
          {step.kind === "agent" ? <AddResult ctx={ctx} stepId={stepId} /> : null}
          {failures.length ? (
            <details className="disclosure" open={failures.some((f) => f.missing) || undefined}>
              <summary>
                If something goes wrong technically{" "}
                <span className="muted">
                  — {failureSummary}
                  {ownFailures ? ` · ${ownFailures} set on this step` : ""}
                </span>
              </summary>
              <p className="hint">
                Technical failures are crashes, time limits or missing reports — not outcomes the{" "}
                {step.kind === "agent" ? "agent" : "command"} chose. Specific failure rules take
                priority over “any technical failure” at every level. If no exact or fallback rule
                applies, the run pauses.
              </p>
              <ul className="rules-edit">
                {failures.map((row) => (
                  <RuleRow
                    key={row.outcome}
                    ctx={ctx}
                    stepId={stepId}
                    row={row}
                    failure
                    onNewStep={() => {}}
                  />
                ))}
              </ul>
            </details>
          ) : null}
          <Advanced key={`adv-${stepId}`} ctx={ctx} stepId={stepId} step={step} />
        </section>
      )}
    </>
  );
}
