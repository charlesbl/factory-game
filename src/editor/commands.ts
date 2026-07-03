import type { EdgeId, GridPoint, IdFactory, LooseConnectionId, NetId, NodeId, PortId, RecipeId, RouteConnectorId, TrackId, TransitionId } from '../domain'
import type { BlueprintEdge, BlueprintNode, ConveyorTrack, ConveyorTransition, ExternalPort, FactoryBlueprint, LooseConnection, RouteConnector, SubFactoryNode, TransportNet } from './blueprint'
import { blueprintLooseConnections, blueprintNets, blueprintTracks, blueprintTransitions, effectivePortResource, findPort, legacyNetForEdge, legacyTrackForEdge, updateBlueprint } from './blueprint'
import { edgeRoute } from './connector-route'
import { cellsOnTrack } from './routing'

export interface ChangeSet {
  readonly resources: ReadonlySet<string>
  readonly childContracts: ReadonlySet<string>
  readonly structureChanged: boolean
}
export interface EditResult { readonly blueprint: FactoryBlueprint; readonly changes: ChangeSet }
export interface EditCommand {
  readonly label: string
  readonly affectsCompilation: boolean
  apply(blueprint: FactoryBlueprint): EditResult
}

const changes = (structureChanged = true, resources: readonly string[] = [], childContracts: readonly string[] = []): ChangeSet => ({
  resources: new Set(resources), childContracts: new Set(childContracts), structureChanged,
})
const result = (blueprint: FactoryBlueprint, command: EditCommand, update: Partial<Omit<FactoryBlueprint, 'id' | 'revision'>>, changeSet = changes()): EditResult => ({
  blueprint: updateBlueprint(blueprint, update, command.affectsCompilation), changes: changeSet,
})

const connectorList = (edge: BlueprintEdge): readonly RouteConnector[] => edge.routeConnectors ?? edge.points.slice(1, -1).map((position, index) => ({ id: `${edge.id}:connector:${index}` as RouteConnectorId, position }))
const replaceEdgeRoute = (blueprint: FactoryBlueprint, edge: BlueprintEdge): Pick<FactoryBlueprint, 'edges' | 'tracks' | 'transitions'> => {
  const materialized = { ...edge, points: edgeRoute(blueprint, edge).points }
  const net = blueprintNets(blueprint).get(legacyNetForEdge(edge).id) ?? legacyNetForEdge(edge)
  const tracks = new Map([...blueprintTracks(blueprint)].flatMap(([id, track]) => {
    if (!track.netIds.includes(net.id)) return [[id, track] as const]
    const netIds = track.netIds.filter((value) => value !== net.id); return netIds.length === 0 ? [] : [[id, { ...track, netIds }] as const]
  }))
  const replacement = legacyTrackForEdge(materialized); const replacementId = tracks.has(replacement.id) ? `${replacement.id}:connectors:${blueprint.revision + 1}` as TrackId : replacement.id
  tracks.set(replacementId, { ...replacement, id: replacementId, netIds: [net.id], points: materialized.points })
  const transitions = new Map([...blueprintTransitions(blueprint)].flatMap(([id, transition]) => { const netIds = transition.netIds.filter((value) => value !== net.id); return netIds.length === 0 ? [] : [[id, { ...transition, netIds }] as const] }))
  return { edges: new Map(blueprint.edges).set(edge.id, materialized), tracks, transitions }
}

