import type { EdgeId, NodeId, ResourceId } from '../domain'
import { routePhysicalLength, routeResource, type FactoryBlueprint } from '../editor'

export interface GraphPath { readonly resourceId: ResourceId; readonly nodes: readonly NodeId[]; readonly edges: readonly EdgeId[]; readonly distance: number }
interface QueueValue { readonly nodeId: NodeId; readonly distance: number; readonly edgeIds: readonly EdgeId[]; readonly nodeIds: readonly NodeId[] }

export const shortestPaths = (blueprint: FactoryBlueprint, sourceNodeId: NodeId, resourceId: ResourceId): ReadonlyMap<NodeId, GraphPath> => {
  const best = new Map<NodeId, GraphPath>()
  const queue: QueueValue[] = [{ nodeId: sourceNodeId, distance: 0, edgeIds: [], nodeIds: [sourceNodeId] }]
  while (queue.length > 0) {
    queue.sort((a, b) => a.distance - b.distance || a.nodeId.localeCompare(b.nodeId))
    const current = queue.shift()!
    if (best.has(current.nodeId)) continue
    best.set(current.nodeId, { resourceId, nodes: current.nodeIds, edges: current.edgeIds, distance: current.distance })
    const edges = [...blueprint.edges.values()].filter((edge) => edge.sourceNodeId === current.nodeId && routeResource(blueprint, edge) === resourceId)
      .sort((a, b) => routePhysicalLength(blueprint, a) - routePhysicalLength(blueprint, b) || a.id.localeCompare(b.id))
    for (const edge of edges) queue.push({ nodeId: edge.targetNodeId, distance: current.distance + routePhysicalLength(blueprint, edge), edgeIds: [...current.edgeIds, edge.id], nodeIds: [...current.nodeIds, edge.targetNodeId] })
  }
  return best
}
