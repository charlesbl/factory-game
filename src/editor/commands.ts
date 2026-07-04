import { asId, parseRate } from '../domain'
import type { EdgeId, GridPoint, IdFactory, LooseConnectionId, NodeId, PortId, RecipeId, RouteBridgeId, RouteHandleId } from '../domain'
import type { BlueprintEdge, BlueprintNode, ExternalPort, FactoryBlueprint, JunctionNode, LooseConnection, RouteHandle, SubFactoryNode, SubFactoryPort } from './blueprint'
import { absolutePortPosition, effectivePortResource, findPort, isPortOccupied, junctionResources, occupiedPortIds, routeResource, updateBlueprint } from './blueprint'
import { edgeRoute } from './connector-route'
import { cellsOnRoute } from './routing'

export interface ChangeSet { readonly resources: ReadonlySet<string>; readonly childContracts: ReadonlySet<string>; readonly structureChanged: boolean }
export interface EditResult { readonly blueprint: FactoryBlueprint; readonly changes: ChangeSet }
export interface EditCommand { readonly label: string; readonly affectsCompilation: boolean; apply(blueprint: FactoryBlueprint): EditResult }

const changes = (structureChanged = true, resources: readonly string[] = [], childContracts: readonly string[] = []): ChangeSet => ({ resources: new Set(resources), childContracts: new Set(childContracts), structureChanged })
const result = (blueprint: FactoryBlueprint, command: EditCommand, update: Partial<Omit<FactoryBlueprint, 'id' | 'revision'>>, changeSet = changes()): EditResult => ({ blueprint: updateBlueprint(blueprint, update, command.affectsCompilation), changes: changeSet })
const samePoint = (a: GridPoint, b: GridPoint): boolean => a.x === b.x && a.y === b.y

export const createJunctionNode = (id: NodeId, position: GridPoint): JunctionNode => ({
  id, kind: 'junction', name: 'Junction', position, footprint: { x: 0, y: 0, width: 3, height: 4 },
  ports: [
    { id: asId<PortId>(`${id}-input-1`), direction: 'input', capacity: parseRate('12'), anchor: { x: 0, y: 1 } },
    { id: asId<PortId>(`${id}-output-1`), direction: 'output', capacity: parseRate('12'), anchor: { x: 3, y: 1 } },
  ],
})

export const normalizeJunctionPorts = (blueprint: FactoryBlueprint): FactoryBlueprint => {
  const occupied = occupiedPortIds(blueprint); let changed = false
  const entries: [NodeId, BlueprintNode][] = [...blueprint.nodes].map(([id, node]) => {
    if (node.kind !== 'junction') return [id, node] as const
    const ports = (['input', 'output'] as const).flatMap((direction) => {
      const directionPorts = node.ports.filter((port) => port.direction === direction)
      const used = directionPorts.filter((port) => occupied.has(port.id)).slice(0, 3)
      if (used.length >= 3) return used
      const usedRows = new Set(used.map((port) => port.anchor.y)); let row = 1
      while (usedRows.has(row) && row <= 3) row += 1
      const existing = directionPorts.find((port) => !occupied.has(port.id) && port.anchor.y === row)
      return [...used, existing ?? { id: asId<PortId>(`${node.id}-${direction}-${row}`), direction, capacity: parseRate('12'), anchor: { x: direction === 'input' ? 0 : 3, y: row } }]
    }).sort((a, b) => a.direction.localeCompare(b.direction) || a.anchor.y - b.anchor.y)
    if (ports.length !== node.ports.length || ports.some((port, index) => port.id !== node.ports[index]?.id)) changed = true
    return [id, changed ? { ...node, ports } as JunctionNode : node] as const
  })
  const nodes = new Map<NodeId, BlueprintNode>(entries)
  return changed ? { ...blueprint, nodes } : blueprint
}