export const addNode = (node: BlueprintNode): EditCommand => ({
  label: `Add ${node.name}`, affectsCompilation: true,
  apply(blueprint) {
    if (blueprint.nodes.has(node.id)) throw new Error(`Node ${node.id} already exists`)
    return result(blueprint, this, { nodes: new Map(blueprint.nodes).set(node.id, node) })
  },
})
export const moveNode = (nodeId: NodeId, position: GridPoint): EditCommand => ({
  label: 'Move node', affectsCompilation: true,
  apply(blueprint) {
    const node = blueprint.nodes.get(nodeId)
    if (node === undefined) throw new Error(`Unknown node ${nodeId}`)
    const movedNode = { ...node, position } as BlueprintNode
    const nodes = new Map(blueprint.nodes).set(nodeId, movedNode)
    const base = { ...blueprint, nodes }
    const edges = new Map([...blueprint.edges].map(([edgeId, edge]) => {
      if (edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId) return [edgeId, edge] as const
      return [edgeId, { ...edge, points: edgeRoute(base, edge).points }] as const
    }))
    const tracks = new Map(blueprintTracks(blueprint)); const next = { ...base, edges }
    for (const edge of edges.values()) {
      if (edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId) continue
      const netId = legacyNetForEdge(edge).id
      for (const [trackId, track] of tracks) if (track.netIds.includes(netId)) tracks.set(trackId, { ...track, points: edgeRoute(next, edge).points })
    }
    return result(blueprint, this, { nodes, edges, tracks })
  },
})
export const removeNode = (nodeId: NodeId): EditCommand => ({
  label: 'Remove node', affectsCompilation: true,
  apply(blueprint) {
    if (!blueprint.nodes.has(nodeId)) return { blueprint, changes: changes(false) }
    const nodes = new Map(blueprint.nodes); nodes.delete(nodeId)
    const edges = new Map([...blueprint.edges].filter(([, edge]) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId))
    const nets = new Map([...blueprintNets(blueprint)].filter(([, net]) => net.source.nodeId !== nodeId && !net.targets.some((target) => target.nodeId === nodeId)))
    const tracks = new Map([...blueprintTracks(blueprint)].flatMap(([id, track]) => { const netIds = track.netIds.filter((netId) => nets.has(netId)); return netIds.length === 0 ? [] : [[id, { ...track, netIds }] as const] }))
    const transitions = new Map([...blueprintTransitions(blueprint)].flatMap(([id, transition]) => { const netIds = transition.netIds.filter((netId) => nets.has(netId)); return netIds.length === 0 ? [] : [[id, { ...transition, netIds }] as const] }))
    const looseConnections = new Map([...blueprintLooseConnections(blueprint)].filter(([, loose]) => loose.origin.nodeId !== nodeId))
    return result(blueprint, this, { nodes, edges, nets, tracks, transitions, looseConnections, externalPorts: blueprint.externalPorts.filter((port) => port.nodeId !== nodeId) })
  },
})
export const connectPorts = (edge: BlueprintEdge): EditCommand => ({
  label: 'Connect ports', affectsCompilation: true,
  apply(blueprint) {
    if (blueprint.edges.has(edge.id)) throw new Error(`Edge ${edge.id} already exists`)
    const source = findPort(blueprint, edge.sourceNodeId, edge.sourcePortId)
    const target = findPort(blueprint, edge.targetNodeId, edge.targetPortId)
    if (source?.direction !== 'output' || target?.direction !== 'input') throw new Error('Connections must run from an output to an input')
    const sourceResource = effectivePortResource(blueprint, edge.sourceNodeId, edge.sourcePortId)
    const targetResource = effectivePortResource(blueprint, edge.targetNodeId, edge.targetPortId)
    if ((sourceResource !== undefined && sourceResource !== edge.resourceId) || (targetResource !== undefined && targetResource !== edge.resourceId)) throw new Error('Connected ports must transport the same resource')
    const materialized = { ...edge, routeConnectors: connectorList(edge), points: edgeRoute(blueprint, edge).points }
    const net = legacyNetForEdge(materialized); const track = legacyTrackForEdge(materialized)
    return result(blueprint, this, { edges: new Map(blueprint.edges).set(edge.id, materialized), nets: new Map(blueprintNets(blueprint)).set(net.id, net), tracks: new Map(blueprintTracks(blueprint)).set(track.id, track), transitions: new Map(blueprintTransitions(blueprint)) }, changes(true, [edge.resourceId]))
  },
})
export const disconnectEdge = (edgeId: BlueprintEdge['id']): EditCommand => ({
  label: 'Disconnect ports', affectsCompilation: true,
  apply(blueprint) {
    const edge = blueprint.edges.get(edgeId)
    if (edge === undefined) return { blueprint, changes: changes(false) }
    const edges = new Map(blueprint.edges); edges.delete(edgeId)
    const legacyNet = legacyNetForEdge(edge); const nets = new Map(blueprintNets(blueprint)); nets.delete(legacyNet.id)
    const tracks = new Map([...blueprintTracks(blueprint)].flatMap(([id, track]) => { const netIds = track.netIds.filter((netId) => netId !== legacyNet.id); return netIds.length === 0 ? [] : [[id, { ...track, netIds }] as const] }))
    const transitions = new Map([...blueprintTransitions(blueprint)].flatMap(([id, transition]) => { const netIds = transition.netIds.filter((netId) => netId !== legacyNet.id); return netIds.length === 0 ? [] : [[id, { ...transition, netIds }] as const] }))
    return result(blueprint, this, { edges, nets, tracks, transitions }, changes(true, [edge.resourceId]))
  },
})
export const changeConnectionGeometry = (edgeId: BlueprintEdge['id'], points: BlueprintEdge['points']): EditCommand => ({
  label: 'Route connection', affectsCompilation: true,
  apply(blueprint) {
    const edge = blueprint.edges.get(edgeId)
    if (edge === undefined) throw new Error(`Unknown edge ${edgeId}`)
    const routeConnectors = points.slice(1, -1).map((position, index) => ({ id: `${edge.id}:connector:${blueprint.revision + 1}:${index}` as RouteConnectorId, position }))
    const update = replaceEdgeRoute(blueprint, { ...edge, points, routeConnectors })
    return result(blueprint, this, update, changes(true, [edge.resourceId]))
  },
})

