import type { GridPoint, GridRect, Polyline, RateRaw } from '../domain'
import type { ContractId, EdgeId, FactoryId, NodeId, PortId, RecipeId, ResourceId } from '../domain'

export type BlueprintNodeKind = 'machine' | 'junction' | 'external-input' | 'external-output' | 'sub-factory'
interface PortBase {
  readonly id: PortId
  readonly direction: 'input' | 'output'
  readonly capacity: RateRaw
  readonly anchor: GridPoint
  readonly maxConnections: number
}
export interface BlueprintPort extends PortBase { readonly resourceId: ResourceId }
export interface JunctionPort extends PortBase { readonly resourceId?: never }
export type AnyBlueprintPort = BlueprintPort | JunctionPort

interface BaseNode<Port extends AnyBlueprintPort> {
  readonly id: NodeId
  readonly kind: BlueprintNodeKind
  readonly name: string
  readonly position: GridPoint
  readonly footprint: GridRect
  readonly ports: readonly Port[]
}
export interface MachineNode extends BaseNode<BlueprintPort> { readonly kind: 'machine'; readonly recipeId: RecipeId }
export interface JunctionNode extends BaseNode<JunctionPort> { readonly kind: 'junction' }
export interface BoundaryNode extends BaseNode<BlueprintPort> { readonly kind: 'external-input' | 'external-output' }
export interface SubFactoryNode extends BaseNode<BlueprintPort> { readonly kind: 'sub-factory'; readonly contractId: ContractId }
export type BlueprintNode = MachineNode | JunctionNode | BoundaryNode | SubFactoryNode

export interface BlueprintEdge {
  readonly id: EdgeId
  readonly sourceNodeId: NodeId
  readonly sourcePortId: PortId
  readonly targetNodeId: NodeId
  readonly targetPortId: PortId
  readonly resourceId: ResourceId
  readonly capacity: RateRaw
  readonly points: Polyline
}
export interface ExternalPort { readonly portId: PortId; readonly nodeId: NodeId; readonly side: 'top' | 'right' | 'bottom' | 'left'; readonly offset: number }
export interface FactoryBlueprint {
  readonly id: FactoryId
  readonly revision: number
  readonly name: string
  readonly nodes: ReadonlyMap<NodeId, BlueprintNode>
  readonly edges: ReadonlyMap<EdgeId, BlueprintEdge>
  readonly externalPorts: readonly ExternalPort[]
}

export const createBlueprint = (id: FactoryId, name = 'New factory'): FactoryBlueprint => ({
  id, revision: 0, name, nodes: new Map(), edges: new Map(), externalPorts: [],
})

export const updateBlueprint = (blueprint: FactoryBlueprint, update: Partial<Omit<FactoryBlueprint, 'id' | 'revision'>>, affectsCompilation = true): FactoryBlueprint => ({
  ...blueprint,
  ...update,
  revision: blueprint.revision + (affectsCompilation ? 1 : 0),
})

export const findPort = (blueprint: FactoryBlueprint, nodeId: NodeId, portId: PortId): AnyBlueprintPort | undefined =>
  blueprint.nodes.get(nodeId)?.ports.find((port) => port.id === portId)

export const effectiveEdgePoints = (blueprint: FactoryBlueprint, edge: BlueprintEdge): Polyline => {
  if (edge.points.length === 0) return edge.points
  const points = [...edge.points]
  const sourceNode = blueprint.nodes.get(edge.sourceNodeId); const sourcePort = findPort(blueprint, edge.sourceNodeId, edge.sourcePortId)
  const targetNode = blueprint.nodes.get(edge.targetNodeId); const targetPort = findPort(blueprint, edge.targetNodeId, edge.targetPortId)
  if (sourceNode !== undefined && sourcePort !== undefined) points[0] = { x: sourceNode.position.x + sourcePort.anchor.x, y: sourceNode.position.y + sourcePort.anchor.y }
  if (targetNode !== undefined && targetPort !== undefined) points[points.length - 1] = { x: targetNode.position.x + targetPort.anchor.x, y: targetNode.position.y + targetPort.anchor.y }
  return points
}

export const junctionResources = (blueprint: FactoryBlueprint, nodeId: NodeId): ReadonlySet<ResourceId> => {
  const node = blueprint.nodes.get(nodeId)
  if (node?.kind !== 'junction') return new Set()
  const resources = new Set<ResourceId>()
  for (const edge of blueprint.edges.values()) {
    if (edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId) resources.add(edge.resourceId)
  }
  return resources
}

export const effectivePortResource = (blueprint: FactoryBlueprint, nodeId: NodeId, portId: PortId): ResourceId | undefined => {
  const node = blueprint.nodes.get(nodeId)
  const port = node?.ports.find((candidate) => candidate.id === portId)
  if (node === undefined || port === undefined) return undefined
  if (node.kind !== 'junction') return port.resourceId
  const resources = junctionResources(blueprint, nodeId)
  return resources.size === 1 ? resources.values().next().value : undefined
}
