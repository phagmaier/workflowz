import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nodesOnCycles, reachableFrom } from "./graph.js";

function edgesOf(pairs: [string, string][]): Map<string, Set<string>> {
  const edges = new Map<string, Set<string>>();
  for (const [from, to] of pairs) {
    const set = edges.get(from) ?? new Set<string>();
    set.add(to);
    edges.set(from, set);
    if (!edges.has(to)) {
      edges.set(to, new Set<string>());
    }
  }
  return edges;
}

describe("graph analysis", () => {
  it("collects everything reachable from the start node", () => {
    const edges = edgesOf([
      ["a", "b"],
      ["b", "c"],
      ["x", "y"],
    ]);
    assert.deepEqual([...reachableFrom("a", edges)].sort(), ["a", "b", "c"]);
  });

  it("finds nodes on cycles, including self-loops, and ignores acyclic nodes", () => {
    const edges = edgesOf([
      ["a", "b"],
      ["b", "a"],
      ["b", "c"],
      ["c", "c"],
      ["d", "a"],
    ]);
    assert.deepEqual([...nodesOnCycles(edges)].sort(), ["a", "b", "c"]);
  });

  it("reports no cycles in a dag", () => {
    assert.deepEqual(
      [
        ...nodesOnCycles(
          edgesOf([
            ["a", "b"],
            ["a", "c"],
            ["b", "c"],
          ]),
        ),
      ],
      [],
    );
  });
});
