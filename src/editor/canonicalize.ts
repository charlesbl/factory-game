import { asId, recipeById } from '../domain'
import type { ContractId, EdgeId, FactoryId, LooseConnectionId, NetId, NodeId, PortId, RecipeId, ResourceId, RouteConnectorId, TrackId, TransitionId } from '../domain'
import type { AnyBlueprintPort, BlueprintEdge, BlueprintNode, BlueprintPort, ConveyorTrack, ConveyorTransition, ExternalPort, FactoryBlueprint, JunctionPort, LooseConnection, RouteConnector, TransportNet } from './blueprint'
import { blueprintLooseConnections, blueprintNets, blueprintTracks, blueprintTransitions, effectiveTrackPoints } from './blueprint'

interface SerializedPort { readonly id: string; readonly direction: 'input' | 'output'; readonly resourceId?: string; readonly capacity: string; readonly anchor: { readonly x: number; readonly y: number }; readonly maxConnections: number }
interface SerializedNode { readonly id: string; readonly kind: BlueprintNode['kind']; readonly name: string; readonly position: { readonly x: number; readonly y: number }; readonly footprint: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }; readonly ports: readonly SerializedPort[]; readonly recipeId?: string; readonly contractId?: string }
interface SerializedRouteConnector { readonly id: string; readonly position: { readonly x: number; readonly y: number } }
interface SerializedEdge { readonly id: string; readonly sourceNodeId: string; readonly sourcePortId: string; readonly targetNodeId: string; readonly targetPortId: string; readonly resourceId: string; readonly capacity: string; readonly points: readonly { readonly x: number; readonly y: number }[]; readonly routeConnectors?: readonly SerializedRouteConnector[] }
interface SerializedLooseConnection { readonly id: string; readonly origin: { readonly nodeId: string; readonly portId: string }; readonly resourceId: string; readonly capacity: string; readonly routeConnectors: readonly SerializedRouteConnector[] }
interface SerializedNet { readonly id: string; readonly resourceId: string; readonly source: { readonly nodeId: string; readonly portId: string }; readonly targets: readonly { readonly nodeId: string; readonly portId: string }[]; readonly requestedCapacity: string }
interface SerializedTrack { readonly id: string; readonly netIds: readonly string[]; readonly resourceId: string; readonly capacity: string; readonly layerId: ConveyorTrack['layerId']; readonly points: ConveyorTrack['points']; readonly routing?: 'automatic' | 'manual'; readonly lockedPointIndexes?: readonly number[] }
interface SerializedTransition { readonly id: string; readonly netIds: readonly string[]; readonly resourceId: string; readonly position: ConveyorTransition['position']; readonly entryLayerId: ConveyorTransition['entryLayerId']; readonly exitLayerId: ConveyorTransition['exitLayerId']; readonly direction: ConveyorTransition['direction']; readonly capacity: string; readonly length: number }
interface SerializedBlueprintV1 { readonly schemaVersion: 1; readonly id: string; readonly revision: number; readonly name: string; readonly nodes: readonly SerializedNode[]; readonly edges: readonly SerializedEdge[]; readonly externalPorts: readonly ExternalPort[] }
interface SerializedBlueprintV2 { readonly schemaVersion: 2; readonly id: string; readonly revision: number; readonly name: string; readonly nodes: readonly SerializedNode[]; readonly edges: readonly SerializedEdge[]; readonly nets: readonly SerializedNet[]; readonly tracks: readonly SerializedTrack[]; readonly transitions: readonly SerializedTransition[]; readonly externalPorts: readonly ExternalPort[] }
export interface SerializedBlueprint { readonly schemaVersion: 3; readonly id: string; readonly revision: number; readonly name: string; readonly nodes: readonly SerializedNode[]; readonly edges: readonly SerializedEdge[]; readonly nets: readonly SerializedNet[]; readonly tracks: readonly SerializedTrack[]; readonly transitions: readonly SerializedTransition[]; readonly looseConnections: readonly SerializedLooseConnection[]; readonly externalPorts: readonly ExternalPort[] }

