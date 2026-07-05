import type { EdgeId, GridPoint, IdFactory, LooseConnectionId, NodeId, PortId } from '../domain'
import type { BlueprintEdge, BlueprintNode, ExternalPort, FactoryBlueprint, LooseConnection } from './blueprint'
import { effectivePortResource, findPort, routeResource, updateBlueprint } from './blueprint'
import { normalizeJunctionPorts, type EditCommand } from './commands'

export interface GraphClipboardPayload {
  readonly nodes: readonly BlueprintNode[]
  readonly edges: readonly BlueprintEdge[]
  readonly looseConnections: readonly LooseConnection[]
  readonly externalPorts: readonly ExternalPort[]
}

export interface MaterializedSubgraph extends GraphClipboardPayload {
  readonly nodeIds: readonly NodeId[]
  readonly edgeIds: readonly EdgeId[]
  readonly looseConnectionIds: readonly LooseConnectionId[]
}

const translatePoint = (point: GridPoint, offset: GridPoint): GridPoint => ({ x: point.x + offset.x, y: point.y + offset.y })

export const createClipboardPayload = (
  nodes: readonly BlueprintNode[],
  edges: readonly BlueprintEdge[] = [],
  externalPorts: readonly ExternalPort[] = [],
  looseConnections: readonly LooseConnection[] = [],
): GraphClipboardPayload | undefined => {
  if (nodes.length === 0) return undefined
  const origin = {
    x: Math.min(...nodes.map((node) => node.position.x)),
    y: Math.min(...nodes.map((node) => node.position.y)),
  }
  const relative = { x: -origin.x, y: -origin.y }
  return {
    nodes: nodes.map((node) => ({ ...node, position: translatePoint(node.position, relative), ports: node.ports.map((port) => ({ ...port })) } as BlueprintNode)),
    edges: edges.map((edge) => ({
      ...edge,
      routeHandles: edge.routeHandles.map((handle) => ({ ...handle, position: translatePoint(handle.position, relative) })),
      bridges: edge.bridges.map((bridge) => ({ ...bridge, position: translatePoint(bridge.position, relative) })),
    })),
    looseConnections: looseConnections.map((loose) => ({
      ...loose,
      origin: { ...loose.origin },
      routeHandles: loose.routeHandles.map((handle) => ({ ...handle, position: translatePoint(handle.position, relative) })),
    })),
    externalPorts: externalPorts.map((port) => ({ ...port })),
  }
}

export const captureSubgraph = (blueprint: FactoryBlueprint, nodeIds: readonly NodeId[], looseConnectionIds: readonly LooseConnectionId[] = []): GraphClipboardPayload | undefined => {
  const explicitlySelectedNodes = new Set(nodeIds)
  const explicitlySelectedLoose = new Set(looseConnectionIds)
  const selectedLoose = [...blueprint.looseConnections.values()].filter((loose) => explicitlySelectedNodes.has(loose.origin.nodeId) || explicitlySelectedLoose.has(loose.id))
  const selected = new Set([...nodeIds, ...selectedLoose.filter((loose) => explicitlySelectedLoose.has(loose.id)).map((loose) => loose.origin.nodeId)])
  const nodes = [...selected].flatMap((id) => {
    const node = blueprint.nodes.get(id)
    return node === undefined ? [] : [node]
  })
  const edges = [...blueprint.edges.values()].filter((edge) => selected.has(edge.sourceNodeId) && selected.has(edge.targetNodeId))
  const externalPorts = blueprint.externalPorts.filter((port) => selected.has(port.nodeId))
  return createClipboardPayload(nodes, edges, externalPorts, selectedLoose)
}

export const materializeSubgraph = (payload: GraphClipboardPayload, anchor: GridPoint, idFactory: IdFactory): MaterializedSubgraph => {
  const nodeIds = new Map<NodeId, NodeId>()
  const portIds = new Map<PortId, PortId>()
  for (const node of payload.nodes) {
    nodeIds.set(node.id, idFactory.next('NodeId'))
    for (const port of node.ports) portIds.set(port.id, idFactory.next('PortId'))
  }
  const nodes = payload.nodes.map((node) => ({
    ...node,
    id: nodeIds.get(node.id)!,
    position: translatePoint(node.position, anchor),
    ports: node.ports.map((port) => ({ ...port, id: portIds.get(port.id)! })),
  } as BlueprintNode))
  const edges = payload.edges.map((edge): BlueprintEdge => ({
    ...edge,
    id: idFactory.next('EdgeId'),
    sourceNodeId: nodeIds.get(edge.sourceNodeId)!,
    sourcePortId: portIds.get(edge.sourcePortId)!,
    targetNodeId: nodeIds.get(edge.targetNodeId)!,
    targetPortId: portIds.get(edge.targetPortId)!,
    routeHandles: edge.routeHandles.map((handle) => ({ id: idFactory.next('RouteHandleId'), position: translatePoint(handle.position, anchor) })),
    bridges: edge.bridges.map((bridge) => ({ id: idFactory.next('RouteBridgeId'), position: translatePoint(bridge.position, anchor) })),
  }))
  const looseConnections = payload.looseConnections.map((loose): LooseConnection => ({
    id: idFactory.next('LooseConnectionId'),
    origin: { nodeId: nodeIds.get(loose.origin.nodeId)!, portId: portIds.get(loose.origin.portId)! },
    routeHandles: loose.routeHandles.map((handle) => ({ id: idFactory.next('RouteHandleId'), position: translatePoint(handle.position, anchor) })),
  }))
  const externalPorts = payload.externalPorts.map((port) => ({ ...port, nodeId: nodeIds.get(port.nodeId)!, portId: portIds.get(port.portId)! }))
  return { nodes, edges, looseConnections, externalPorts, nodeIds: nodes.map((node) => node.id), edgeIds: edges.map((edge) => edge.id), looseConnectionIds: looseConnections.map((loose) => loose.id) }
}