const ensureCompatibleJunctions = (blueprint: FactoryBlueprint): void => {
  for (const node of blueprint.nodes.values()) if (node.kind === 'junction' && junctionResources(blueprint, node.id).size > 1) throw new Error('Connected junctions must transport the same resource')
  for (const edge of blueprint.edges.values()) {
    const source = effectivePortResource(blueprint, edge.sourceNodeId, edge.sourcePortId); const target = effectivePortResource(blueprint, edge.targetNodeId, edge.targetPortId)
    if (source !== undefined && target !== undefined && source !== target) throw new Error('Connected ports must transport the same resource')
  }
}
const withNormalizedUpdate = (blueprint: FactoryBlueprint, update: Partial<Omit<FactoryBlueprint, 'id' | 'revision'>>): Partial<Omit<FactoryBlueprint, 'id' | 'revision'>> => {
  const candidate = normalizeJunctionPorts({ ...blueprint, ...update })
  return { ...update, nodes: candidate.nodes }
}

export const addNode = (node: BlueprintNode): EditCommand => ({
  label: `Add ${node.name}`, affectsCompilation: true,
  apply(blueprint) {
    if (blueprint.nodes.has(node.id)) throw new Error(`Node ${node.id} already exists`)
    return result(blueprint, this, withNormalizedUpdate(blueprint, { nodes: new Map(blueprint.nodes).set(node.id, node) }))
  },
})
export const moveNode = (nodeId: NodeId, position: GridPoint): EditCommand => ({
  label: 'Move node', affectsCompilation: true,
  apply(blueprint) {
    const node = blueprint.nodes.get(nodeId); if (node === undefined) throw new Error(`Unknown node ${nodeId}`)
    return result(blueprint, this, { nodes: new Map(blueprint.nodes).set(nodeId, { ...node, position } as BlueprintNode) })
  },
})
export const removeNode = (nodeId: NodeId): EditCommand => ({
  label: 'Remove node', affectsCompilation: true,
  apply(blueprint) {
    if (!blueprint.nodes.has(nodeId)) return { blueprint, changes: changes(false) }
    const nodes = new Map(blueprint.nodes); nodes.delete(nodeId)
    const edges = new Map([...blueprint.edges].filter(([, edge]) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId))
    const looseConnections = new Map([...blueprint.looseConnections].filter(([, loose]) => loose.origin.nodeId !== nodeId))
    return result(blueprint, this, withNormalizedUpdate(blueprint, { nodes, edges, looseConnections, externalPorts: blueprint.externalPorts.filter((port) => port.nodeId !== nodeId) }))
  },
})

export const connectPorts = (edge: BlueprintEdge): EditCommand => ({
  label: 'Connect ports', affectsCompilation: true,
  apply(blueprint) {
    if (blueprint.edges.has(edge.id)) throw new Error(`Edge ${edge.id} already exists`)
    const source = findPort(blueprint, edge.sourceNodeId, edge.sourcePortId); const target = findPort(blueprint, edge.targetNodeId, edge.targetPortId)
    if (source?.direction !== 'output' || target?.direction !== 'input') throw new Error('Connections must run from an output to an input')
    if (isPortOccupied(blueprint, source.id) || isPortOccupied(blueprint, target.id)) throw new Error('A port can carry only one route')
    const candidate = { ...blueprint, edges: new Map(blueprint.edges).set(edge.id, edge) }; ensureCompatibleJunctions(candidate)
    const resource = routeResource(candidate, edge)
    return result(blueprint, this, withNormalizedUpdate(blueprint, { edges: candidate.edges }), changes(true, resource === undefined ? [] : [resource]))
  },
})
export const disconnectEdge = (edgeId: EdgeId): EditCommand => ({
  label: 'Disconnect ports', affectsCompilation: true,
  apply(blueprint) {
    const edge = blueprint.edges.get(edgeId); if (edge === undefined) return { blueprint, changes: changes(false) }
    const resource = routeResource(blueprint, edge); const edges = new Map(blueprint.edges); edges.delete(edgeId)
    return result(blueprint, this, withNormalizedUpdate(blueprint, { edges }), changes(true, resource === undefined ? [] : [resource]))
  },
})