const byId = <T extends { readonly id: string }>(a: T, b: T): number => a.id.localeCompare(b.id)
const serializePort = (port: AnyBlueprintPort): SerializedPort => ({ ...port, capacity: port.capacity.toString() })
export const serializeBlueprint = (blueprint: FactoryBlueprint): SerializedBlueprint => ({
  schemaVersion: 3, id: blueprint.id, revision: blueprint.revision, name: blueprint.name,
  nodes: [...blueprint.nodes.values()].sort(byId).map((node) => ({ ...node, ports: node.ports.map(serializePort) })),
  edges: [...blueprint.edges.values()].sort(byId).map((edge) => ({ ...edge, capacity: edge.capacity.toString() })),
  nets: [...blueprintNets(blueprint).values()].sort(byId).map((net) => ({ ...net, requestedCapacity: net.requestedCapacity.toString() })),
  tracks: [...blueprintTracks(blueprint).values()].sort(byId).map((track) => ({ ...track, netIds: [...track.netIds].sort(), capacity: track.capacity.toString() })),
  transitions: [...blueprintTransitions(blueprint).values()].sort(byId).map((transition) => ({ ...transition, netIds: [...transition.netIds].sort(), capacity: transition.capacity.toString() })),
  looseConnections: [...blueprintLooseConnections(blueprint).values()].sort(byId).map((loose) => ({ ...loose, capacity: loose.capacity.toString() })),
  externalPorts: [...blueprint.externalPorts].sort((a, b) => a.portId.localeCompare(b.portId)),
})
export const canonicalBlueprint = (blueprint: FactoryBlueprint): string => JSON.stringify(serializeBlueprint(blueprint))
export const canonicalCompilationInput = (blueprint: FactoryBlueprint): string => {
  const recipeIds = [...new Set([...blueprint.nodes.values()].flatMap((node) => node.kind === 'machine' ? [node.recipeId] : []))].sort()
  const recipes = recipeIds.map((id) => recipeById.get(id)).filter((recipe) => recipe !== undefined)
  const compilationBlueprint = serializeBlueprint({ ...blueprint, looseConnections: new Map() })
  return `${JSON.stringify(compilationBlueprint)}|recipes:${JSON.stringify(recipes, (_, value: unknown) => typeof value === 'bigint' ? value.toString() : value)}`
}

