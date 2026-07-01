import { asId } from '../domain'
import type { ContractId, EdgeId, FactoryId, NodeId, PortId, RecipeId, ResourceId } from '../domain'
import type { BlueprintEdge, BlueprintNode, BlueprintPort, ExternalPort, FactoryBlueprint } from './blueprint'

interface SerializedPort { readonly id: string; readonly direction: 'input' | 'output'; readonly resourceId: string; readonly capacity: string; readonly anchor: { readonly x: number; readonly y: number }; readonly maxConnections: number }
interface SerializedNode { readonly id: string; readonly kind: BlueprintNode['kind']; readonly name: string; readonly position: { readonly x: number; readonly y: number }; readonly footprint: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }; readonly ports: readonly SerializedPort[]; readonly recipeId?: string; readonly contractId?: string }
interface SerializedEdge { readonly id: string; readonly sourceNodeId: string; readonly sourcePortId: string; readonly targetNodeId: string; readonly targetPortId: string; readonly resourceId: string; readonly capacity: string; readonly points: readonly { readonly x: number; readonly y: number }[] }
export interface SerializedBlueprint { readonly schemaVersion: 1; readonly id: string; readonly revision: number; readonly name: string; readonly nodes: readonly SerializedNode[]; readonly edges: readonly SerializedEdge[]; readonly externalPorts: readonly ExternalPort[] }

const byId = <T extends { readonly id: string }>(a: T, b: T): number => a.id.localeCompare(b.id)
const serializePort = (port: BlueprintPort): SerializedPort => ({ ...port, capacity: port.capacity.toString() })
export const serializeBlueprint = (blueprint: FactoryBlueprint): SerializedBlueprint => ({
  schemaVersion: 1, id: blueprint.id, revision: blueprint.revision, name: blueprint.name,
  nodes: [...blueprint.nodes.values()].sort(byId).map((node) => ({ ...node, ports: node.ports.map(serializePort) })),
  edges: [...blueprint.edges.values()].sort(byId).map((edge) => ({ ...edge, capacity: edge.capacity.toString() })),
  externalPorts: [...blueprint.externalPorts].sort((a, b) => a.portId.localeCompare(b.portId)),
})
export const canonicalBlueprint = (blueprint: FactoryBlueprint): string => JSON.stringify(serializeBlueprint(blueprint))

const deserializePort = (port: SerializedPort): BlueprintPort => ({ ...port, id: asId<PortId>(port.id), resourceId: asId<ResourceId>(port.resourceId), capacity: BigInt(port.capacity) })
const deserializeNode = (node: SerializedNode): BlueprintNode => {
  const base = { id: asId<NodeId>(node.id), kind: node.kind, name: node.name, position: node.position, footprint: node.footprint, ports: node.ports.map(deserializePort) }
  if (node.kind === 'machine') { if (node.recipeId === undefined) throw new Error('Machine recipe is missing'); return { ...base, kind: 'machine', recipeId: asId<RecipeId>(node.recipeId) } }
  if (node.kind === 'sub-factory') { if (node.contractId === undefined) throw new Error('Sub-factory contract is missing'); return { ...base, kind: 'sub-factory', contractId: asId<ContractId>(node.contractId) } }
  if (node.kind === 'junction') return { ...base, kind: 'junction' }
  return { ...base, kind: node.kind }
}
const deserializeEdge = (edge: SerializedEdge): BlueprintEdge => ({ ...edge, id: asId<EdgeId>(edge.id), sourceNodeId: asId<NodeId>(edge.sourceNodeId), sourcePortId: asId<PortId>(edge.sourcePortId), targetNodeId: asId<NodeId>(edge.targetNodeId), targetPortId: asId<PortId>(edge.targetPortId), resourceId: asId<ResourceId>(edge.resourceId), capacity: BigInt(edge.capacity) })
export const deserializeBlueprint = (value: SerializedBlueprint): FactoryBlueprint => {
  if (value.schemaVersion !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error('Unsupported blueprint schema')
  const nodes = value.nodes.map(deserializeNode); const edges = value.edges.map(deserializeEdge)
  return { id: asId<FactoryId>(value.id), revision: value.revision, name: value.name, nodes: new Map(nodes.map((node) => [node.id, node])), edges: new Map(edges.map((edge) => [edge.id, edge])), externalPorts: value.externalPorts.map((port) => ({ ...port, nodeId: asId<NodeId>(port.nodeId), portId: asId<PortId>(port.portId) })) }
}
