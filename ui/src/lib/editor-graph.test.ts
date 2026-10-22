import assert from "node:assert/strict";
import { test } from "node:test";
import { GRAPH_NODE_WIDTH, graphRows, layoutEditorGraph } from "./editor-graph.ts";
import { type Doc, exampleDoc } from "./workflow-edit.ts";

test("layout handles branches, joins, self loops, disconnected nodes and dangling routes without overlap", () => {
  const items = [
    { id: "start", targets: ["left", "right", "missing"] },
    { id: "left", targets: ["join", "left"] },
    { id: "right", targets: ["join"] },
    { id: "join", targets: ["start"] },
    { id: "isolated", targets: [] },
  ];
  const measured = {
    left: { height: 420, ports: [230, 370] },
    right: { height: 160, ports: [110] },
  };
  const layout = layoutEditorGraph(items, "start", measured);
  assert.equal(layout.nodes.length, 5);
  assert.equal(layout.edges.length, 6);
  assert.equal(layout.edges.filter((edge) => edge.back).length, 2);
  for (const a of layout.nodes)
    for (const b of layout.nodes) {
      if (a.id === b.id) continue;
      assert.ok(
        a.x + GRAPH_NODE_WIDTH <= b.x ||
          b.x + GRAPH_NODE_WIDTH <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y,
        `${a.id} overlaps ${b.id}`,
      );
    }
  for (const edge of layout.edges) assert.doesNotMatch(edge.path, /NaN|Infinity/);
  assert.deepEqual(layoutEditorGraph(items, "start", measured), layout, "Tidy is deterministic");
  assert.equal(layoutEditorGraph(items, "missing", measured).nodes.length, 5);
});

test("own routes and missing destinations render without requiring a valid compiled document", () => {
  const doc: Doc = exampleDoc("single", "Graph", "/tmp");
  const work = doc.steps.work;
  assert.ok(work?.kind === "agent");
  work.outcomes.push("needs_info");
  work.on = {
    complete: { goto: "gone" },
    blocked: { retry: { max_attempts: 2, backoff_seconds: 0 } },
  };
  const rows = graphRows(doc, null, "work");
  assert.deepEqual(
    rows.map((r) => [r.outcome, r.target, r.missing]),
    [
      ["complete", "gone", true],
      ["blocked", null, false],
      ["needs_info", null, true],
    ],
  );
  assert.match(rows[1]?.label ?? "", /Retry/);
  assert.deepEqual(graphRows(doc, null, "done"), []);
});

test("every return lane stays inside the canvas, including fourth and later outcome self loops", () => {
  const items = [
    {
      id: "start",
      targets: ["next", "start", "start", "start", "start", "start", "start", "start"],
    },
    { id: "next", targets: Array.from({ length: 8 }, () => "start") },
  ];
  const measure = { height: 420, ports: Array.from({ length: 8 }, (_, i) => 100 + i * 35) };
  const layout = layoutEditorGraph(items, "start", { start: measure, next: measure });
  const returns = layout.edges.filter((edge) => edge.back);
  assert.equal(returns.length, 15);
  for (const edge of returns) {
    for (const [, x] of edge.path.matchAll(/H (-?\d+)/g)) {
      assert.ok(Number(x) > 0 && Number(x) < layout.width, `${edge.from}:${edge.port} x=${x}`);
    }
    for (const [, y] of edge.path.matchAll(/V (-?\d+)/g)) {
      assert.ok(Number(y) > 0 && Number(y) < layout.height, `${edge.from}:${edge.port} y=${y}`);
    }
  }
});