const deserializeTypedPort = (port: SerializedPort): BlueprintPort => {
  if (port.resourceId === undefined) throw new Error(`Port ${port.id} resource is missing`)
  return { id: asId<PortId>(port.id), direction: port.direction, resourceId: asId<ResourceId>(port.resourceId), capacity: BigInt(port.capacity), anchor: port.anchor, maxConnections: port.maxConnections }
}
const deserializeJunctionPort = (port: SerializedPort): JunctionPort => ({
  id: asId<PortId>(port.id), direction: port.direction, capacity: BigInt(port.capacity), anchor: port.anchor, maxConnections: port.maxConnections,
})
const deserializeNode = (node: SerializedNode): BlueprintNode => {
  const common = { id: asId<NodeId>(node.id), name: node.name, position: node.position, footprint: node.footprint }
  if (node.kind === 'junction') return { ...common, kind: 'junction', ports: node.ports.map(deserializeJunctionPort) }
  const base = { ...common, ports: node.ports.map(deserializeTypedPort) }
  if (node.kind === 'machine') { if (node.recipeId === undefined) throw new Error('Machine recipe is missing'); return { ...base, kind: 'machine', recipeId: asId<RecipeId>(node.recipeId) } }
  if (node.kind === 'sub-factory') { if (node.contractId === undefined) throw new Error('Sub-factory contract is missing'); return { ...base, kind: 'sub-factory', contractId: asId<ContractId>(node.contractId) } }
  return { ...base, kind: node.kind }
}
const expandUtilityNode = (node: BlueprintNode): BlueprintNode => {
  const width = node.kind === 'junction' ? 3 : node.kind === 'external-input' || node.kind === 'external-output' ? 4 : node.footprint.width
  if (node.footprint.width >= width) return node
  return {
    ...node,
    footprint: { ...node.footprint, width },
    ports: node.ports.map((port) => port.direction === 'output' && port.anchor.x === node.footprint.width ? { ...port, anchor: { ...port.anchor, x: width } } : port),
  } as BlueprintNode
}
const deserializeConnector = (connector: SerializedRouteConnector): RouteConnector => ({ id: asId<RouteConnectorId>(connector.id), position: connector.position })
const deserializeEdge = (edge: SerializedEdge): BlueprintEdge => ({ ...edge, id: asId<EdgeId>(edge.id), sourceNodeId: asId<NodeId>(edge.sourceNodeId), sourcePortId: asId<PortId>(edge.sourcePortId), targetNodeId: asId<NodeId>(edge.targetNodeId), targetPortId: asId<PortId>(edge.targetPortId), resourceId: asId<ResourceId>(edge.resourceId), capacity: BigInt(edge.capacity), routeConnectors: (edge.routeConnectors ?? edge.points.slice(1, -1).map((position, index) => ({ id: `${edge.id}:connector:${index}`, position }))).map(deserializeConnector) })
const deserializeLooseConnection = (loose: SerializedLooseConnection): LooseConnection => ({ id: asId<LooseConnectionId>(loose.id), origin: { nodeId: asId<NodeId>(loose.origin.nodeId), portId: asId<PortId>(loose.origin.portId) }, resourceId: asId<ResourceId>(loose.resourceId), capacity: BigInt(loose.capacity), routeConnectors: loose.routeConnectors.map(deserializeConnector) })
const deserializeNet = (net: SerializedNet): TransportNet => ({ ...net, id: asId<NetId>(net.id), resourceId: asId<ResourceId>(net.resourceId), source: { nodeId: asId<NodeId>(net.source.nodeId), portId: asId<PortId>(net.source.portId) }, targets: net.targets.map((target) => ({ nodeId: asId<NodeId>(target.nodeId), portId: asId<PortId>(target.portId) })), requestedCapacity: BigInt(net.requestedCapacity) })
const deserializeTrack = (track: SerializedTrack): ConveyorTrack => ({ id: asId<TrackId>(track.id), netIds: track.netIds.map((id) => asId<NetId>(id)), resourceId: asId<ResourceId>(track.resourceId), capacity: BigInt(track.capacity), layerId: track.layerId, points: track.points })
const deserializeTransition = (transition: SerializedTransition): ConveyorTransition => ({ ...transition, id: asId<TransitionId>(transition.id), netIds: transition.netIds.map((id) => asId<NetId>(id)), resourceId: asId<ResourceId>(transition.resourceId), capacity: BigInt(transition.capacity) })
const assertUnique = (values: readonly { readonly id: string }[], label: string): void => { const ids = new Set<string>(); for (const value of values) { if (ids.has(value.id)) throw new Error(`Duplicate ${label} ID: ${value.id}`); ids.add(value.id) } }
const repairProjectedEndpoints = (blueprint: FactoryBlueprint): FactoryBlueprint => {
  if (blueprint.tracks === undefined) return blueprint
  const tracks = new Map([...blueprint.tracks].map(([id, track]) => {
    if (track.points.length < 2) return [id, track]
    const original = [...track.points]; const points = [...effectiveTrackPoints(blueprint, track)]
    const originalFirst = original[0]!; const originalSecond = original[1]!; const first = points[0]!; const second = points[1]!
    if ((first.x !== originalFirst.x || first.y !== originalFirst.y) && first.x !== second.x && first.y !== second.y) {
      const corner = originalFirst.y === originalSecond.y ? { x: second.x, y: first.y } : { x: first.x, y: second.y }
      points.splice(1, 0, corner)
    }
    const originalLast = original.at(-1)!; const originalBeforeLast = original.at(-2)!; const last = points.at(-1)!; const beforeLast = points.at(-2)!
    if ((last.x !== originalLast.x || last.y !== originalLast.y) && last.x !== beforeLast.x && last.y !== beforeLast.y) {
      const corner = originalBeforeLast.y === originalLast.y ? { x: last.x, y: beforeLast.y } : { x: beforeLast.x, y: last.y }
      points.splice(points.length - 1, 0, corner)
    }
    const repaired = points.filter((point, index) => index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y)
    return [id, { ...track, points: repaired }]
  }))
  return { ...blueprint, tracks }
}
export const deserializeBlueprint = (value: SerializedBlueprint | SerializedBlueprintV2 | SerializedBlueprintV1): FactoryBlueprint => {
  if ((value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error('Unsupported blueprint schema')
  assertUnique(value.nodes, 'node'); assertUnique(value.edges, 'edge')
  const nodes = value.nodes.map(deserializeNode).map(expandUtilityNode); const edges = value.edges.map(deserializeEdge)
  if (value.schemaVersion === 1) {
    const legacy: FactoryBlueprint = { id: asId<FactoryId>(value.id), revision: value.revision, name: value.name, nodes: new Map(nodes.map((node) => [node.id, node])), edges: new Map(edges.map((edge) => [edge.id, edge])), externalPorts: value.externalPorts.map((port) => ({ ...port, nodeId: asId<NodeId>(port.nodeId), portId: asId<PortId>(port.portId) })) }
    return deserializeBlueprint(serializeBlueprint(legacy))
  }
  assertUnique(value.nets, 'net'); assertUnique(value.tracks, 'track'); assertUnique(value.transitions, 'transition')
  const nets = value.nets.map(deserializeNet); const tracks = value.tracks.map(deserializeTrack); const transitions = value.transitions.map(deserializeTransition)
  const serializedLoose = value.schemaVersion === 3 ? value.looseConnections : []; assertUnique(serializedLoose, 'loose connection'); const looseConnections = serializedLoose.map(deserializeLooseConnection)
  return repairProjectedEndpoints({ id: asId<FactoryId>(value.id), revision: value.revision, name: value.name, nodes: new Map(nodes.map((node) => [node.id, node])), edges: new Map(edges.map((edge) => [edge.id, edge])), nets: new Map(nets.map((net) => [net.id, net])), tracks: new Map(tracks.map((track) => [track.id, track])), transitions: new Map(transitions.map((transition) => [transition.id, transition])), looseConnections: new Map(looseConnections.map((loose) => [loose.id, loose])), externalPorts: value.externalPorts.map((port) => ({ ...port, nodeId: asId<NodeId>(port.nodeId), portId: asId<PortId>(port.portId) })) })
}
