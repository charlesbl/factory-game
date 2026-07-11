import type { GridPoint } from '../domain';
import { manhattanDistance } from '../domain';

export interface RailNode {
  readonly id: string;
  readonly position: GridPoint;
}
export interface RailEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly length: number;
  readonly bidirectional: boolean;
}
export interface RailRoute {
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly distance: number;
}
export interface RailBlock {
  readonly id: string;
  readonly edgeId: string;
  occupantId?: string;
  reservedById?: string;
}
export class RailNetwork {
  readonly nodes = new Map<string, RailNode>();
  readonly edges = new Map<string, RailEdge>();
  readonly blocks = new Map<string, RailBlock>();
  #revision = 0;
  readonly #routeCache = new Map<string, RailRoute | null>();
  get revision(): number {
    return this.#revision;
  }
  addNode(node: RailNode): void {
    if (this.nodes.has(node.id)) throw new Error('Duplicate rail node');
    this.nodes.set(node.id, node);
    this.changed();
  }
  addEdge(edge: Omit<RailEdge, 'length'> & { readonly length?: number }): void {
    const from = this.nodes.get(edge.from);
    const to = this.nodes.get(edge.to);
    if (from === undefined || to === undefined)
      throw new Error('Rail edge references a missing node');
    if (this.edges.has(edge.id)) throw new Error('Duplicate rail edge');
    if (from.position.x !== to.position.x && from.position.y !== to.position.y)
      throw new Error('World rails must be orthogonal');
    const length = edge.length ?? manhattanDistance(from.position, to.position);
    if (!Number.isSafeInteger(length) || length <= 0)
      throw new Error('Rail length must be a positive integer');
    this.edges.set(edge.id, { ...edge, length });
    this.blocks.set(`block:${edge.id}`, {
      id: `block:${edge.id}`,
      edgeId: edge.id,
    });
    this.changed();
  }
  removeEdge(edgeId: string): void {
    if (!this.edges.has(edgeId)) throw new Error('Unknown rail edge');
    const block = this.blocks.get(`block:${edgeId}`);
    if (block?.occupantId !== undefined || block?.reservedById !== undefined)
      throw new Error('Rail edge is in use');
    this.edges.delete(edgeId);
    this.blocks.delete(`block:${edgeId}`);
    this.changed();
  }
  removeNode(nodeId: string): void {
    if (!this.nodes.has(nodeId)) throw new Error('Unknown rail node');
    if (
      [...this.edges.values()].some(
        (edge) => edge.from === nodeId || edge.to === nodeId,
      )
    )
      throw new Error('Rail node still has connected edges');
    this.nodes.delete(nodeId);
    this.changed();
  }
  route(from: string, to: string): RailRoute | undefined {
    const cacheKey = `${this.#revision}:${from}:${to}`;
    const cached = this.#routeCache.get(cacheKey);
    if (cached !== undefined) return cached ?? undefined;
    const queue = [
      { id: from, distance: 0, nodes: [from], edges: [] as string[] },
    ];
    const visited = new Set<string>();
    while (queue.length > 0) {
      queue.sort(
        (a, b) =>
          a.distance - b.distance ||
          (this.nodes.get(a.id)?.position.y ?? 0) -
            (this.nodes.get(b.id)?.position.y ?? 0) ||
          (this.nodes.get(a.id)?.position.x ?? 0) -
            (this.nodes.get(b.id)?.position.x ?? 0) ||
          a.id.localeCompare(b.id),
      );
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      if (current.id === to) {
        const route = {
          nodeIds: current.nodes,
          edgeIds: current.edges,
          distance: current.distance,
        };
        this.#routeCache.set(cacheKey, route);
        return route;
      }
      const candidates = [...this.edges.values()].flatMap((edge) =>
        edge.from === current.id
          ? [{ edge, next: edge.to }]
          : edge.bidirectional && edge.to === current.id
            ? [{ edge, next: edge.from }]
            : [],
      );
      for (const { edge, next } of candidates)
        if (!visited.has(next))
          queue.push({
            id: next,
            distance: current.distance + edge.length,
            nodes: [...current.nodes, next],
            edges: [...current.edges, edge.id],
          });
    }
    this.#routeCache.set(cacheKey, null);
    return undefined;
  }
  reserve(edgeId: string, vehicleId: string): boolean {
    const block = this.blocks.get(`block:${edgeId}`);
    if (block === undefined) throw new Error('Unknown rail block');
    if (
      block.occupantId !== undefined ||
      (block.reservedById !== undefined && block.reservedById !== vehicleId)
    )
      return false;
    block.reservedById = vehicleId;
    return true;
  }
  enter(edgeId: string, vehicleId: string): void {
    const block = this.blocks.get(`block:${edgeId}`);
    if (block?.reservedById !== vehicleId || block.occupantId !== undefined)
      throw new Error('Rail block entry without an exclusive reservation');
    delete block.reservedById;
    block.occupantId = vehicleId;
  }
  leave(edgeId: string, vehicleId: string): void {
    const block = this.blocks.get(`block:${edgeId}`);
    if (block?.occupantId !== vehicleId)
      throw new Error('Vehicle does not occupy this rail block');
    delete block.occupantId;
  }
  releaseReservation(edgeId: string, vehicleId: string): void {
    const block = this.blocks.get(`block:${edgeId}`);
    if (block?.reservedById === vehicleId) delete block.reservedById;
  }
  private changed(): void {
    this.#revision += 1;
    this.#routeCache.clear();
  }
}
