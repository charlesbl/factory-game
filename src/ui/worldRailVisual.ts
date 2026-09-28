import type { GridPoint, RailNodeId } from '../domain';
import type { WorldRailEdge, WorldRailNode, WorldSnapshot } from '../world';

export type RailConnectionState = 'connected' | 'disconnected';

export const railEdgesAt = (
  snapshot: Pick<WorldSnapshot, 'railEdges'>,
  point: GridPoint,
): readonly WorldRailEdge[] =>
  snapshot.railEdges.filter((edge) =>
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

export const railEdgeAt = (
  snapshot: Pick<WorldSnapshot, 'railEdges'>,
  point: GridPoint,
): WorldRailEdge | undefined => railEdgesAt(snapshot, point)[0];

export const railNodeDegrees = (
  edges: readonly WorldRailEdge[],
): ReadonlyMap<RailNodeId, number> => {
  const neighbours = new Map<RailNodeId, Set<RailNodeId>>();
  for (const edge of edges) {
    const from = neighbours.get(edge.from) ?? new Set<RailNodeId>();
    const to = neighbours.get(edge.to) ?? new Set<RailNodeId>();
    from.add(edge.to);
    to.add(edge.from);
    neighbours.set(edge.from, from);
    neighbours.set(edge.to, to);
  }
  return new Map([...neighbours].map(([id, adjacent]) => [id, adjacent.size]));
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

/** Geometric turns include imported polyline vertices and both rail directions. */
export const railCorners = (
  edges: readonly WorldRailEdge[],
): ReadonlyMap<string, { point: GridPoint; angle: number }> => {
  const directions = new Map<string, { point: GridPoint; arms: Set<string> }>();
  const arm = (point: GridPoint, other: GridPoint) => {
    const key = point.x + ':' + point.y;
    let entry = directions.get(key);
    if (!entry) {
      entry = { point, arms: new Set() };
      directions.set(key, entry);
    }
    entry.arms.add(
      other.x > point.x
        ? 'E'
        : other.x < point.x
          ? 'W'
          : other.y > point.y
            ? 'S'
            : 'N',
    );
  };
  for (const edge of edges)
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1]!,
        b = edge.points[i]!;
      if (a.x === b.x && a.y === b.y) continue;
      arm(a, b);
      arm(b, a);
    }
  const corners = new Map<string, { point: GridPoint; angle: number }>();
  for (const [key, { point, arms }] of directions) {
    if (
      arms.size !== 2 ||
      (arms.has('N') && arms.has('S')) ||
      (arms.has('E') && arms.has('W'))
    )
      continue;
    const angle = arms.has('N')
      ? arms.has('E')
        ? 0
        : Math.PI / 2
      : arms.has('E')
        ? -Math.PI / 2
        : Math.PI;
    corners.set(key, { point, angle });
  }
  return corners;
};
