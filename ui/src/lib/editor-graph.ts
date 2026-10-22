import type { BrowserDraft } from "../types.ts";
import { humanize } from "./format.ts";
import { type Doc, describeAction, outcomeRows, ruleToAction } from "./workflow-edit.ts";

export const GRAPH_NODE_WIDTH = 256;
export const GRAPH_KIND: Record<string, string> = {
  agent: "Agent",
  command: "Command",
  "task.next": "Next task",
  "task.complete": "Complete task",
  end: "Finish",
};

/** Own edits are visible immediately; inherited routes come only from the current daemon check. */
export function graphRows(doc: Doc, checked: BrowserDraft | null, id: string) {
  return outcomeRows(doc, checked, id).map((row) => {
    const action = row.own ? ruleToAction(row.own) : row.effective?.action;
    const target = action?.kind === "goto" ? action.target : null;
    const missing = target !== null ? !Object.hasOwn(doc.steps, target) : row.missing;
    return {
      outcome: row.outcome,
      target,
      missing,
      inherited: !row.own,
      label: missing
        ? target
          ? `Missing: ${humanize(target)}`
          : "Choose destination"
        : action
          ? describeAction(doc, action)
          : "Shared rule · check needed",
    };
  });
}

export interface GraphMeasure {
  height: number;
  ports: number[];
}
export interface GraphItem {
  id: string;
  targets: (string | null)[];
}

/** Breadth-first columns keep branches together. Back edges and self loops use outside lanes.
 * Authored order breaks ties; layout never edits the document or its execution order. */
export function layoutEditorGraph(
  items: GraphItem[],
  start: string,
  measured: Record<string, GraphMeasure>,
) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const levels = new Map<string, number>();
  const visit = (root: string, level: number) => {
    if (!byId.has(root) || levels.has(root)) return;
    const queue = [root];
    levels.set(root, level);
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i] as string;
      for (const to of byId.get(id)?.targets ?? []) {
        if (!to || !byId.has(to) || levels.has(to)) continue;
        levels.set(to, (levels.get(id) ?? 0) + 1);
        queue.push(to);
      }
    }
  };
  visit(start, 0);
  for (const item of items) visit(item.id, 0);
  const bottoms = new Map<number, number>();
  const nodes = items.map((item) => {
    const level = levels.get(item.id) ?? 0;
    const height = measured[item.id]?.height ?? 170;
    const y = bottoms.get(level) ?? 36;
    bottoms.set(level, y + height + 48);
    // Return lanes extend up to 54px left of a node; keep them inside the canvas with padding.
    return { ...item, x: 80 + level * (GRAPH_NODE_WIDTH + 112), y, height, level };
  });
  const positions = new Map(nodes.map((node) => [node.id, node]));
  const bottom = Math.max(180, ...bottoms.values());
  let lane = 0;
  const edges = nodes.flatMap((node) =>
    node.targets.flatMap((to, port) => {
      const dest = to ? positions.get(to) : null;
      if (!dest) return [];
      const sx = node.x + GRAPH_NODE_WIDTH;
      const sy = node.y + (measured[node.id]?.ports[port] ?? 100 + port * 35);
      const tx = dest.x;
      const ty = dest.y + 32;
      const back = dest.level <= node.level;
      const skip = dest.level > node.level + 1;
      let path: string;
      if (back || skip) {
        const ly = bottom + 24 + lane++ * 20;
        const offset = 24 + (port % 4) * 10;
        path = `M ${sx} ${sy} H ${sx + offset} V ${ly} H ${tx - offset} V ${ty} H ${tx - 4}`;
      } else {
        const bend = sx + 42 + (port % 3) * 14;
        path = `M ${sx} ${sy} C ${bend} ${sy}, ${bend} ${ty}, ${tx - 4} ${ty}`;
      }
      return [{ from: node.id, to: dest.id, port, path, back }];
    }),
  );
  return {
    nodes,
    edges,
    width: Math.max(360, ...nodes.map((node) => node.x + GRAPH_NODE_WIDTH + 64)),
    height: bottom + (lane ? lane * 20 + 48 : 0),
  };
}
