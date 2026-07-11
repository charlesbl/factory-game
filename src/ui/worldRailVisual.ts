import type { GridPoint, RailNodeId } from '../domain';
import type { WorldRailEdge, WorldRailNode, WorldSnapshot } from '../world';

export type RailConnectionState = 'connected' | 'disconnected';

export const railEdgeAt = (
  snapshot: Pick<WorldSnapshot, 'railEdges'>,
  point: GridPoint,
): WorldRailEdge | undefined =>
  snapshot.railEdges.find((edge) =>
    edge.points.slice(1).some((end, index) => {
      const start = edge.points[index];
      if (start === undefined) return false;
      return start.x === end.x
        ? point.x === start.x &&
            point.y >= Math.min(start.y, end.y) &&
            point.y <= Math.max(start.y, end.y)
        : point.y === start.y &&
            point.x >= Math.min(start.x, end.x) &&
            point.x <= Math.max(start.x, end.x);
    }),
  );

export const railNodeDegrees = (
  edges: readonly WorldRailEdge[],
): ReadonlyMap<RailNodeId, number> => {
  const degrees = new Map<RailNodeId, number>();
  for (const edge of edges) {
    degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1);
    degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1);
  }
  return degrees;
};

export const railNodeConnectionState = (
  node: WorldRailNode,
  degrees: ReadonlyMap<RailNodeId, number>,
): RailConnectionState => {
  const degree = degrees.get(node.id) ?? 0;
  if (node.kind === 'endpoint')
    return degree >= 2 ? 'connected' : 'disconnected';
  if (node.kind === 'junction')
    return degree >= 2 ? 'connected' : 'disconnected';
  return degree >= 1 ? 'connected' : 'disconnected';
};

export const railEdgeConnectionState = (
  edge: WorldRailEdge,
  nodes: ReadonlyMap<RailNodeId, WorldRailNode>,
  degrees: ReadonlyMap<RailNodeId, number>,
): RailConnectionState => {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  return from !== undefined &&
    to !== undefined &&
    railNodeConnectionState(from, degrees) === 'connected' &&
    railNodeConnectionState(to, degrees) === 'connected'
    ? 'connected'
    : 'disconnected';
};