export const addLooseConnection = (loose: LooseConnection): EditCommand => ({
  label: 'Start connection', affectsCompilation: false,
  apply(blueprint) {
    if (blueprintLooseConnections(blueprint).has(loose.id)) throw new Error(`Loose connection ${loose.id} already exists`)
    if (loose.routeConnectors.length === 0) throw new Error('A loose connection requires a free endpoint')
    return result(blueprint, this, { looseConnections: new Map(blueprintLooseConnections(blueprint)).set(loose.id, loose) }, changes(false))
  },
})
export const extendLooseConnection = (looseId: LooseConnectionId, connector: RouteConnector): EditCommand => ({
  label: 'Extend connection', affectsCompilation: false,
  apply(blueprint) {
    const loose = blueprintLooseConnections(blueprint).get(looseId); if (loose === undefined) throw new Error(`Unknown loose connection ${looseId}`)
    return result(blueprint, this, { looseConnections: new Map(blueprintLooseConnections(blueprint)).set(looseId, { ...loose, routeConnectors: [...loose.routeConnectors, connector] }) }, changes(false))
  },
})
export const moveLooseConnector = (looseId: LooseConnectionId, connectorId: RouteConnectorId, position: GridPoint): EditCommand => ({
  label: 'Move connector', affectsCompilation: false,
  apply(blueprint) {
    const loose = blueprintLooseConnections(blueprint).get(looseId); if (loose === undefined) throw new Error(`Unknown loose connection ${looseId}`)
    const routeConnectors = loose.routeConnectors.map((connector) => connector.id === connectorId ? { ...connector, position } : connector)
    return result(blueprint, this, { looseConnections: new Map(blueprintLooseConnections(blueprint)).set(looseId, { ...loose, routeConnectors }) }, changes(false))
  },
})
export const removeLooseConnector = (looseId: LooseConnectionId, connectorId: RouteConnectorId): EditCommand => ({
  label: 'Remove connector', affectsCompilation: false,
  apply(blueprint) {
    const loose = blueprintLooseConnections(blueprint).get(looseId); if (loose === undefined) return { blueprint, changes: changes(false) }
    const routeConnectors = loose.routeConnectors.filter((connector) => connector.id !== connectorId); const looseConnections = new Map(blueprintLooseConnections(blueprint))
    if (routeConnectors.length === 0) looseConnections.delete(looseId); else looseConnections.set(looseId, { ...loose, routeConnectors })
    return result(blueprint, this, { looseConnections }, changes(false))
  },
})
export const removeLooseConnection = (looseId: LooseConnectionId): EditCommand => ({ label: 'Remove incomplete connection', affectsCompilation: false, apply(blueprint) { const looseConnections = new Map(blueprintLooseConnections(blueprint)); if (!looseConnections.delete(looseId)) return { blueprint, changes: changes(false) }; return result(blueprint, this, { looseConnections }, changes(false)) } })