export const addLooseConnection = (loose: LooseConnection): EditCommand => ({
  label: 'Start connection', affectsCompilation: false,
  apply(blueprint) {
    if (blueprint.looseConnections.has(loose.id)) throw new Error(`Loose connection ${loose.id} already exists`)
    if (loose.routeHandles.length === 0) throw new Error('A loose connection requires a free endpoint')
    if (isPortOccupied(blueprint, loose.origin.portId)) throw new Error('A port can carry only one route')
    const looseConnections = new Map(blueprint.looseConnections).set(loose.id, loose)
    return result(blueprint, this, withNormalizedUpdate(blueprint, { looseConnections }), changes(false))
  },
})
export const extendLooseConnection = (looseId: LooseConnectionId, handle: RouteHandle): EditCommand => ({
  label: 'Extend connection', affectsCompilation: false,
  apply(blueprint) {
    const loose = blueprint.looseConnections.get(looseId); if (loose === undefined) throw new Error(`Unknown loose connection ${looseId}`)
    return result(blueprint, this, { looseConnections: new Map(blueprint.looseConnections).set(looseId, { ...loose, routeHandles: [...loose.routeHandles, handle] }) }, changes(false))
  },
})
export const moveLooseHandle = (looseId: LooseConnectionId, handleId: RouteHandleId, position: GridPoint): EditCommand => ({
  label: 'Move route handle', affectsCompilation: false,
  apply(blueprint) {
    const loose = blueprint.looseConnections.get(looseId); if (loose === undefined) throw new Error(`Unknown loose connection ${looseId}`)
    const routeHandles = loose.routeHandles.map((handle) => handle.id === handleId ? { ...handle, position } : handle)
    return result(blueprint, this, { looseConnections: new Map(blueprint.looseConnections).set(looseId, { ...loose, routeHandles }) }, changes(false))
  },
})
export const removeLooseHandle = (looseId: LooseConnectionId, handleId: RouteHandleId): EditCommand => ({
  label: 'Remove route handle', affectsCompilation: false,
  apply(blueprint) {
    const loose = blueprint.looseConnections.get(looseId); if (loose === undefined) return { blueprint, changes: changes(false) }
    const routeHandles = loose.routeHandles.filter((handle) => handle.id !== handleId); const looseConnections = new Map(blueprint.looseConnections)
    if (routeHandles.length === 0) looseConnections.delete(looseId); else looseConnections.set(looseId, { ...loose, routeHandles })
    return result(blueprint, this, withNormalizedUpdate(blueprint, { looseConnections }), changes(false))
  },
})
export const removeLooseConnection = (looseId: LooseConnectionId): EditCommand => ({
  label: 'Remove incomplete connection', affectsCompilation: false,
  apply(blueprint) { const looseConnections = new Map(blueprint.looseConnections); if (!looseConnections.delete(looseId)) return { blueprint, changes: changes(false) }; return result(blueprint, this, withNormalizedUpdate(blueprint, { looseConnections }), changes(false)) },
})

const changeRouteHandles = (edgeId: EdgeId, label: string, transform: (handles: readonly RouteHandle[]) => readonly RouteHandle[]): EditCommand => ({
  label, affectsCompilation: true,
  apply(blueprint) { const edge = blueprint.edges.get(edgeId); if (edge === undefined) throw new Error(`Unknown edge ${edgeId}`); return result(blueprint, this, { edges: new Map(blueprint.edges).set(edge.id, { ...edge, routeHandles: transform(edge.routeHandles), bridges: [] }) }) },
})
export const moveRouteHandle = (edgeId: EdgeId, handleId: RouteHandleId, position: GridPoint): EditCommand => changeRouteHandles(edgeId, 'Move route handle', (handles) => handles.map((handle) => handle.id === handleId ? { ...handle, position } : handle))
export const insertRouteHandle = (edgeId: EdgeId, index: number, handle: RouteHandle): EditCommand => changeRouteHandles(edgeId, 'Add route handle', (handles) => [...handles.slice(0, index), handle, ...handles.slice(index)])
export const removeRouteHandle = (edgeId: EdgeId, handleId: RouteHandleId): EditCommand => changeRouteHandles(edgeId, 'Remove route handle', (handles) => handles.filter((handle) => handle.id !== handleId))

