import { type KeyboardEvent, useState } from "react";
import { harnessLabel, humanize, KIND_LABEL } from "../lib/format.ts";
import { type HistoryItem, walked } from "../lib/history.ts";
import { layoutMap, NODE_H, NODE_W } from "../lib/map-layout.ts";
import type { RunGraph } from "../run-data.ts";
import type { BrowserRunStatus } from "../types.ts";

const ICON: Record<string, string> = {
  agent: "◆",
  command: "›_",
  "task.next": "☰",
  "task.complete": "✓",
  end: "■",
};

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function describeAction(action: { kind: string; target?: string }): string {
  if (action.kind === "goto") return `go to ${humanize(action.target ?? "")}`;
  if (action.kind === "pause") return "pause and wait for you";
  return "retry this step";
}

export interface RunOverlay {
  status: BrowserRunStatus;
  items: readonly HistoryItem[];
  onShowInHistory: (stepId: string) => void;
}

/**
 * Read-only map: the authored steps in order. On a run it shows the path taken so far; in the
 * editor it offers to open a step's form instead.
 */
export function RunMap({
  graph,
  graphError,
  run,
  caption,
  onEdit,
}: {
  graph: RunGraph | null;
  graphError: string | null;
  run?: RunOverlay;
  caption: string;
  onEdit?: (stepId: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const items = run?.items ?? [];
  if (!graph)
    return (
      <section className="pane" aria-label="Map">
        {graphError ? (
          <p role="alert">The map couldn't be drawn: {graphError}</p>
        ) : (
          <p className="muted" role="status">
            <span className="spinner" aria-hidden="true" /> Drawing the map…
          </p>
        )}
      </section>
    );
  const layout = layoutMap(graph);
  const { counts, edges } = walked(items);
  const finished = run?.status.run.status === "completed" || run?.status.run.status === "stopped";
  const current = !run || finished ? null : run.status.run.cursorStepId;
  // A live revision can remove the selected step. Keep a real node in the tab order.
  const focus =
    selected && Object.hasOwn(graph.specs, selected)
      ? selected
      : current && Object.hasOwn(graph.specs, current)
        ? current
        : graph.start;
  const focusSpec = graph.specs[focus];
  const order = graph.steps.map((step) => step.id);

  const keys = (event: KeyboardEvent<SVGGElement>, id: string) => {
    const index = order.indexOf(id);
    let next: string | undefined;
    if (event.key === "ArrowDown") next = order[index + 1];
    else if (event.key === "ArrowUp") next = order[index - 1];
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelected(id);
      return;
    } else return;
    event.preventDefault();
    if (!next) return;
    setSelected(next);
    (
      event.currentTarget.ownerSVGElement?.querySelector(
        `[data-step="${CSS.escape(next)}"]`,
      ) as SVGGElement | null
    )?.focus();
  };

  return (
    <div className="map-split">
      <section className="pane map-pane" aria-label="Workflow map">
        <div className="pane-head">
          <h2>Map</h2>
          <span className="muted small">{caption}</span>
        </div>
        <div className="map-scroll">
          {/* biome-ignore lint/a11y/useSemanticElements: an SVG drawing groups its focusable nodes. */}
          <svg
            className="map"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="group"
            aria-label={`Workflow map with ${graph.steps.length} steps. Use the arrow keys to move between steps.`}
          >
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" className="arrowhead" />
              </marker>
              <marker
                id="arrow-walked"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" className="arrowhead walked" />
              </marker>
            </defs>
            {layout.edges.map((edge) => {
              const count = edge.keys.reduce((sum, key) => sum + (edges.get(key) ?? 0), 0);
              const hot = focus === edge.from || focus === edge.to;
              return (
                <g
                  key={`${edge.from}>${edge.to}`}
                  className={`edge ${count ? "walked" : items.length ? "unwalked" : ""} ${edge.shared ? "shared" : ""} ${hot ? "hot" : ""}`}
                >
                  <path d={edge.path} markerEnd={`url(#${count ? "arrow-walked" : "arrow"})`} />
                  <text x={edge.labelX} y={edge.labelY} textAnchor={edge.anchor}>
                    {clip(edge.label, 22)}
                    {count > 1 ? ` ×${count}` : ""}
                  </text>
                </g>
              );
            })}
            {graph.steps.map((step, index) => {
              const y = layout.y(index);
              const ran = counts.get(step.id) ?? 0;
              const ports = layout.ports.get(step.id) ?? [];
              const isCurrent = step.id === current;
              const label = `${humanize(step.id)}, ${KIND_LABEL[step.kind] ?? step.kind}${
                ran
                  ? `, ran ${ran} time${ran === 1 ? "" : "s"}`
                  : items.length
                    ? ", not run yet"
                    : ""
              }${isCurrent ? ", current step" : ""}${step.id === graph.start ? ", start" : ""}`;
              return (
                // biome-ignore lint/a11y/useSemanticElements: SVG has no button element; the node is a focusable selection target.
                <g
                  key={step.id}
                  data-step={step.id}
                  className={`node k-${step.kind.replace(".", "-")} ${ran ? "ran" : ""} ${isCurrent ? "current" : ""} ${focus === step.id ? "selected" : ""}`}
                  transform={`translate(${layout.x},${y})`}
                  tabIndex={focus === step.id ? 0 : -1}
                  role="button"
                  aria-pressed={focus === step.id}
                  aria-label={label}
                  onClick={() => setSelected(step.id)}
                  onKeyDown={(event) => keys(event, step.id)}
                >
                  <rect width={NODE_W} height={NODE_H} rx="8" />
                  <text x="14" y="25" className="icon">
                    {ICON[step.kind] ?? "•"}
                  </text>
                  <text x="40" y="25" className="name">
                    {clip(humanize(step.id), 24)}
                  </text>
                  <text x="40" y="43" className="meta">
                    {clip(step.detail, 30)}
                  </text>
                  {ran ? (
                    <text x={NODE_W - 12} y="25" textAnchor="end" className="count">
                      ×{ran}
                    </text>
                  ) : null}
                  {step.id === graph.start ? (
                    <text x={NODE_W - 12} y="-6" textAnchor="end" className="start">
                      start
                    </text>
                  ) : null}
                  {ports.length ? (
                    <text x="40" y="62" className="ports">
                      {clip(ports.map((p) => `${p.outcome} → ${p.action}`).join(" · "), 32)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>
        <p className="legend muted small">
          {run ? (
            <>
              <span>
                <i className="lg walked" /> taken in this run
              </span>
              <span>
                <i className="lg" /> not taken
              </span>
            </>
          ) : null}
          <span>
            <i className="lg shared" /> shared rule
          </span>
          <span>“blocked → pause” lists results that pause or retry</span>
          <span>Technical failures pause unless a rule says otherwise.</span>
        </p>
      </section>
      <section className="pane map-detail" aria-labelledby="map-step-title">
        <div className="kind-label">
          {KIND_LABEL[focusSpec?.kind ?? ""] ?? "Step"}
          {focus === current ? " · current step" : ""}
        </div>
        <h2 id="map-step-title">{humanize(focus)}</h2>
        {focusSpec?.kind === "agent" ? (
          <p className="muted mono">
            {harnessLabel(focusSpec.harness)} · {focusSpec.model ?? "default model"}
          </p>
        ) : focusSpec?.kind === "command" ? (
          <p className="muted mono">$ {focusSpec.argv.join(" ")}</p>
        ) : null}
        {run ? (
          <p>
            {counts.get(focus)
              ? `Ran ${counts.get(focus)} time${counts.get(focus) === 1 ? "" : "s"} in this run.`
              : "Has not run in this run yet."}
          </p>
        ) : null}
        {(graph.transitions[focus] ?? []).filter((t) => !t.outcome.startsWith("system.")).length ? (
          <>
            <h3 className="h3">What happens after each result</h3>
            <ul className="rules">
              {(graph.transitions[focus] ?? [])
                .filter((t) => !t.outcome.startsWith("system."))
                .map((t) => (
                  <li key={t.outcome}>
                    <code>{t.outcome}</code> → {describeAction(t.action)}
                    {t.source.level !== "step" ? (
                      <span className="muted"> (shared rule)</span>
                    ) : null}
                  </li>
                ))}
            </ul>
          </>
        ) : null}
        {run && counts.get(focus) ? (
          <button type="button" className="btn btn-sm" onClick={() => run.onShowInHistory(focus)}>
            Show latest result in history
          </button>
        ) : null}
        {onEdit ? (
          <button type="button" className="btn btn-sm" onClick={() => onEdit(focus)}>
            Edit {humanize(focus)}
          </button>
        ) : null}
      </section>
    </div>
  );
}
