import type { GridPoint } from '../domain'
import { manhattanDistance } from '../domain'

export interface RailNode { readonly id: string; readonly position: GridPoint }
export interface RailEdge { readonly id: string; readonly from: string; readonly to: string; readonly length: number; readonly bidirectional: boolean }
export interface RailRoute { readonly nodeIds: readonly string[]; readonly edgeIds: readonly string[]; readonly distance: number }
export class RailNetwork {
  readonly nodes = new Map<string, RailNode>(); readonly edges = new Map<string, RailEdge>()
  addNode(node: RailNode): void { if (this.nodes.has(node.id)) throw new Error('Duplicate rail node'); this.nodes.set(node.id, node) }
  addEdge(edge: Omit<RailEdge, 'length'> & { readonly length?: number }): void {
    const from = this.nodes.get(edge.from); const to = this.nodes.get(edge.to); if (from === undefined || to === undefined) throw new Error('Rail edge references a missing node')
    const length = edge.length ?? manhattanDistance(from.position, to.position); if (!Number.isSafeInteger(length) || length <= 0) throw new Error('Rail length must be a positive integer')
    this.edges.set(edge.id, { ...edge, length })
  }
  route(from: string, to: string): RailRoute | undefined {
    const queue = [{ id: from, distance: 0, nodes: [from], edges: [] as string[] }]; const visited = new Set<string>()
    while (queue.length > 0) {
      queue.sort((a, b) => a.distance - b.distance || (this.nodes.get(a.id)?.position.y ?? 0) - (this.nodes.get(b.id)?.position.y ?? 0) || (this.nodes.get(a.id)?.position.x ?? 0) - (this.nodes.get(b.id)?.position.x ?? 0) || a.id.localeCompare(b.id))
      const current = queue.shift()!; if (visited.has(current.id)) continue; visited.add(current.id)
      if (current.id === to) return { nodeIds: current.nodes, edgeIds: current.edges, distance: current.distance }
      const candidates = [...this.edges.values()].flatMap((edge) => edge.from === current.id ? [{ edge, next: edge.to }] : edge.bidirectional && edge.to === current.id ? [{ edge, next: edge.from }] : [])
      for (const { edge, next } of candidates) if (!visited.has(next)) queue.push({ id: next, distance: current.distance + edge.length, nodes: [...current.nodes, next], edges: [...current.edges, edge.id] })
    }
    return undefined
  }
}