export const completeLooseConnection = (looseId: LooseConnectionId, targetNodeId: NodeId, targetPortId: PortId, edgeId: EdgeId): EditCommand => ({
  label: 'Complete connection', affectsCompilation: true,
  apply(blueprint) {
    const loose = blueprint.looseConnections.get(looseId); if (loose === undefined) throw new Error(`Unknown loose connection ${looseId}`)
    const originPort = findPort(blueprint, loose.origin.nodeId, loose.origin.portId); const targetPort = findPort(blueprint, targetNodeId, targetPortId)
    if (originPort === undefined || targetPort === undefined || originPort.direction === targetPort.direction) throw new Error('A connection must join an output to an input')
    if (isPortOccupied(blueprint, targetPortId, looseId)) throw new Error('A port can carry only one route')
    const forward = originPort.direction === 'output'; const source = forward ? loose.origin : { nodeId: targetNodeId, portId: targetPortId }; const target = forward ? { nodeId: targetNodeId, portId: targetPortId } : loose.origin
    const edge: BlueprintEdge = { id: edgeId, sourceNodeId: source.nodeId, sourcePortId: source.portId, targetNodeId: target.nodeId, targetPortId: target.portId, routeHandles: forward ? loose.routeHandles : [...loose.routeHandles].reverse(), bridges: [] }
    const looseConnections = new Map(blueprint.looseConnections); looseConnections.delete(looseId)
    const edges = new Map(blueprint.edges).set(edge.id, edge); const candidate = { ...blueprint, edges, looseConnections }; ensureCompatibleJunctions(candidate)
    const resource = routeResource(candidate, edge)
    return result(blueprint, this, withNormalizedUpdate(blueprint, { edges, looseConnections }), changes(true, resource === undefined ? [] : [resource]))
  },
})

export const addBridgeAt = (edgeId: EdgeId, position: GridPoint): EditCommand => ({
  label: 'Add bridge', affectsCompilation: true,
  apply(blueprint) {
    const edge = blueprint.edges.get(edgeId); if (edge === undefined) throw new Error(`Unknown edge ${edgeId}`)
    const cells = cellsOnRoute(edgeRoute(blueprint, edge).points); const index = cells.findIndex((cell) => samePoint(cell, position))
    if (index < 2 || index > cells.length - 3 || edge.bridges.some((bridge) => samePoint(bridge.position, position))) return { blueprint, changes: changes(false) }
    const bridge = { id: asId<RouteBridgeId>(`${edge.id}-bridge-${blueprint.revision + 1}`), position }
    return result(blueprint, this, { edges: new Map(blueprint.edges).set(edge.id, { ...edge, bridges: [...edge.bridges, bridge] }) })
  },
})

export const changeRecipe = (nodeId: NodeId, recipeId: RecipeId): EditCommand => ({ label: 'Change recipe', affectsCompilation: true, apply(blueprint) { const node = blueprint.nodes.get(nodeId); if (node?.kind !== 'machine') throw new Error('Only machines have recipes'); return result(blueprint, this, { nodes: new Map(blueprint.nodes).set(nodeId, { ...node, recipeId }) }) } })
export const addExternalPort = (port: ExternalPort): EditCommand => ({ label: 'Add external port', affectsCompilation: true, apply(blueprint) { return result(blueprint, this, { externalPorts: [...blueprint.externalPorts, port] }) } })
export const moveExternalPort = (portId: PortId, side: ExternalPort['side'], offset: number): EditCommand => ({ label: 'Move external port', affectsCompilation: true, apply(blueprint) { return result(blueprint, this, { externalPorts: blueprint.externalPorts.map((port) => port.portId === portId ? { ...port, side, offset } : port) }) } })
export const removeExternalPort = (portId: PortId): EditCommand => ({ label: 'Remove external port', affectsCompilation: true, apply(blueprint) { return result(blueprint, this, { externalPorts: blueprint.externalPorts.filter((port) => port.portId !== portId) }) } })
const sameSubFactoryInterface = (a: SubFactoryPort, b: SubFactoryPort): boolean => a.direction === b.direction && a.resourceId === b.resourceId