const changeRouteConnectors = (edgeId: EdgeId, label: string, transform: (connectors: readonly RouteConnector[]) => readonly RouteConnector[]): EditCommand => ({
  label, affectsCompilation: true,
  apply(blueprint) {
    const edge = blueprint.edges.get(edgeId); if (edge === undefined) throw new Error(`Unknown edge ${edgeId}`)
    const update = replaceEdgeRoute(blueprint, { ...edge, routeConnectors: transform(connectorList(edge)) })
    return result(blueprint, this, update, changes(true, [edge.resourceId]))
  },
})
export const moveRouteConnector = (edgeId: EdgeId, connectorId: RouteConnectorId, position: GridPoint): EditCommand => changeRouteConnectors(edgeId, 'Move connector', (connectors) => connectors.map((connector) => connector.id === connectorId ? { ...connector, position } : connector))
export const insertRouteConnector = (edgeId: EdgeId, index: number, connector: RouteConnector): EditCommand => changeRouteConnectors(edgeId, 'Add connector', (connectors) => [...connectors.slice(0, index), connector, ...connectors.slice(index)])
export const removeRouteConnector = (edgeId: EdgeId, connectorId: RouteConnectorId): EditCommand => changeRouteConnectors(edgeId, 'Remove connector', (connectors) => connectors.filter((connector) => connector.id !== connectorId))

export const completeLooseConnection = (looseId: LooseConnectionId, targetNodeId: NodeId, targetPortId: PortId, edgeId: EdgeId): EditCommand => ({
  label: 'Complete connection', affectsCompilation: true,
  apply(blueprint) {
    const loose = blueprintLooseConnections(blueprint).get(looseId); if (loose === undefined) throw new Error(`Unknown loose connection ${looseId}`)
    const originPort = findPort(blueprint, loose.origin.nodeId, loose.origin.portId); const targetPort = findPort(blueprint, targetNodeId, targetPortId)
    if (originPort === undefined || targetPort === undefined || originPort.direction === targetPort.direction) throw new Error('A connection must join an output to an input')
    const targetResource = effectivePortResource(blueprint, targetNodeId, targetPortId)
    if (targetResource !== undefined && targetResource !== loose.resourceId) throw new Error('Connected ports must transport the same resource')
    const forward = originPort.direction === 'output'; const source = forward ? loose.origin : { nodeId: targetNodeId, portId: targetPortId }; const target = forward ? { nodeId: targetNodeId, portId: targetPortId } : loose.origin
    const routeConnectors = forward ? loose.routeConnectors : [...loose.routeConnectors].reverse()
    const capacity = loose.capacity < targetPort.capacity ? loose.capacity : targetPort.capacity
    const edge: BlueprintEdge = { id: edgeId, sourceNodeId: source.nodeId, sourcePortId: source.portId, targetNodeId: target.nodeId, targetPortId: target.portId, resourceId: loose.resourceId, capacity, points: [], routeConnectors }
    const materialized = { ...edge, points: edgeRoute(blueprint, edge).points }; const net = legacyNetForEdge(materialized); const track = legacyTrackForEdge(materialized)
    const looseConnections = new Map(blueprintLooseConnections(blueprint)); looseConnections.delete(looseId)
    return result(blueprint, this, { looseConnections, edges: new Map(blueprint.edges).set(edgeId, materialized), nets: new Map(blueprintNets(blueprint)).set(net.id, net), tracks: new Map(blueprintTracks(blueprint)).set(track.id, track), transitions: new Map(blueprintTransitions(blueprint)) }, changes(true, [edge.resourceId]))
  },
})