export const translateSubgraph = (subgraph: MaterializedSubgraph, anchor: GridPoint): MaterializedSubgraph => ({
  ...subgraph,
  nodes: subgraph.nodes.map((node) => ({ ...node, position: translatePoint(node.position, anchor) } as BlueprintNode)),
  edges: subgraph.edges.map((edge) => ({
    ...edge,
    routeHandles: edge.routeHandles.map((handle) => ({ ...handle, position: translatePoint(handle.position, anchor) })),
    bridges: edge.bridges.map((bridge) => ({ ...bridge, position: translatePoint(bridge.position, anchor) })),
  })),
  looseConnections: subgraph.looseConnections.map((loose) => ({
    ...loose,
    routeHandles: loose.routeHandles.map((handle) => ({ ...handle, position: translatePoint(handle.position, anchor) })),
  })),
})

const assertUnique = <Id extends string>(existing: ReadonlyMap<Id, unknown>, ids: readonly Id[], kind: string): void => {
  const seen = new Set<Id>()
  for (const id of ids) {
    if (existing.has(id) || seen.has(id)) throw new Error(`${kind} ${id} already exists`)
    seen.add(id)
  }
}

export const insertSubgraph = (subgraph: MaterializedSubgraph, label = 'Paste selection'): EditCommand => ({
  label,
  affectsCompilation: true,
  apply(blueprint) {
    assertUnique(blueprint.nodes, subgraph.nodeIds, 'Node')
    assertUnique(blueprint.edges, subgraph.edgeIds, 'Edge')
    assertUnique(blueprint.looseConnections, subgraph.looseConnectionIds, 'Loose connection')
    const nodes = new Map(blueprint.nodes)
    for (const node of subgraph.nodes) nodes.set(node.id, node)
    const edges = new Map(blueprint.edges)
    for (const edge of subgraph.edges) edges.set(edge.id, edge)
    const looseConnections = new Map(blueprint.looseConnections)
    for (const loose of subgraph.looseConnections) looseConnections.set(loose.id, loose)
    let candidate: FactoryBlueprint = { ...blueprint, nodes, edges, looseConnections, externalPorts: [...blueprint.externalPorts, ...subgraph.externalPorts] }
    candidate = normalizeJunctionPorts(candidate)

    const occupied = new Set<PortId>()
    for (const edge of candidate.edges.values()) {
      const source = findPort(candidate, edge.sourceNodeId, edge.sourcePortId)
      const target = findPort(candidate, edge.targetNodeId, edge.targetPortId)
      if (source?.direction !== 'output' || target?.direction !== 'input') throw new Error('Connections must run from an output to an input')
      if (occupied.has(source.id) || occupied.has(target.id)) throw new Error('A port can carry only one route')
      occupied.add(source.id); occupied.add(target.id)
      const sourceResource = effectivePortResource(candidate, edge.sourceNodeId, edge.sourcePortId)
      const targetResource = effectivePortResource(candidate, edge.targetNodeId, edge.targetPortId)
      if (sourceResource !== undefined && targetResource !== undefined && sourceResource !== targetResource) throw new Error('Connected ports must transport the same resource')
    }
    for (const loose of candidate.looseConnections.values()) {
      if (findPort(candidate, loose.origin.nodeId, loose.origin.portId) === undefined) throw new Error('An incomplete route must reference a pasted component port')
      if (occupied.has(loose.origin.portId)) throw new Error('A port can carry only one route')
      occupied.add(loose.origin.portId)
    }
    for (const external of subgraph.externalPorts) {
      const port = findPort(candidate, external.nodeId, external.portId)
      if (port === undefined) throw new Error('An external port must reference a pasted component port')
    }

    const resources = new Set<string>()
    for (const edge of subgraph.edges) {
      const resource = routeResource(candidate, edge)
      if (resource !== undefined) resources.add(resource)
    }
    const childContracts = new Set(subgraph.nodes.flatMap((node) => node.kind === 'sub-factory' ? [node.contractId] : []))
    const next = updateBlueprint(blueprint, { nodes: candidate.nodes, edges: candidate.edges, looseConnections: candidate.looseConnections, externalPorts: candidate.externalPorts })
    return { blueprint: next, changes: { resources, childContracts, structureChanged: true } }
  },
})

export const subgraphSelection = (subgraph: MaterializedSubgraph): { readonly nodeIds: readonly NodeId[]; readonly edgeIds: readonly EdgeId[]; readonly looseConnectionIds: readonly LooseConnectionId[] } => ({
  nodeIds: subgraph.nodeIds,
  edgeIds: subgraph.edgeIds,
  looseConnectionIds: subgraph.looseConnectionIds,
})
