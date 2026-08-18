import type { CanvasEdge } from "@archivemind/shared";

/** Threads — the authored narrative sequences a Workspace's photo↔photo edges
 *  draw (ADR 0048). Pure and deterministic, like everything in lib/layout.ts.
 *
 *  A thread is a connected component of asset↔asset edges that forms a SIMPLE
 *  PATH: every node has at most two edges and the component has exactly one
 *  more node than edges. A branching component is deliberately NOT offered —
 *  a branch has no single authored order, and substituting canvas order would
 *  misrepresent exactly the intent the thread exists to capture; the author
 *  can still pick All or Selected. A cycle has no ends and is excluded the
 *  same way.
 *
 *  Order: walk from a degree-1 end, preferring the end that is the `from` of
 *  its incident edge (the drag stored its direction for exactly this);
 *  tiebreak = earlier in the canvas reading order. Threads are returned
 *  sorted by their first photo's reading order, each capped at 20 — the same
 *  truncation the CREATE dialog applies to every source list. */
export function deriveThreads(
  edges: readonly CanvasEdge[],
  boardAssetIds: ReadonlySet<string>,
  readingOrder: readonly string[],
): string[][] {
  const orderIndex = new Map(readingOrder.map((id, index) => [id, index]));
  const rank = (id: string) => orderIndex.get(id) ?? Number.MAX_SAFE_INTEGER;

  // Adjacency over asset↔asset edges whose BOTH ends are live board members —
  // an edge to a since-removed photo must not weld two threads together.
  const adjacency = new Map<string, { other: string; isFrom: boolean }[]>();
  let edgeCount = 0;
  for (const edge of edges) {
    if (edge.from.kind !== "asset" || edge.to.kind !== "asset") continue;
    if (!boardAssetIds.has(edge.from.id) || !boardAssetIds.has(edge.to.id)) continue;
    edgeCount += 1;
    const push = (id: string, other: string, isFrom: boolean) => {
      const list = adjacency.get(id);
      if (list) list.push({ other, isFrom });
      else adjacency.set(id, [{ other, isFrom }]);
    };
    push(edge.from.id, edge.to.id, true);
    push(edge.to.id, edge.from.id, false);
  }
  if (edgeCount === 0) return [];

  const seen = new Set<string>();
  const threads: string[][] = [];

  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    // Collect the component.
    const nodes: string[] = [];
    let componentEdgeEnds = 0;
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const node = queue.pop() as string;
      nodes.push(node);
      const neighbours = adjacency.get(node) ?? [];
      componentEdgeEnds += neighbours.length;
      for (const { other } of neighbours) {
        if (!seen.has(other)) {
          seen.add(other);
          queue.push(other);
        }
      }
    }
    const componentEdges = componentEdgeEnds / 2;

    // Simple path or nothing: degrees ≤ 2 and nodes = edges + 1.
    if (nodes.length < 2 || componentEdges !== nodes.length - 1) continue;
    if (nodes.some((node) => (adjacency.get(node) ?? []).length > 2)) continue;

    const ends = nodes.filter((node) => (adjacency.get(node) ?? []).length === 1);
    // A path has exactly two ends; anything else already failed above, but the
    // guard keeps the walk honest against future edits.
    if (ends.length !== 2) continue;
    const directed = ends.filter((end) => (adjacency.get(end) ?? [])[0]?.isFrom);
    const walkStart =
      directed.length === 1 ? directed[0] : [...ends].sort((a, b) => rank(a) - rank(b))[0];

    const thread: string[] = [walkStart];
    let previous: string | null = null;
    let current = walkStart;
    while (thread.length < nodes.length) {
      const next = (adjacency.get(current) ?? []).find(({ other }) => other !== previous);
      if (!next) break;
      thread.push(next.other);
      previous = current;
      current = next.other;
    }
    if (thread.length >= 2) threads.push(thread.slice(0, 20));
  }

  return threads.sort((a, b) => rank(a[0]) - rank(b[0]));
}
