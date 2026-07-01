import type { GridPoint, GridRect, Polyline, RateRaw } from '../domain'
import type { ContractId, EdgeId, FactoryId, NodeId, PortId, RecipeId, ResourceId } from '../domain'

export type BlueprintNodeKind = 'machine' | 'junction' | 'external-input' | 'external-output' | 'sub-factory'
export interface BlueprintPort {
  readonly id: PortId
  readonly direction: 'input' | 'output'
  readonly resourceId: ResourceId
  readonly capacity: RateRaw
  readonly anchor: GridPoint
  readonly maxConnections: number
}
interface BaseNode {
  readonly id: NodeId
  readonly kind: BlueprintNodeKind
  readonly name: string
  readonly position: GridPoint
  readonly footprint: GridRect
  readonly ports: readonly BlueprintPort[]
}
export interface MachineNode extends BaseNode { readonly kind: 'machine'; readonly recipeId: RecipeId }
export interface JunctionNode extends BaseNode { readonly kind: 'junction' }
export interface BoundaryNode extends BaseNode { readonly kind: 'external-input' | 'external-output' }
export interface SubFactoryNode extends BaseNode { readonly kind: 'sub-factory'; readonly contractId: ContractId }
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

export const findPort = (blueprint: FactoryBlueprint, nodeId: NodeId, portId: PortId): BlueprintPort | undefined =>
  blueprint.nodes.get(nodeId)?.ports.find((port) => port.id === portId)