const compressCells = (cells: readonly GridPoint[]): readonly GridPoint[] => {
  const points: GridPoint[] = []
  for (const cell of cells) {
    const previous = points.at(-1); const before = points.at(-2)
    if (previous !== undefined && previous.x === cell.x && previous.y === cell.y) continue
    if (before !== undefined && previous !== undefined && (before.x === previous.x) === (previous.x === cell.x)) points[points.length - 1] = cell
    else points.push(cell)
  }
  return points
}
export const addBridgeAt = (edgeId: EdgeId, position: GridPoint): EditCommand => ({
  label: 'Add bridge', affectsCompilation: true,
  apply(blueprint) {
    const edge = blueprint.edges.get(edgeId); if (edge === undefined) throw new Error(`Unknown edge ${edgeId}`)
    const cells = cellsOnTrack(edgeRoute(blueprint, edge).points); const crossingIndex = cells.findIndex((cell) => cell.x === position.x && cell.y === position.y)
    if (crossingIndex < 2 || crossingIndex > cells.length - 3) return { blueprint, changes: changes(false) }
    const net = blueprintNets(blueprint).get(legacyNetForEdge(edge).id) ?? legacyNetForEdge(edge); const token = `${edge.id}:bridge:${blueprint.revision + 1}`
    const before = compressCells(cells.slice(0, crossingIndex)); const bridge = compressCells(cells.slice(crossingIndex - 1, crossingIndex + 2)); const after = compressCells(cells.slice(crossingIndex + 1))
    const tracks = new Map([...blueprintTracks(blueprint)].flatMap(([id, track]) => { if (!track.netIds.includes(net.id)) return [[id, track] as const]; const netIds = track.netIds.filter((value) => value !== net.id); return netIds.length === 0 ? [] : [[id, { ...track, netIds }] as const] }))
    tracks.set(`${token}:before` as TrackId, { id: `${token}:before` as TrackId, netIds: [net.id], resourceId: edge.resourceId, capacity: edge.capacity, layerId: 'primary', points: before })
    tracks.set(`${token}:span` as TrackId, { id: `${token}:span` as TrackId, netIds: [net.id], resourceId: edge.resourceId, capacity: edge.capacity, layerId: 'bridge', points: bridge })
    tracks.set(`${token}:after` as TrackId, { id: `${token}:after` as TrackId, netIds: [net.id], resourceId: edge.resourceId, capacity: edge.capacity, layerId: 'primary', points: after })
    const transitions = new Map([...blueprintTransitions(blueprint)].flatMap(([id, transition]) => { const netIds = transition.netIds.filter((value) => value !== net.id); return netIds.length === 0 ? [] : [[id, { ...transition, netIds }] as const] }))
    const entry = cells[crossingIndex - 1]!; const exit = cells[crossingIndex + 1]!; const direction = entry.x === exit.x ? 'vertical' as const : 'horizontal' as const
    transitions.set(`${token}:enter` as TransitionId, { id: `${token}:enter` as TransitionId, netIds: [net.id], resourceId: edge.resourceId, position: entry, entryLayerId: 'primary', exitLayerId: 'bridge', direction, capacity: edge.capacity, length: 1 })
    transitions.set(`${token}:exit` as TransitionId, { id: `${token}:exit` as TransitionId, netIds: [net.id], resourceId: edge.resourceId, position: exit, entryLayerId: 'bridge', exitLayerId: 'primary', direction, capacity: edge.capacity, length: 1 })
    return result(blueprint, this, { tracks, transitions }, changes(true, [edge.resourceId]))
  },
})

