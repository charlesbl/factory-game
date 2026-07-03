import type { GridPoint, GridRect, Polyline, RateRaw } from '../domain'
import type { ContractId, EdgeId, FactoryId, LooseConnectionId, NetId, NodeId, PortId, RecipeId, ResourceId, RouteConnectorId, TrackId, TransitionId } from '../domain'

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
  /** Player-owned handles. Physical bends between handles are derived. */
  readonly routeConnectors?: readonly RouteConnector[]
}
export interface RouteConnector { readonly id: RouteConnectorId; readonly position: GridPoint }
export interface LooseConnection {
  readonly id: LooseConnectionId
  readonly origin: PortReference
  readonly resourceId: ResourceId
  readonly capacity: RateRaw
  /** Always contains at least the currently free endpoint. */
  readonly routeConnectors: readonly RouteConnector[]
}
export type RoutingLayerId = 'primary' | 'bridge'
export interface PortReference { readonly nodeId: NodeId; readonly portId: PortId }
export interface TransportNet {
  readonly id: NetId
  readonly resourceId: ResourceId
  readonly source: PortReference
  readonly targets: readonly PortReference[]
  readonly requestedCapacity: RateRaw
}
export interface ConveyorTrack {
  readonly id: TrackId
  readonly netIds: readonly NetId[]
  readonly resourceId: ResourceId
  readonly capacity: RateRaw
  readonly layerId: RoutingLayerId
  readonly points: Polyline
}
export interface ConveyorTransition {
  readonly id: TransitionId
  readonly netIds: readonly NetId[]
  readonly resourceId: ResourceId
  readonly position: GridPoint
  readonly entryLayerId: RoutingLayerId
  readonly exitLayerId: RoutingLayerId
  readonly direction: 'horizontal' | 'vertical'
  readonly capacity: RateRaw
  readonly length: number
}
export interface ExternalPort { readonly portId: PortId; readonly nodeId: NodeId; readonly side: 'top' | 'right' | 'bottom' | 'left'; readonly offset: number }
export interface FactoryBlueprint {
  readonly id: FactoryId
  readonly revision: number
  readonly name: string
  readonly nodes: ReadonlyMap<NodeId, BlueprintNode>
  readonly edges: ReadonlyMap<EdgeId, BlueprintEdge>
  /** Logical transport intent. Absent only on in-memory V1 fixtures. */
  readonly nets?: ReadonlyMap<NetId, TransportNet>
  /** Authoritative physical conveyor geometry. Absent only on in-memory V1 fixtures. */
  readonly tracks?: ReadonlyMap<TrackId, ConveyorTrack>
  readonly transitions?: ReadonlyMap<TransitionId, ConveyorTransition>
  /** Saved, intentionally incomplete routes. They do not participate in compilation. */
  readonly looseConnections?: ReadonlyMap<LooseConnectionId, LooseConnection>
  readonly externalPorts: readonly ExternalPort[]
}

export const createBlueprint = (id: FactoryId, name = 'New factory'): FactoryBlueprint => ({
  id, revision: 0, name, nodes: new Map(), edges: new Map(), nets: new Map(), tracks: new Map(), transitions: new Map(), looseConnections: new Map(), externalPorts: [],
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

const edgeNetId = (edge: BlueprintEdge): NetId => edge.id.replace(/^edge-/, 'net-') as NetId
const edgeTrackId = (edge: BlueprintEdge): TrackId => edge.id.replace(/^edge-/, 'track-') as TrackId
export const legacyNetForEdge = (edge: BlueprintEdge): TransportNet => ({
  id: edgeNetId(edge), resourceId: edge.resourceId,
  source: { nodeId: edge.sourceNodeId, portId: edge.sourcePortId },
  targets: [{ nodeId: edge.targetNodeId, portId: edge.targetPortId }],
  requestedCapacity: edge.capacity,
})
export const legacyTrackForEdge = (edge: BlueprintEdge): ConveyorTrack => ({
  id: edgeTrackId(edge), netIds: [edgeNetId(edge)], resourceId: edge.resourceId, capacity: edge.capacity,
  layerId: 'primary', points: edge.points,
})
export const blueprintNets = (blueprint: FactoryBlueprint): ReadonlyMap<NetId, TransportNet> =>
  blueprint.nets ?? new Map([...blueprint.edges.values()].map((edge) => { const net = legacyNetForEdge(edge); return [net.id, net] }))
export const blueprintTracks = (blueprint: FactoryBlueprint): ReadonlyMap<TrackId, ConveyorTrack> =>
  blueprint.tracks ?? new Map([...blueprint.edges.values()].map((edge) => { const track = legacyTrackForEdge(edge); return [track.id, track] }))
export const blueprintTransitions = (blueprint: FactoryBlueprint): ReadonlyMap<TransitionId, ConveyorTransition> => blueprint.transitions ?? new Map()
export const blueprintLooseConnections = (blueprint: FactoryBlueprint): ReadonlyMap<LooseConnectionId, LooseConnection> => blueprint.looseConnections ?? new Map()

export const absolutePortPosition = (blueprint: FactoryBlueprint, reference: PortReference): GridPoint | undefined => {
  const node = blueprint.nodes.get(reference.nodeId)
  const port = node?.ports.find((candidate) => candidate.id === reference.portId)
  return node === undefined || port === undefined ? undefined : { x: node.position.x + port.anchor.x, y: node.position.y + port.anchor.y }
}

export const effectiveTrackPoints = (blueprint: FactoryBlueprint, track: ConveyorTrack): Polyline => {
  if (track.points.length === 0) return track.points
  const points = [...track.points]
  const nets = track.netIds.map((id) => blueprintNets(blueprint).get(id)).filter((net): net is TransportNet => net !== undefined)
  const distance = (a: GridPoint | undefined, b: GridPoint): number => a === undefined ? Number.POSITIVE_INFINITY : Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
  const tracks = [...blueprintTracks(blueprint).values()]
  const sources = nets.flatMap((net) => {
    const source = absolutePortPosition(blueprint, net.source); if (source === undefined) return []
    const first = tracks.filter((candidate) => candidate.netIds.includes(net.id) && candidate.points.length > 0).sort((a, b) => distance(a.points[0], source) - distance(b.points[0], source) || a.id.localeCompare(b.id))[0]
    return first?.id === track.id ? [source] : []
  })
  const targets = nets.flatMap((net) => net.targets.flatMap((target) => {
    const position = absolutePortPosition(blueprint, target); if (position === undefined) return []
    const last = tracks.filter((candidate) => candidate.netIds.includes(net.id) && candidate.points.length > 0).sort((a, b) => distance(a.points.at(-1), position) - distance(b.points.at(-1), position) || a.id.localeCompare(b.id))[0]
    return last?.id === track.id ? [position] : []
  }))
  if (sources.length > 0 && sources.every((point) => point.x === sources[0]!.x && point.y === sources[0]!.y)) points[0] = sources[0]!
  if (targets.length > 0 && targets.every((point) => point.x === targets[0]!.x && point.y === targets[0]!.y)) points[points.length - 1] = targets[0]!
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
