/**
 * Read-only workflow map layout: steps in authored order top to bottom, the next-step route as a
 * straight line, forward skips routed on the right and loops back on the left. Pure geometry.
 */
import type { ResolvedTransition } from "../types.ts";
import { edgeKey } from "./history.ts";

export const NODE_W = 232;
export const NODE_H = 72;
const GAP = 50;
const LANE = 16;
const MARGIN = 24;

export interface MapStep {
  id: string;
  kind: string;
  detail: string;
}
export interface MapGraph {
  start: string;
  steps: readonly MapStep[];
  transitions: Readonly<Record<string, readonly ResolvedTransition[]>>;
}
export interface MapEdge {
  from: string;
  to: string;
  label: string;
  /** History keys this edge represents (see edgeKey). */
  keys: string[];
  shared: boolean;
  side: "straight" | "right" | "left";
  lane: number;
  path: string;
  labelX: number;
  labelY: number;
  anchor: "start" | "middle" | "end";
}
export interface MapPort {
  outcome: string;
  action: "pause" | "retry";
}
export interface MapLayout {
  width: number;
  height: number;
  x: number;
  y: (index: number) => number;
  edges: MapEdge[];
  ports: Map<string, MapPort[]>;
}

export function layoutMap(graph: MapGraph): MapLayout {
  const index = new Map(graph.steps.map((step, i) => [step.id, i]));
  const ports = new Map<string, MapPort[]>();
  const grouped = new Map<
    string,
    Omit<MapEdge, "side" | "lane" | "path" | "labelX" | "labelY" | "anchor">
  >();
  for (const step of graph.steps) {
    const list: MapPort[] = [];
    for (const transition of graph.transitions[step.id] ?? []) {
      const system = transition.outcome.startsWith("system.");
      const { action } = transition;
      if (action.kind === "goto") {
        if (!index.has(action.target)) continue;
        // Unconfigured technical failures pause by default; only routed ones are drawn.
        const label = system ? "technical failure" : transition.outcome;
        const existing = grouped.get(`${step.id}>${action.target}`);
        const key = edgeKey(step.id, transition.outcome, action.target);
        if (existing) {
          if (!existing.keys.includes(key)) existing.keys.push(key);
          if (!existing.label.split(", ").includes(label)) existing.label += `, ${label}`;
          existing.shared &&= transition.source.level !== "step";
        } else
          grouped.set(`${step.id}>${action.target}`, {
            from: step.id,
            to: action.target,
            label,
            keys: [key],
            shared: !system && transition.source.level !== "step",
          });
      } else if (!system) list.push({ outcome: transition.outcome, action: action.kind });
    }
    ports.set(step.id, list);
  }

  const edges: MapEdge[] = [...grouped.values()].map((edge) => {
    const from = index.get(edge.from) ?? 0;
    const to = index.get(edge.to) ?? 0;
    return {
      ...edge,
      side: to === from + 1 ? "straight" : to > from ? "right" : "left",
      lane: 0,
      path: "",
      labelX: 0,
      labelY: 0,
      anchor: "start",
    };
  });
  const span = (edge: MapEdge) => Math.abs((index.get(edge.to) ?? 0) - (index.get(edge.from) ?? 0));
  for (const side of ["right", "left"] as const) {
    const list = edges.filter((edge) => edge.side === side).sort((a, b) => span(a) - span(b));
    list.forEach((edge, lane) => {
      edge.lane = lane;
    });
  }
  const right = edges.filter((edge) => edge.side === "right").length;
  const left = edges.filter((edge) => edge.side === "left").length;
  // Outcome labels sit beside the node on the side their route leaves from.
  const x = MARGIN + (left ? 110 : 20) + left * LANE;
  const width = x + NODE_W + 40 + right * LANE + MARGIN + (right ? 90 : 0);
  const y = (i: number) => MARGIN + i * (NODE_H + GAP);
  const height = Math.max(1, graph.steps.length) * (NODE_H + GAP) - GAP + MARGIN * 2;

  for (const edge of edges) {
    const sy = y(index.get(edge.from) ?? 0);
    const ty = y(index.get(edge.to) ?? 0);
    const mid = x + NODE_W / 2;
    if (edge.side === "straight") {
      edge.path = `M${mid},${sy + NODE_H} L${mid},${ty - 3}`;
      edge.labelX = mid + 8;
      edge.labelY = sy + NODE_H + GAP / 2 + 4;
      continue;
    }
    // Stagger where edges leave a node so several routes from one step stay distinguishable.
    const offset = ((edge.lane % 3) - 1) * 9;
    const a = sy + NODE_H / 2 + offset;
    const b = ty + NODE_H / 2 + offset / 2;
    if (edge.side === "right") {
      const lx = x + NODE_W + 28 + edge.lane * LANE;
      const down = b > a ? 1 : -1;
      edge.path = `M${x + NODE_W},${a} H${lx - 6} Q${lx},${a} ${lx},${a + 6 * down} V${b - 6 * down} Q${lx},${b} ${lx - 6},${b} H${x + NODE_W + 3}`;
      edge.labelX = x + NODE_W + 6;
      edge.labelY = a - 4;
    } else {
      const lx = x - 28 - edge.lane * LANE;
      const up = b < a ? -1 : 1;
      edge.path = `M${x},${a} H${lx + 6} Q${lx},${a} ${lx},${a + 6 * up} V${b - 6 * up} Q${lx},${b} ${lx + 6},${b} H${x - 3}`;
      edge.labelX = x - 6;
      edge.labelY = a - 4;
      edge.anchor = "end";
    }
  }
  return { width, height, x, y, edges, ports };
}
