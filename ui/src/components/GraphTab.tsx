import { useLayoutEffect, useRef, useState } from "react";
import type { Session, SessionState } from "../editor-session.ts";
import {
  GRAPH_KIND,
  GRAPH_NODE_WIDTH,
  type GraphMeasure,
  type GraphRoute,
  type GraphRow,
  graphRows,
  incomingRoutes,
  layoutEditorGraph,
  technicalRoutes,
} from "../lib/editor-graph.ts";
import { humanize } from "../lib/format.ts";
import { type Doc, type Problem, stepMeta } from "../lib/workflow-edit.ts";
import { type Ctx, fieldId, focusField } from "./editor-fields.tsx";
import { type Origin, StepForm } from "./StepForm.tsx";
import { AddStep } from "./StepsTab.tsx";

export function GraphTab({
  session,
  state,
  problems,
}: {
  session: Session;
  state: SessionState;
  problems: readonly Problem[];
}) {
  const doc = state.model as Doc;
  const ctx: Ctx = { session, state, doc, problems };
  const selected =
    state.selected && Object.hasOwn(doc.steps, state.selected) ? state.selected : null;
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [feedback, setFeedback] = useState("");
  const [scale, setScale] = useState(1);
  const [measured, setMeasured] = useState<Record<string, GraphMeasure>>({});
  const canvas = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLElement>(null);
  const rows = new Map(
    Object.keys(doc.steps).map((id) => [
      id,
      graphRows(doc, session.current ? state.draft : null, id),
    ]),
  );
  const layout = layoutEditorGraph(
    [...rows].map(([id, outcomes]) => ({ id, targets: outcomes.map((r) => r.target) })),
    doc.start,
    measured,
  );
  const incoming = selected ? incomingRoutes(rows, selected) : [];
  // Technical-failure routes aren't drawn, but Reached from must still list them.
  const technical = selected
    ? technicalRoutes(doc, session.current ? state.draft : null, selected)
    : [];
  const linked = new Set([
    ...incoming.map((route) => route.from),
    ...(selected ? (rows.get(selected) ?? []).map((row) => row.target) : []),
  ]);

  // Measure real wrapped text, including long labels, instead of clipping node content.
  // biome-ignore lint/correctness/useExhaustiveDependencies: new nodes need observing after model edits.
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const measure = () => {
      const next: Record<string, GraphMeasure> = {};
      for (const node of element.querySelectorAll<HTMLElement>("[data-node]")) {
        const id = node.dataset.node as string;
        next[id] = {
          height: node.offsetHeight,
          ports: [...node.querySelectorAll<HTMLElement>(".graph-outcome")].map(
            (port) => port.offsetTop + port.offsetHeight / 2,
          ),
        };
      }
      setMeasured((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const node of element.querySelectorAll("[data-node]")) observer.observe(node);
    return () => observer.disconnect();
  }, [doc, state.draft]);

  // Zooming or fitting keeps the selected step in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scale moves the node within the viewport.
  useLayoutEffect(() => {
    if (selected)
      document
        .getElementById(`node-${selected}`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected, scale]);

  const select = (id: string, focus = true, field = "step-title") => {
    session.set({ selected: id || null });
    if (origin?.to !== id) setOrigin(null);
    if (focus && id) focusField(field);
    if (!id) focusField("graph-add-step");
  };
  const fit = () => {
    const box = viewport.current;
    if (box) {
      setScale(
        Math.min(
          1,
          Math.max(
            0.35,
            Math.min(
              (box.clientWidth - 24) / layout.width,
              (box.clientHeight - 24) / layout.height,
            ),
          ),
        ),
      );
      box.scrollTo(0, 0);
    }
  };
  return (
    <section className="graph-workbench" aria-label="Graph editor">
      <div className="graph-toolbar">
        <div className="row">
          <span className="kind-label">{Object.keys(doc.steps).length} steps</span>
          <label htmlFor="start-step">Runs first</label>
          <select
            className="graph-start"
            id="start-step"
            value={Object.hasOwn(doc.steps, doc.start) ? doc.start : ""}
            onChange={(e) => session.edit((d) => ({ ...d, start: e.target.value }))}
          >
            {!Object.hasOwn(doc.steps, doc.start) ? (
              <option value="">Choose first step…</option>
            ) : null}
            {Object.keys(doc.steps).map((id) => (
              <option key={id} value={id}>
                {humanize(id)}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              fit();
              setFeedback("Layout tidied. Connections and execution order are unchanged.");
            }}
          >
            Tidy up
          </button>
          <button
            type="button"
            className="btn-icon"
            aria-label="Zoom out"
            disabled={scale <= 0.35}
            onClick={() => setScale(Math.max(0.35, scale - 0.15))}
          >
            −
          </button>
          <button type="button" className="btn btn-sm btn-quiet" onClick={fit}>
            Fit
          </button>
          <button
            type="button"
            className="btn-icon"
            aria-label="Zoom in"
            disabled={scale >= 1.5}
            onClick={() => setScale(Math.min(1.5, scale + 0.15))}
          >
            ＋
          </button>
          <span className="muted small">{Math.round(scale * 100)}%</span>
        </div>
      </div>
      <div className={`graph-body ${selected ? "has-selection" : ""}`}>
        <div className="graph-area">
          <section
            className="graph-scroll"
            ref={viewport}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: arrow-key scrolling is needed for this viewport.
            tabIndex={0}
            aria-label="Workflow graph"
            aria-describedby="graph-help"
          >
            <div style={{ width: layout.width * scale, height: layout.height * scale }}>
              <div
                className={`graph-canvas ${selected ? "focused" : ""}`}
                ref={canvas}
                style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}
              >
                <svg
                  className="graph-wires"
                  width={layout.width}
                  height={layout.height}
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="editor-arrow"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path className="graph-arrow" d="M 0 0 L 10 5 L 0 10 z" />
                    </marker>
                  </defs>
                  {layout.edges.map((edge) => (
                    <path
                      key={`${edge.from}:${edge.port}`}
                      data-edge={`${edge.from}:${edge.port}:${edge.to}`}
                      className={`graph-wire ${edge.back ? "loop" : ""} ${edge.from === selected || edge.to === selected ? "active" : ""}`}
                      d={edge.path}
                      markerEnd="url(#editor-arrow)"
                    />
                  ))}
                </svg>
                {layout.nodes.map((node) => {
                  const step = doc.steps[node.id];
                  if (!step) return null;
                  const outcomes = rows.get(node.id) ?? [];
                  const errors = problems.filter(
                    (p) => p.stepId === node.id && p.severity === "error",
                  ).length;
                  return (
                    <article
                      key={node.id}
                      data-node={node.id}
                      className={`graph-node ${node.id === selected ? "selected" : linked.has(node.id) ? "linked" : ""} ${errors ? "has-problem" : ""}`}
                      style={{ left: node.x, top: node.y, width: GRAPH_NODE_WIDTH }}
                      aria-label={`Step ${humanize(node.id)}`}
                    >
                      <button
                        id={`node-${node.id}`}
                        type="button"
                        className="graph-node-head"
                        aria-label={`Configure ${humanize(node.id)}`}
                        aria-pressed={node.id === selected}
                        onClick={() => select(node.id)}
                      >
                        <span className="graph-node-kind">
                          {GRAPH_KIND[step.kind]}{" "}
                          {doc.start === node.id ? <span className="tag">Start</span> : null}
                          {errors ? <span className="graph-issue">{errors} to fix</span> : null}
                        </span>
                        <strong>{humanize(node.id)}</strong>
                        <span className="graph-detail">{stepMeta(step)}</span>
                      </button>
                      {outcomes.length ? (
                        <div className="graph-outcomes">
                          <div className="graph-outcome-label">Outcomes</div>
                          {outcomes.map((row) => (
                            <button
                              key={row.outcome}
                              type="button"
                              className={`graph-outcome ${row.missing ? "missing" : ""}`}
                              aria-label={`${humanize(node.id)}: ${row.outcome} → ${row.label}`}
                              onClick={() => select(node.id, true, fieldId(node.id, row.outcome))}
                            >
                              <code>{row.outcome}</code>
                              <span className="graph-outcome-copy">
                                {row.label}
                                {row.inherited && !row.missing ? <small>Shared</small> : null}
                              </span>
                              <span className="graph-port" aria-hidden="true">
                                {row.missing ? "!" : "→"}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="graph-finish">Workflow completes here</p>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
          <div className="graph-add" id="graph-add-step" tabIndex={-1}>
            <AddStep
              ctx={ctx}
              after={selected}
              onAdded={(id, text) => {
                setFeedback(text);
                select(id);
              }}
              plain
            />
            <p id="graph-help" className="hint">
              Select a step to configure it, or an outcome to choose its destination. Layout is
              automatic.
            </p>
            <p className="hint" role="status">
              {feedback}
            </p>
          </div>
        </div>
        {selected ? (
          <section className="graph-inspector" aria-label="Selected step">
            <div className="graph-inspector-bar">
              <span className="kind-label">Step settings</span>
              <button
                type="button"
                className="btn btn-sm btn-quiet"
                onClick={() => {
                  session.set({ selected: null });
                  focusField(`node-${selected}`);
                }}
              >
                Close settings
              </button>
            </div>
            <StepRoutes
              doc={doc}
              stepId={selected}
              outgoing={rows.get(selected) ?? []}
              incoming={[...incoming, ...technical]}
              onFollow={(id) => select(id, true, "graph-routes")}
            />
            <StepForm
              key={`${state.opened}:${selected}`}
              ctx={ctx}
              stepId={selected}
              origin={origin?.to === selected ? origin : null}
              onSelect={select}
              onCreated={(created) => {
                setOrigin(created);
                session.set({ selected: created.to });
                focusField("step-title");
              }}
            />
          </section>
        ) : null}
      </div>
    </section>
  );
}

/** Readable routes for the selected step at any zoom; each step link moves the selection along it. */
function StepRoutes({
  doc,
  stepId,
  outgoing,
  incoming,
  onFollow,
}: {
  doc: Doc;
  stepId: string;
  outgoing: readonly GraphRow[];
  incoming: readonly GraphRoute[];
  onFollow: (id: string) => void;
}) {
  const step = (id: string) => (
    <button type="button" className="link" onClick={() => onFollow(id)}>
      {humanize(id)}
    </button>
  );
  return (
    <section className="graph-routes" aria-labelledby="graph-routes">
      <h3 className="h3" id="graph-routes" tabIndex={-1}>
        Routes
      </h3>
      <h4 className="kind-label" id="graph-routes-out">
        Leads to
      </h4>
      {outgoing.length ? (
        <ul aria-labelledby="graph-routes-out">
          {outgoing.map((row) => (
            <li key={row.outcome} className={`graph-route ${row.missing ? "missing" : ""}`}>
              <code className="graph-route-outcome">{row.outcome}</code>
              <span>
                {row.target && !row.missing ? step(row.target) : row.label}
                {/* Before the check, the label already says it's a shared rule. */}
                {row.inherited && row.target && !row.missing ? <small> · shared rule</small> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Nothing. The workflow completes here.</p>
      )}
      <h4 className="kind-label" id="graph-routes-in">
        Reached from
      </h4>
      {doc.start === stepId ? <p className="hint">The run starts here.</p> : null}
      {incoming.length ? (
        <ul aria-labelledby="graph-routes-in">
          {incoming.map((route) => (
            <li key={`${route.from}:${route.outcome}`} className="graph-route">
              <span>{step(route.from)}</span>
              <span>
                {route.technical ? (
                  <span className="graph-route-outcome">{route.outcome}</span>
                ) : (
                  <code className="graph-route-outcome">{route.outcome}</code>
                )}
                {route.inherited ? <small> · shared rule</small> : null}
                {route.technical ? <small> · not drawn in the graph</small> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : doc.start !== stepId ? (
        <p className="hint">No step leads here yet.</p>
      ) : null}
    </section>
  );
}
