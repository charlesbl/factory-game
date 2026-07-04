import type { GridPoint, GridRect, RateRaw } from '../domain'
import type { ContractId, EdgeId, FactoryId, LooseConnectionId, NodeId, PortId, RecipeId, ResourceId, RouteBridgeId, RouteHandleId } from '../domain'

export interface FactoryVersionRef { readonly factoryId: FactoryId; readonly version: number }

export type BlueprintNodeKind = 'machine' | 'junction' | 'external-input' | 'external-output' | 'sub-factory'
interface PortBase {
  readonly id: PortId
  readonly direction: 'input' | 'output'
  readonly capacity: RateRaw
  readonly anchor: GridPoint
}
export interface BlueprintPort extends PortBase { readonly resourceId: ResourceId }
export interface SubFactoryPort extends BlueprintPort { readonly contractPortId: PortId }
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
export interface SubFactoryNode extends BaseNode<SubFactoryPort> { readonly kind: 'sub-factory'; readonly factoryId: FactoryId; readonly version: number; readonly contractId: ContractId }
export type BlueprintNode = MachineNode | JunctionNode | BoundaryNode | SubFactoryNode

export interface RouteHandle { readonly id: RouteHandleId; readonly position: GridPoint }
export interface RouteBridge { readonly id: RouteBridgeId; readonly position: GridPoint }
export interface BlueprintEdge {
  readonly id: EdgeId
  readonly sourceNodeId: NodeId
  readonly sourcePortId: PortId
  readonly targetNodeId: NodeId
  readonly targetPortId: PortId
  readonly routeHandles: readonly RouteHandle[]
  readonly bridges: readonly RouteBridge[]
}
export interface PortReference { readonly nodeId: NodeId; readonly portId: PortId }
export interface LooseConnection {
  readonly id: LooseConnectionId
  readonly origin: PortReference
  /** Always contains at least the currently free endpoint. */
  readonly routeHandles: readonly RouteHandle[]
}
export type RoutingLayerId = 'primary' | 'bridge'
export interface ExternalPort { readonly portId: PortId; readonly nodeId: NodeId; readonly side: 'top' | 'right' | 'bottom' | 'left'; readonly offset: number }
export interface FactoryBlueprint {
  readonly id: FactoryId
  readonly revision: number
  readonly nodes: ReadonlyMap<NodeId, BlueprintNode>
  readonly edges: ReadonlyMap<EdgeId, BlueprintEdge>
  readonly looseConnections: ReadonlyMap<LooseConnectionId, LooseConnection>
  readonly externalPorts: readonly ExternalPort[]
}

export const createBlueprint = (id: FactoryId): FactoryBlueprint => ({
  id, revision: 0, nodes: new Map(), edges: new Map(), looseConnections: new Map(), externalPorts: [],
})

export const updateBlueprint = (blueprint: FactoryBlueprint, update: Partial<Omit<FactoryBlueprint, 'id' | 'revision'>>, affectsCompilation = true): FactoryBlueprint => ({
  ...blueprint, ...update, revision: blueprint.revision + (affectsCompilation ? 1 : 0),
})

export const findPort = (blueprint: FactoryBlueprint, nodeId: NodeId, portId: PortId): AnyBlueprintPort | undefined =>
  blueprint.nodes.get(nodeId)?.ports.find((port) => port.id === portId)

export const absolutePortPosition = (blueprint: FactoryBlueprint, reference: PortReference): GridPoint | undefined => {
  const node = blueprint.nodes.get(reference.nodeId); const port = findPort(blueprint, reference.nodeId, reference.portId)
  return node === undefined || port === undefined ? undefined : { x: node.position.x + port.anchor.x, y: node.position.y + port.anchor.y }
}

export const occupiedPortIds = (blueprint: FactoryBlueprint, exceptLooseId?: LooseConnectionId): ReadonlySet<PortId> => {
  const occupied = new Set<PortId>()
  for (const edge of blueprint.edges.values()) { occupied.add(edge.sourcePortId); occupied.add(edge.targetPortId) }
  for (const loose of blueprint.looseConnections.values()) if (loose.id !== exceptLooseId) occupied.add(loose.origin.portId)
  return occupied
}
export const isPortOccupied = (blueprint: FactoryBlueprint, portId: PortId, exceptLooseId?: LooseConnectionId): boolean => occupiedPortIds(blueprint, exceptLooseId).has(portId)

const junctionComponent = (blueprint: FactoryBlueprint, startId: NodeId): ReadonlySet<NodeId> => {
  const start = blueprint.nodes.get(startId); if (start?.kind !== 'junction') return new Set()
  const component = new Set<NodeId>([startId]); const pending = [startId]
  while (pending.length > 0) {
    const current = pending.pop()!
    for (const edge of blueprint.edges.values()) {
      const other = edge.sourceNodeId === current ? edge.targetNodeId : edge.targetNodeId === current ? edge.sourceNodeId : undefined
      if (other === undefined || component.has(other) || blueprint.nodes.get(other)?.kind !== 'junction') continue
      component.add(other); pending.push(other)
    }
  }
  return component
}

export const junctionResources = (blueprint: FactoryBlueprint, nodeId: NodeId): ReadonlySet<ResourceId> => {
  const component = junctionComponent(blueprint, nodeId); const resources = new Set<ResourceId>()
  for (const edge of blueprint.edges.values()) {
    const endpoints: readonly [NodeId, PortId][] = [[edge.sourceNodeId, edge.sourcePortId], [edge.targetNodeId, edge.targetPortId]]
    if (!endpoints.some(([id]) => component.has(id))) continue
    for (const [id, portId] of endpoints) {
      const node = blueprint.nodes.get(id); const port = findPort(blueprint, id, portId)
      if (node?.kind !== 'junction' && port !== undefined && 'resourceId' in port) resources.add(port.resourceId)
    }
  }
  return resources
}

export const effectivePortResource = (blueprint: FactoryBlueprint, nodeId: NodeId, portId: PortId): ResourceId | undefined => {
  const node = blueprint.nodes.get(nodeId); const port = findPort(blueprint, nodeId, portId)
  if (node === undefined || port === undefined) return undefined
  if (node.kind !== 'junction') return port.resourceId
  const resources = junctionResources(blueprint, nodeId)
  return resources.size === 1 ? resources.values().next().value : undefined
}

export const routeResource = (blueprint: FactoryBlueprint, edge: BlueprintEdge): ResourceId | undefined => {
  const source = effectivePortResource(blueprint, edge.sourceNodeId, edge.sourcePortId)
  const target = effectivePortResource(blueprint, edge.targetNodeId, edge.targetPortId)
  if (source !== undefined && target !== undefined && source !== target) return undefined
  return source ?? target
}

export const routeCapacity = (blueprint: FactoryBlueprint, edge: BlueprintEdge): RateRaw => {
  const source = findPort(blueprint, edge.sourceNodeId, edge.sourcePortId); const target = findPort(blueprint, edge.targetNodeId, edge.targetPortId)
  if (source === undefined || target === undefined) return 0n
  return source.capacity < target.capacity ? source.capacity : target.capacity
}
