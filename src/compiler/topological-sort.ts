import type { NodeId } from '../domain';
import type { FactoryBlueprint } from '../editor';

export interface TopologicalResult {
  readonly order: readonly NodeId[];
  readonly cyclic: readonly NodeId[];
}
export const topologicalSort = (
  blueprint: FactoryBlueprint,
): TopologicalResult => {
  const indegree = new Map<NodeId, number>(
    [...blueprint.nodes.keys()].map((id) => [id, 0]),
  );
  const outgoing = new Map<NodeId, NodeId[]>();
  for (const edge of blueprint.edges.values()) {
    if (!indegree.has(edge.sourceNodeId) || !indegree.has(edge.targetNodeId))
      continue;
    indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1);
    const list = outgoing.get(edge.sourceNodeId) ?? [];
    list.push(edge.targetNodeId);
    outgoing.set(edge.sourceNodeId, list);
  }
  const queue = [...indegree]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort();
  const order: NodeId[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const target of (outgoing.get(id) ?? []).sort()) {
      const next = (indegree.get(target) ?? 1) - 1;
      indegree.set(target, next);
      if (next === 0) {
        queue.push(target);
        queue.sort();
      }
    }
  }
  return {
    order,
    cyclic: [...indegree]
      .filter(([, count]) => count > 0)
      .map(([id]) => id)
      .sort(),
  };
};
