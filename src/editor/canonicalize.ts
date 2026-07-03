import { asId, recipeById } from '../domain'
import type { ContractId, EdgeId, FactoryId, LooseConnectionId, NodeId, PortId, RecipeId, ResourceId, RouteBridgeId, RouteHandleId } from '../domain'
import type { AnyBlueprintPort, BlueprintEdge, BlueprintNode, BlueprintPort, ExternalPort, FactoryBlueprint, JunctionPort, LooseConnection, RouteBridge, RouteHandle } from './blueprint'

interface SerializedPort { readonly id: string; readonly direction: 'input' | 'output'; readonly resourceId?: string; readonly capacity: string; readonly anchor: { readonly x: number; readonly y: number } }
interface SerializedNode { readonly id: string; readonly kind: BlueprintNode['kind']; readonly name: string; readonly position: { readonly x: number; readonly y: number }; readonly footprint: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }; readonly ports: readonly SerializedPort[]; readonly recipeId?: string; readonly contractId?: string }
interface SerializedRouteHandle { readonly id: string; readonly position: { readonly x: number; readonly y: number } }
interface SerializedRouteBridge { readonly id: string; readonly position: { readonly x: number; readonly y: number } }
interface SerializedEdge { readonly id: string; readonly sourceNodeId: string; readonly sourcePortId: string; readonly targetNodeId: string; readonly targetPortId: string; readonly routeHandles: readonly SerializedRouteHandle[]; readonly bridges: readonly SerializedRouteBridge[] }
interface SerializedLooseConnection { readonly id: string; readonly origin: { readonly nodeId: string; readonly portId: string }; readonly routeHandles: readonly SerializedRouteHandle[] }
export interface SerializedBlueprint { readonly schemaVersion: 4; readonly id: string; readonly revision: number; readonly name: string; readonly nodes: readonly SerializedNode[]; readonly edges: readonly SerializedEdge[]; readonly looseConnections: readonly SerializedLooseConnection[]; readonly externalPorts: readonly ExternalPort[] }

const byId = <T extends { readonly id: string }>(a: T, b: T): number => a.id.localeCompare(b.id)
const serializePort = (port: AnyBlueprintPort): SerializedPort => ({ ...port, capacity: port.capacity.toString() })
const serializeNode = (node: BlueprintNode): SerializedNode => ({
  id: node.id, kind: node.kind, name: node.name, position: node.position, footprint: node.footprint, ports: node.ports.map(serializePort),
  ...(node.kind === 'machine' ? { recipeId: node.recipeId } : node.kind === 'sub-factory' ? { contractId: node.contractId } : {}),
})
export const serializeBlueprint = (blueprint: FactoryBlueprint): SerializedBlueprint => ({
  schemaVersion: 4, id: blueprint.id, revision: blueprint.revision, name: blueprint.name,
  nodes: [...blueprint.nodes.values()].sort(byId).map(serializeNode),
  edges: [...blueprint.edges.values()].sort(byId).map((edge) => ({ ...edge, routeHandles: [...edge.routeHandles], bridges: [...edge.bridges].sort(byId) })),
  looseConnections: [...blueprint.looseConnections.values()].sort(byId).map((loose) => ({ ...loose, routeHandles: [...loose.routeHandles] })),
  externalPorts: [...blueprint.externalPorts].sort((a, b) => a.portId.localeCompare(b.portId)),
})
export const canonicalBlueprint = (blueprint: FactoryBlueprint): string => JSON.stringify(serializeBlueprint(blueprint))
export const canonicalCompilationInput = (blueprint: FactoryBlueprint): string => {
  const recipeIds = [...new Set([...blueprint.nodes.values()].flatMap((node) => node.kind === 'machine' ? [node.recipeId] : []))].sort()
  const recipes = recipeIds.map((id) => recipeById.get(id)).filter((recipe) => recipe !== undefined)
  return `${JSON.stringify(serializeBlueprint({ ...blueprint, looseConnections: new Map() }))}|recipes:${JSON.stringify(recipes, (_, value: unknown) => typeof value === 'bigint' ? value.toString() : value)}`
}

