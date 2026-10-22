import { type FormEvent, useRef, useState } from "react";
import { effortPreferences } from "../editor-preferences.ts";
import type { Session, SessionState } from "../editor-session.ts";
import { GRAPH_KIND, graphRows } from "../lib/editor-graph.ts";
import { applyEffortDefaults } from "../lib/effort-preferences.ts";
import { humanize, KIND_LABEL } from "../lib/format.ts";
import {
  addStep,
  type Doc,
  KINDS,
  moveStep,
  type Problem,
  type StepKind,
  stepMeta,
} from "../lib/workflow-edit.ts";
import type { WorkflowStep } from "../types.ts";
import { type Ctx, fieldId, focusField, useFocusOnMount } from "./editor-fields.tsx";
import { type Origin, StepForm } from "./StepForm.tsx";
import { Feedback, type FeedbackState } from "./ui.tsx";

const ICON: Record<string, string> = {
  agent: "◆",
  command: "›_",
  "task.next": "☰",
  "task.complete": "✓",
  end: "■",
};
// ---------- the tab ----------

function AddStepForm({
  ctx,
  after,
  onAdded,
  onCancel,
  plain = false,
}: {
  ctx: Ctx;
  after: string | null;
  onAdded: (id: string, text: string) => void;
  onCancel: () => void;
  plain?: boolean;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<StepKind>("agent");
  const nameInput = useFocusOnMount<HTMLInputElement>();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const added = addStep(ctx.doc, kind, name.trim() || KIND_LABEL[kind] || kind, after);
    ctx.session.edit(() => applyEffortDefaults(added.doc, effortPreferences(), [added.id]));
    onAdded(
      added.id,
      `Added “${humanize(added.id)}”${after && !plain ? ` after “${humanize(after)}”` : ""}. Connect it by choosing it as a destination for another step's outcome.`,
    );
  };
  return (
    <form className="add-form" onSubmit={submit}>
      <div className="block">
        <label htmlFor="add-step-name">New step name</label>
        <input
          id="add-step-name"
          ref={nameInput}
          value={name}
          placeholder="e.g. Run tests"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="block">
        <label htmlFor="add-step-kind">Kind</label>
        <select
          id="add-step-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as StepKind)}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {plain ? GRAPH_KIND[k] : KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <button type="submit" className="btn btn-sm btn-primary">
          Add step
        </button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function AddStep({
  ctx,
  after,
  onAdded,
  plain = false,
}: {
  ctx: Ctx;
  after: string | null;
  onAdded: (id: string, text: string) => void;
  plain?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  if (open)
    return (
      <AddStepForm
        ctx={ctx}
        after={after}
        plain={plain}
        onAdded={(id, text) => {
          setOpen(false);
          onAdded(id, text);
        }}
        onCancel={() => {
          setOpen(false);
          queueMicrotask(() => toggle.current?.focus());
        }}
      />
    );
  return (
    <button
      type="button"
      ref={toggle}
      className="btn btn-sm add-step"
      onClick={() => setOpen(true)}
    >
      ＋ Add step{after && !plain ? ` after “${humanize(after)}”` : ""}
    </button>
  );
}

export function StepsTab({
  session,
  state,
  problems,
}: {
  session: Session;
  state: SessionState;
  problems: readonly Problem[];
}) {
  const doc = state.model as Doc;
  const ids = Object.keys(doc.steps);
  const selected =
    state.selected && Object.hasOwn(doc.steps, state.selected)
      ? state.selected
      : ((Object.hasOwn(doc.steps, doc.start) ? doc.start : ids[0]) ?? null);
  const [moved, setMoved] = useState("");
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [added, setAdded] = useState<FeedbackState>(null);
  const ctx: Ctx = { session, doc, state, problems };
  const select = (id: string, focus = false, field = "step-title") => {
    if (origin?.to !== id) setOrigin(null);
    session.set({ selected: id || null });
    if (!id) focusField("form-add-step");
    else if (focus || window.matchMedia("(max-width: 1100px)").matches) focusField(field);
  };
  return (
    <section className="form-workbench" aria-label="Form editor">
      <div className="form-toolbar">
        <div className="row">
          <span className="kind-label">{ids.length} steps</span>
          <label htmlFor="start-step">Runs first</label>
          <select
            id="start-step"
            value={Object.hasOwn(doc.steps, doc.start) ? doc.start : ""}
            onChange={(event) => session.edit((d) => ({ ...d, start: event.target.value }))}
          >
            {!Object.hasOwn(doc.steps, doc.start) ? (
              <option value="">Choose first step…</option>
            ) : null}
            {ids.map((id) => (
              <option key={id} value={id}>
                {humanize(id)}
              </option>
            ))}
          </select>
        </div>
        <span className="hint">Outcomes decide what runs next.</span>
      </div>
      <div className="form-body">
        <section className="form-steps" aria-labelledby="steps-title">
          <div className="form-table-head">
            <h2 id="steps-title">Steps</h2>
            <span className="hint">Select a step to configure it</span>
          </div>
          <p className="sr-only" id="reorder-help">
            Alt + ↑ / ↓ on a step moves it in the list. This does not change execution order.
          </p>
          <span className="sr-only" role="status">
            {moved}
          </span>
          <div className="form-table-scroll">
            <table className="form-steps-table">
              <caption className="sr-only">Workflow steps and their outcome connections</caption>
              <thead>
                <tr>
                  <th scope="col">Step</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Outcomes</th>
                </tr>
              </thead>
              <tbody>
                {ids.map((id, index) => {
                  const step = doc.steps[id] as WorkflowStep;
                  const errors = problems.filter(
                    (p) => p.stepId === id && p.severity === "error",
                  ).length;
                  const rows = graphRows(doc, session.current ? state.draft : null, id);
                  return (
                    <tr key={id} data-step={id} className={id === selected ? "current" : ""}>
                      <td>
                        <button
                          type="button"
                          id={`form-step-${id}`}
                          className="form-step-select"
                          aria-label={`Configure ${humanize(id)}`}
                          aria-current={id === selected ? "true" : undefined}
                          aria-controls="selected-step"
                          aria-describedby="reorder-help"
                          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                          onKeyDown={(event) => {
                            if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key))
                              return;
                            event.preventDefault();
                            const delta = event.key === "ArrowUp" ? -1 : 1;
                            const to = index + delta;
                            if (to < 0 || to >= ids.length) return;
                            session.edit((d) => moveStep(d, id, delta));
                            setMoved(
                              `${humanize(id)} moved to position ${to + 1} of ${ids.length}.`,
                            );
                          }}
                          onClick={() => select(id)}
                        >
                          <span
                            className={`step-icon k-${step.kind.replace(".", "-")}`}
                            aria-hidden="true"
                          >
                            {ICON[step.kind]}
                          </span>
                          <span className="form-step-name">
                            <strong>{humanize(id)}</strong>
                            <span className="step-meta">{stepMeta(step)}</span>
                            {doc.start === id ? <span className="tag">Start</span> : null}
                            {errors ? (
                              <span className="form-step-error">{errors} to fix</span>
                            ) : null}
                          </span>
                        </button>
                      </td>
                      <td>
                        <span className="form-kind">{GRAPH_KIND[step.kind]}</span>
                      </td>
                      <td>
                        {rows.length ? (
                          <ul className="form-outcomes">
                            {rows.map((row) => (
                              <li key={row.outcome}>
                                <button
                                  type="button"
                                  className={`table-outcome ${row.missing ? "missing" : ""}`}
                                  aria-label={`${humanize(id)}: ${row.outcome} → ${row.label}`}
                                  onClick={() => select(id, true, fieldId(id, row.outcome))}
                                >
                                  <code>{row.outcome}</code>
                                  <span>→ {row.label}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="hint">Workflow completes here</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!ids.length ? <p className="form-empty">No steps yet. Add the first one.</p> : null}
          <div className="form-add" id="form-add-step" tabIndex={-1}>
            <AddStep
              ctx={ctx}
              after={selected}
              plain
              onAdded={(id, text) => {
                setAdded({ kind: "ok", text });
                setOrigin(null);
                session.set({ selected: id });
                focusField("step-title");
              }}
            />
            <Feedback value={added} />
            <p className="hint">List order is for reading. Use Alt + ↑ / ↓ to reorder.</p>
          </div>
        </section>
        <section className="form-inspector" id="selected-step" aria-label="Selected step">
          <div className="form-inspector-bar">
            <span className="kind-label">Step settings</span>
            {selected ? (
              <button
                type="button"
                className="btn btn-sm btn-quiet"
                onClick={() => focusField(`form-step-${selected}`)}
              >
                Back to steps
              </button>
            ) : null}
          </div>
          <div className="form-inspector-content" key={selected ?? "empty"}>
            {selected ? (
              <StepForm
                key={selected}
                ctx={ctx}
                stepId={selected}
                origin={origin?.to === selected ? origin : null}
                onSelect={(id, focus) => select(id, focus)}
                onCreated={(created) => {
                  setOrigin(created);
                  session.set({ selected: created.to });
                  focusField("step-title");
                }}
              />
            ) : (
              <p className="muted">Add a step to begin.</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
