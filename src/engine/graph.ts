/**
 * Pure graph analysis over `goto` edges. Retries point back at their own step, but they are
 * bounded by `max_attempts`, so they are not counted as cycles.
 */

/** Returns the set of nodes reachable from `start` by following `edges`. */
export function reachableFrom(
  start: string,
  edges: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const seen = new Set<string>([start]);
  const stack = [start];
  while (stack.length > 0) {
    const node = stack.pop() as string;
    for (const next of edges.get(node) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

/**
 * Nodes that lie on a cycle: members of a strongly connected component with more than one node,
 * or with an edge to themselves. Uses Tarjan's algorithm; the graph is small, so it is recursive.
 */
export function nodesOnCycles(edges: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cyclic = new Set<string>();
  let counter = 0;

  const visit = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of edges.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node) ?? 0, index.get(next) ?? 0));
      }
    }

    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop() as string;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      const selfLoop = edges.get(node)?.has(node) ?? false;
      if (component.length > 1 || selfLoop) {
        for (const item of component) {
          cyclic.add(item);
        }
      }
    }
  };

  for (const node of edges.keys()) {
    if (!index.has(node)) {
      visit(node);
    }
  }
  return cyclic;
}