const deserializeTypedPort = (port: SerializedPort): BlueprintPort => {
  if (port.resourceId === undefined) throw new Error(`Port ${port.id} resource is missing`)
  return { id: asId<PortId>(port.id), direction: port.direction, resourceId: asId<ResourceId>(port.resourceId), capacity: BigInt(port.capacity), anchor: port.anchor }
}
const deserializeJunctionPort = (port: SerializedPort): JunctionPort => ({ id: asId<PortId>(port.id), direction: port.direction, capacity: BigInt(port.capacity), anchor: port.anchor })
const deserializeNode = (node: SerializedNode): BlueprintNode => {
  const common = { id: asId<NodeId>(node.id), name: node.name, position: node.position, footprint: node.footprint }
  if (node.kind === 'junction') return { ...common, kind: 'junction', ports: node.ports.map(deserializeJunctionPort) }
  const base = { ...common, ports: node.ports.map(deserializeTypedPort) }
  if (node.kind === 'machine') { if (node.recipeId === undefined) throw new Error('Machine recipe is missing'); return { ...base, kind: 'machine', recipeId: asId<RecipeId>(node.recipeId) } }
  if (node.kind === 'sub-factory') { if (node.contractId === undefined) throw new Error('Sub-factory contract is missing'); return { ...base, kind: 'sub-factory', contractId: asId<ContractId>(node.contractId) } }
  return { ...base, kind: node.kind }
}
const deserializeHandle = (handle: SerializedRouteHandle): RouteHandle => ({ id: asId<RouteHandleId>(handle.id), position: handle.position })
const deserializeBridge = (bridge: SerializedRouteBridge): RouteBridge => ({ id: asId<RouteBridgeId>(bridge.id), position: bridge.position })
const deserializeEdge = (edge: SerializedEdge): BlueprintEdge => ({ id: asId<EdgeId>(edge.id), sourceNodeId: asId<NodeId>(edge.sourceNodeId), sourcePortId: asId<PortId>(edge.sourcePortId), targetNodeId: asId<NodeId>(edge.targetNodeId), targetPortId: asId<PortId>(edge.targetPortId), routeHandles: edge.routeHandles.map(deserializeHandle), bridges: edge.bridges.map(deserializeBridge) })
const deserializeLoose = (loose: SerializedLooseConnection): LooseConnection => ({ id: asId<LooseConnectionId>(loose.id), origin: { nodeId: asId<NodeId>(loose.origin.nodeId), portId: asId<PortId>(loose.origin.portId) }, routeHandles: loose.routeHandles.map(deserializeHandle) })
const assertUnique = (values: readonly { readonly id: string }[], label: string): void => { const ids = new Set<string>(); for (const value of values) { if (ids.has(value.id)) throw new Error(`Duplicate ${label} ID: ${value.id}`); ids.add(value.id) } }

export const deserializeBlueprint = (value: unknown): FactoryBlueprint => {
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value) || value.schemaVersion !== 4) throw new Error('Unsupported blueprint schema; expected V4')
  const serialized = value as SerializedBlueprint
  if (!Array.isArray(serialized.nodes) || !Array.isArray(serialized.edges) || !Array.isArray(serialized.looseConnections)) throw new Error('Invalid V4 blueprint')
  assertUnique(serialized.nodes, 'node'); assertUnique(serialized.edges, 'edge'); assertUnique(serialized.looseConnections, 'loose connection')
  const nodes = serialized.nodes.map(deserializeNode); const edges = serialized.edges.map(deserializeEdge); const loose = serialized.looseConnections.map(deserializeLoose)
  return { id: asId<FactoryId>(serialized.id), revision: serialized.revision, name: serialized.name, nodes: new Map(nodes.map((node) => [node.id, node])), edges: new Map(edges.map((edge) => [edge.id, edge])), looseConnections: new Map(loose.map((item) => [item.id, item])), externalPorts: serialized.externalPorts.map((port) => ({ ...port, nodeId: asId<NodeId>(port.nodeId), portId: asId<PortId>(port.portId) })) }
}