export const addTransportIntent = (net: TransportNet): EditCommand => ({
  label: 'Add transport intent', affectsCompilation: true,
  apply(blueprint) {
    if (blueprintNets(blueprint).has(net.id)) throw new Error(`Net ${net.id} already exists`)
    return result(blueprint, this, { nets: new Map(blueprintNets(blueprint)).set(net.id, net), tracks: new Map(blueprintTracks(blueprint)), transitions: new Map(blueprintTransitions(blueprint)) }, changes(true, [net.resourceId]))
  },
})
export const commitPhysicalRoute = (net: TransportNet, tracksToAdd: readonly ConveyorTrack[], transitionsToAdd: readonly ConveyorTransition[] = [], edge?: BlueprintEdge): EditCommand => ({
  label: 'Route conveyor', affectsCompilation: true,
  apply(blueprint) {
    const nets = new Map(blueprintNets(blueprint)).set(net.id, net); const tracks = new Map(blueprintTracks(blueprint)); const transitions = new Map(blueprintTransitions(blueprint))
    for (const track of tracksToAdd) { if (tracks.has(track.id)) throw new Error(`Track ${track.id} already exists`); tracks.set(track.id, track) }
    for (const transition of transitionsToAdd) { if (transitions.has(transition.id)) throw new Error(`Transition ${transition.id} already exists`); transitions.set(transition.id, transition) }
    return result(blueprint, this, { nets, tracks, transitions, ...(edge === undefined ? {} : { edges: new Map(blueprint.edges).set(edge.id, edge) }) }, changes(true, [net.resourceId]))
  },
})
export const changeRouteCapacity = (edgeId: BlueprintEdge['id'], capacity: BlueprintEdge['capacity']): EditCommand => ({
  label: 'Upgrade conveyor capacity', affectsCompilation: true,
  apply(blueprint) {
    const edge = blueprint.edges.get(edgeId); if (edge === undefined) throw new Error(`Unknown edge ${edgeId}`); if (capacity <= 0n) throw new Error('Conveyor capacity must be positive')
    const legacy = legacyNetForEdge(edge); const nets = new Map(blueprintNets(blueprint)); const net = nets.get(legacy.id) ?? [...nets.values()].find((candidate) => candidate.source.portId === edge.sourcePortId && candidate.targets.some((target) => target.portId === edge.targetPortId))
    if (net !== undefined) nets.set(net.id, { ...net, requestedCapacity: capacity })
    const tracks = new Map([...blueprintTracks(blueprint)].map(([id, track]) => net !== undefined && track.netIds.includes(net.id) ? [id, { ...track, capacity }] : [id, track]))
    return result(blueprint, this, { edges: new Map(blueprint.edges).set(edgeId, { ...edge, capacity }), nets, tracks }, changes(true, [edge.resourceId]))
  },
})
export const removeTransportNet = (netId: NetId): EditCommand => ({
  label: 'Delete route', affectsCompilation: true,
  apply(blueprint) {
    const net = blueprintNets(blueprint).get(netId); if (net === undefined) return { blueprint, changes: changes(false) }
    const nets = new Map(blueprintNets(blueprint)); nets.delete(netId)
    const tracks = new Map([...blueprintTracks(blueprint)].flatMap(([id, track]) => { const netIds = track.netIds.filter((value) => value !== netId); return netIds.length === 0 ? [] : [[id, { ...track, netIds }] as const] }))
    const transitions = new Map([...blueprintTransitions(blueprint)].flatMap(([id, transition]) => { const netIds = transition.netIds.filter((value) => value !== netId); return netIds.length === 0 ? [] : [[id, { ...transition, netIds }] as const] }))
    return result(blueprint, this, { nets, tracks, transitions }, changes(true, [net.resourceId]))
  },
})
export const removeTrack = (trackId: TrackId): EditCommand => ({ label: 'Delete conveyor branch', affectsCompilation: true, apply(blueprint) { const track = blueprintTracks(blueprint).get(trackId); if (track === undefined) return { blueprint, changes: changes(false) }; const tracks = new Map(blueprintTracks(blueprint)); tracks.delete(trackId); return result(blueprint, this, { tracks }, changes(true, [track.resourceId])) } })
export const removeTransition = (transitionId: TransitionId): EditCommand => ({ label: 'Remove bridge', affectsCompilation: true, apply(blueprint) { const transition = blueprintTransitions(blueprint).get(transitionId); if (transition === undefined) return { blueprint, changes: changes(false) }; const transitions = new Map(blueprintTransitions(blueprint)); transitions.delete(transitionId); return result(blueprint, this, { transitions }, changes(true, [transition.resourceId])) } })
export const changeRecipe = (nodeId: NodeId, recipeId: RecipeId): EditCommand => ({
  label: 'Change recipe', affectsCompilation: true,
  apply(blueprint) {
    const node = blueprint.nodes.get(nodeId)
    if (node?.kind !== 'machine') throw new Error('Only machines have recipes')
    return result(blueprint, this, { nodes: new Map(blueprint.nodes).set(nodeId, { ...node, recipeId }) })
  },
})
export const renameFactory = (name: string): EditCommand => ({
  label: 'Rename factory', affectsCompilation: false,
  apply(blueprint) { return result(blueprint, this, { name }, changes(false)) },
})
export const addExternalPort = (port: ExternalPort): EditCommand => ({ label: 'Add external port', affectsCompilation: true, apply(blueprint) { return result(blueprint, this, { externalPorts: [...blueprint.externalPorts, port] }) } })
export const moveExternalPort = (portId: PortId, side: ExternalPort['side'], offset: number): EditCommand => ({ label: 'Move external port', affectsCompilation: true, apply(blueprint) { return result(blueprint, this, { externalPorts: blueprint.externalPorts.map((port) => port.portId === portId ? { ...port, side, offset } : port) }) } })
export const removeExternalPort = (portId: PortId): EditCommand => ({ label: 'Remove external port', affectsCompilation: true, apply(blueprint) { return result(blueprint, this, { externalPorts: blueprint.externalPorts.filter((port) => port.portId !== portId) }) } })
export const replaceSubFactoryContract = (nodeId: NodeId, contractId: SubFactoryNode['contractId']): EditCommand => ({
  label: 'Update sub-factory', affectsCompilation: true,
  apply(blueprint) {
    const node = blueprint.nodes.get(nodeId)
    if (node?.kind !== 'sub-factory') throw new Error('Node is not a sub-factory')
    return result(blueprint, this, { nodes: new Map(blueprint.nodes).set(nodeId, { ...node, contractId }) }, changes(true, [], [contractId]))
  },
})
export const transaction = (label: string, commands: readonly EditCommand[]): EditCommand => ({
  label, affectsCompilation: commands.some((command) => command.affectsCompilation),
  apply(blueprint) {
    let current = blueprint
    const resources = new Set<string>(); const children = new Set<string>(); let structural = false
    for (const command of commands) {
      const applied = command.apply(current); current = applied.blueprint
      applied.changes.resources.forEach((value) => resources.add(value)); applied.changes.childContracts.forEach((value) => children.add(value)); structural ||= applied.changes.structureChanged
    }
    return { blueprint: current, changes: { resources, childContracts: children, structureChanged: structural } }
  },
})

export const duplicateNodes = (blueprint: FactoryBlueprint, ids: readonly NodeId[], idFactory: IdFactory): EditCommand => {
  const selected = ids.map((id) => blueprint.nodes.get(id)).filter((node): node is BlueprintNode => node !== undefined)
  const copies = selected.map((node) => ({
    ...node,
    id: idFactory.next('NodeId'),
    position: { x: node.position.x + 2, y: node.position.y + 2 },
    ports: node.ports.map((port) => ({ ...port, id: idFactory.next('PortId') })),
  })) as BlueprintNode[]
  return transaction('Duplicate nodes', copies.map(addNode))
}
