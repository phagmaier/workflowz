import { type FormEvent, useRef, useState } from "react";
import type { Session, SessionState } from "../editor-session.ts";
import { humanize, KIND_LABEL, plural } from "../lib/format.ts";
import {
  addStep,
  type Doc,
  KINDS,
  moveStep,
  type Problem,
  routeLines,
  type StepKind,
  stepMeta,
} from "../lib/workflow-edit.ts";
import type { WorkflowStep } from "../types.ts";
import { type Ctx, focusField, useFocusOnMount } from "./editor-fields.tsx";
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
}: {
  ctx: Ctx;
  after: string | null;
  onAdded: (id: string, text: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<StepKind>("agent");
  const nameInput = useFocusOnMount<HTMLInputElement>();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const added = addStep(ctx.doc, kind, name.trim() || KIND_LABEL[kind] || kind, after);
    ctx.session.edit(() => added.doc);
    onAdded(
      added.id,
      `Added “${humanize(added.id)}”${after ? ` after “${humanize(after)}”` : ""}. Connect it by choosing it as a destination for another step's result.`,
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
              {KIND_LABEL[k]}
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

function AddStep({
  ctx,
  after,
  onAdded,
}: {
  ctx: Ctx;
  after: string | null;
  onAdded: (id: string, text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  if (open)
    return (
      <AddStepForm
        ctx={ctx}
        after={after}
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
      ＋ Add step{after ? ` after “${humanize(after)}”` : ""}
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
      : ((doc.start && Object.hasOwn(doc.steps, doc.start) ? doc.start : ids[0]) ?? null);
  const [moved, setMoved] = useState("");
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [added, setAdded] = useState<FeedbackState>(null);
  const ctx: Ctx = { session, doc, state, problems };
  const narrow = () => window.matchMedia("(max-width: 900px)").matches;
  const select = (id: string, focus = false) => {
    if (!id) return;
    // A step created from a destination shows where it came from until another step is chosen.
    if (origin?.to !== id) setOrigin(null);
    session.set({ selected: id });
    if (focus || narrow()) focusField("step-title");
  };
  const stepErrors = (id: string) =>
    problems.filter((p) => p.stepId === id && p.severity === "error").length;
  return (
    <div className="three">
      <section className="pane pane-list" aria-labelledby="steps-title">
        <div className="pane-head">
          <h2 id="steps-title">Steps</h2>
          <span className="muted">{ids.length}</span>
        </div>
        <p className="hint" id="reorder-help">
          Alt + ↑ / ↓ on a step moves it in the list. This does not change execution order.
        </p>
        <span className="sr-only" role="status">
          {moved}
        </span>
        <ol className="step-list">
          {ids.map((id, index) => {
            const step = doc.steps[id] as WorkflowStep;
            const errors = stepErrors(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  className={`step-item ${id === selected ? "current" : ""}`}
                  aria-current={id === selected ? "true" : undefined}
                  aria-describedby="reorder-help"
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  onKeyDown={(event) => {
                    if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
                    event.preventDefault();
                    const delta = event.key === "ArrowUp" ? -1 : 1;
                    const to = index + delta;
                    if (to < 0 || to >= ids.length) return;
                    session.edit((d) => moveStep(d, id, delta));
                    setMoved(`${humanize(id)} moved to position ${to + 1} of ${ids.length}.`);
                  }}
                  onClick={() => select(id)}
                >
                  <span className="num">{index + 1}</span>
                  <span className={`step-icon k-${step.kind.replace(".", "-")}`} aria-hidden="true">
                    {ICON[step.kind]}
                  </span>
                  <span className="step-text">
                    <span className="step-name">
                      {humanize(id)}
                      {doc.start === id ? <span className="tag">first</span> : null}
                    </span>
                    <span className="step-meta">{stepMeta(step)}</span>
                  </span>
                  {errors ? (
                    <span className="err-dot" title={`${errors} to fix`}>
                      !<span className="sr-only"> {errors} to fix</span>
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
        {ids.length === 0 ? <p className="muted">No steps yet. Add the first one.</p> : null}
        <AddStep
          ctx={ctx}
          after={selected}
          onAdded={(id, text) => {
            setAdded({ kind: "ok", text });
            setOrigin(null);
            session.set({ selected: id });
            if (narrow()) focusField("step-title");
          }}
        />
        <Feedback value={added} />
      </section>
      <section className="pane pane-form" aria-label="Selected step">
        {selected ? (
          <StepForm
            key={selected}
            ctx={ctx}
            stepId={selected}
            origin={origin && origin.to === selected ? origin : null}
            onSelect={select}
            onCreated={(created) => {
              setOrigin(created);
              session.set({ selected: created.to });
              focusField("step-title");
            }}
          />
        ) : (
          <p className="muted">Add a step to begin.</p>
        )}
      </section>
      <aside className="pane pane-side" aria-labelledby="checks-title">
        <Checks ctx={ctx} onSelect={select} />
        <div className="block">
          <label htmlFor="start-step" className="h3">
            Runs first
          </label>
          <select
            id="start-step"
            value={Object.hasOwn(doc.steps, doc.start) ? doc.start : ""}
            onChange={(event) => session.edit((d) => ({ ...d, start: event.target.value }))}
          >
            {!Object.hasOwn(doc.steps, doc.start) ? (
              <option value="">Choose the first step…</option>
            ) : null}
            {ids.map((id) => (
              <option key={id} value={id}>
                {humanize(id)}
              </option>
            ))}
          </select>
        </div>
        <p className="hint">
          Steps run one at a time. After each step, its result decides what runs next — the order of
          this list is only for reading.
        </p>
        {selected && doc.steps[selected]?.kind !== "end" ? (
          <>
            <h3 className="h3">{humanize(selected)} at a glance</h3>
            <ul className="route-lines">
              {routeLines(doc, state.draft, selected).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        ) : null}
      </aside>
    </div>
  );
}

function Checks({ ctx, onSelect }: { ctx: Ctx; onSelect: (id: string, focus?: boolean) => void }) {
  const { state, problems } = ctx;
  const pending = state.checking || state.checked !== state.generation;
  const errors = problems.filter((p) => p.severity === "error").length;
  const open = (p: Problem) => {
    if (p.code === "unbounded_cycle" || p.place === "rules") {
      window.location.hash = window.location.hash.replace(
        /(\/(project|rules|yaml|map))?$/,
        "/rules",
      );
      window.setTimeout(() => focusField("limits-title"), 0);
    } else if (p.stepId) {
      onSelect(p.stepId);
      const field = p.outcome
        ? `f-${p.stepId}-${p.outcome}`
        : p.field
          ? `f-${p.stepId}-${p.field}`
          : "step-title";
      focusField(field);
    } else if (p.place === "start") focusField("start-step");
    else if (p.place === "project" || p.place === "name")
      window.location.hash = window.location.hash.replace(
        /(\/(project|rules|yaml|map))?$/,
        "/project",
      );
    else
      window.location.hash = window.location.hash.replace(
        /(\/(project|rules|yaml|map))?$/,
        "/yaml",
      );
  };
  return (
    <>
      <div className="pane-head">
        <h2 id="checks-title">Checks</h2>
        <span className="muted small" role="status">
          {pending ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Checking…
            </>
          ) : state.checkError ? (
            "Not checked"
          ) : errors ? (
            `${errors} to fix`
          ) : problems.length ? (
            plural(problems.length, "warning")
          ) : (
            "All good"
          )}
        </span>
      </div>
      {state.checkError ? (
        <p className="inline-alert">
          {state.checkError}{" "}
          <button type="button" className="link" onClick={() => ctx.session.recheck()}>
            Check again
          </button>
        </p>
      ) : null}
      {problems.length ? (
        <ul className="problems">
          {problems.map((p) => (
            <li key={`${p.code}:${p.stepId}:${p.field}:${p.outcome}:${p.text}`}>
              <button type="button" className={`problem ${p.severity}`} onClick={() => open(p)}>
                <span aria-hidden="true">{p.severity === "error" ? "●" : "○"}</span>
                <span>
                  {p.severity === "warning" ? <span className="sr-only">Warning: </span> : null}
                  {p.text}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {problems.length && state.draft && !state.draft.document && !pending ? (
        <p className="hint">More checks run once these are fixed.</p>
      ) : !problems.length && !pending && !state.checkError ? (
        <p className="muted">No problems found.</p>
      ) : null}
    </>
  );
}