export const replaceSubFactoryVersion = (nodeId: NodeId, replacement: SubFactoryNode): EditCommand => ({
  label: `Change sub-factory to v${replacement.version}`, affectsCompilation: true,
  apply(blueprint) {
    const current = blueprint.nodes.get(nodeId)
    if (current?.kind !== 'sub-factory') throw new Error('Node is not a sub-factory')
    if (current.factoryId !== replacement.factoryId) throw new Error('A version change must keep the same factory identity')
    const unmatched = new Set(replacement.ports.map((port) => port.id)); const mapping = new Map<PortId, SubFactoryPort>()
    for (const oldPort of current.ports) {
      const exact = replacement.ports.find((port) => unmatched.has(port.id) && port.contractPortId === oldPort.contractPortId && sameSubFactoryInterface(oldPort, port))
      if (exact !== undefined) { mapping.set(oldPort.id, exact); unmatched.delete(exact.id) }
    }
    for (const oldPort of current.ports.filter((port) => !mapping.has(port.id))) {
      const candidates = replacement.ports.filter((port) => unmatched.has(port.id) && sameSubFactoryInterface(oldPort, port))
      if (candidates.length === 1) { mapping.set(oldPort.id, candidates[0]!); unmatched.delete(candidates[0]!.id) }
    }
    const ports = replacement.ports.map((port) => {
      const old = [...mapping].find(([, target]) => target.id === port.id)?.[0]
      return old === undefined ? port : { ...port, id: old }
    })
    const replacementByGeneratedId = new Map(replacement.ports.map((port, index) => [port.id, ports[index]!]))
    const edges = new Map(blueprint.edges); const looseConnections = new Map(blueprint.looseConnections)
    for (const edge of blueprint.edges.values()) {
      const touchesSource = edge.sourceNodeId === nodeId; const touchesTarget = edge.targetNodeId === nodeId
      if (!touchesSource && !touchesTarget) continue
      const oldPortId = touchesSource ? edge.sourcePortId : edge.targetPortId
      const generated = mapping.get(oldPortId)
      if (generated !== undefined) {
        const mapped = replacementByGeneratedId.get(generated.id)!
        edges.set(edge.id, touchesSource ? { ...edge, sourcePortId: mapped.id } : { ...edge, targetPortId: mapped.id })
        continue
      }
      const free = absolutePortPosition(blueprint, { nodeId, portId: oldPortId }) ?? current.position
      const origin = touchesSource ? { nodeId: edge.targetNodeId, portId: edge.targetPortId } : { nodeId: edge.sourceNodeId, portId: edge.sourcePortId }
      const handles = touchesSource ? [...edge.routeHandles].reverse() : [...edge.routeHandles]
      const looseId = asId<LooseConnectionId>(`${edge.id}:version-loose`)
      looseConnections.set(looseId, { id: looseId, origin, routeHandles: [...handles, { id: asId<RouteHandleId>(`${edge.id}:version-free`), position: free }] })
      edges.delete(edge.id)
    }
    const node = { ...replacement, id: current.id, position: current.position, ports }
    return result(blueprint, this, { nodes: new Map(blueprint.nodes).set(nodeId, node), edges, looseConnections }, changes(true, [], [replacement.contractId]))
  },
})

/** Legacy helper retained for callers that only replace an immutable hash. */
export const replaceSubFactoryContract = (nodeId: NodeId, contractId: SubFactoryNode['contractId']): EditCommand => ({ label: 'Update sub-factory', affectsCompilation: true, apply(blueprint) { const node = blueprint.nodes.get(nodeId); if (node?.kind !== 'sub-factory') throw new Error('Node is not a sub-factory'); return result(blueprint, this, { nodes: new Map(blueprint.nodes).set(nodeId, { ...node, contractId }) }, changes(true, [], [contractId])) } })
export const transaction = (label: string, commands: readonly EditCommand[]): EditCommand => ({
  label, affectsCompilation: commands.some((command) => command.affectsCompilation),
  apply(blueprint) {
    let current = blueprint; const resources = new Set<string>(); const children = new Set<string>(); let structural = false
    for (const command of commands) { const applied = command.apply(current); current = applied.blueprint; applied.changes.resources.forEach((value) => resources.add(value)); applied.changes.childContracts.forEach((value) => children.add(value)); structural ||= applied.changes.structureChanged }
    return { blueprint: current, changes: { resources, childContracts: children, structureChanged: structural } }
  },
})
export const duplicateNodes = (blueprint: FactoryBlueprint, ids: readonly NodeId[], idFactory: IdFactory): EditCommand => {
  const selected = ids.map((id) => blueprint.nodes.get(id)).filter((node): node is BlueprintNode => node !== undefined)
  const copies = selected.map((node) => ({ ...node, id: idFactory.next('NodeId'), position: { x: node.position.x + 2, y: node.position.y + 2 }, ports: node.ports.map((port) => ({ ...port, id: idFactory.next('PortId') })) })) as BlueprintNode[]
  return transaction('Duplicate nodes', copies.map(addNode))
}
