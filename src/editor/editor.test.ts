import { describe, expect, it } from 'vitest'
import { asId, createIdFactory, gridPoint, parseRate } from '../domain'
import type { EdgeId, LooseConnectionId, NetId, NodeId, PortId, ResourceId, RouteConnectorId, TrackId } from '../domain'
import { createDemoBlueprint } from '../ui/demo-blueprint'
import type { BlueprintNode } from './blueprint'
import { blueprintTracks, effectivePortResource } from './blueprint'
import { canonicalBlueprint, canonicalCompilationInput, deserializeBlueprint } from './canonicalize'
import { addLooseConnection, changeConnectionGeometry, completeLooseConnection, connectPorts, disconnectEdge, duplicateNodes, extendLooseConnection, moveNode, removeNode } from './commands'
import { BlueprintHistory } from './history'

describe('blueprint commands', () => {
  it('undo restores the exact canonical blueprint', () => {
    const initial = createDemoBlueprint(); const history = new BlueprintHistory(initial)
    history.execute(moveNode(asId<NodeId>('node-furnace'), gridPoint(20, 20))); history.undo()
    expect(canonicalBlueprint(history.current)).toBe(canonicalBlueprint(initial))
  })
  it('removing a node removes attached edges atomically', () => {
    const applied = removeNode(asId<NodeId>('node-furnace')).apply(createDemoBlueprint()).blueprint
    expect(applied.nodes.size).toBe(2); expect(applied.edges.size).toBe(0)
  })
  it('duplicates with new stable IDs', () => {
    const initial = createDemoBlueprint(); const applied = duplicateNodes(initial, [asId<NodeId>('node-furnace')], createIdFactory()).apply(initial).blueprint
    expect(applied.nodes.size).toBe(4); expect(initial.nodes.size).toBe(3)
  })
  it('rejects incompatible resource ports', () => {
    const blueprint = createDemoBlueprint(); const template = blueprint.edges.values().next().value!
    expect(() => connectPorts({ ...template, id: asId('edge-invalid'), resourceId: asId('copperOre') }).apply(blueprint)).toThrow('same resource')
  })
  it('round-trips an untyped junction without weakening typed ports', () => {
    const blueprint = createDemoBlueprint()
    const junction: BlueprintNode = {
      id: asId<NodeId>('node-junction'), kind: 'junction', name: 'Junction', position: gridPoint(4, 4), footprint: { x: 0, y: 0, width: 2, height: 2 },
      ports: [
        { id: asId<PortId>('port-junction-in'), direction: 'input', capacity: parseRate('12'), anchor: gridPoint(0, 1), maxConnections: 4 },
        { id: asId<PortId>('port-junction-out'), direction: 'output', capacity: parseRate('12'), anchor: gridPoint(2, 1), maxConnections: 4 },
      ],
    }
    const restored = deserializeBlueprint(JSON.parse(canonicalBlueprint({ ...blueprint, nodes: new Map(blueprint.nodes).set(junction.id, junction) })))
    const restoredJunction = restored.nodes.get(junction.id)
    expect(restoredJunction?.kind).toBe('junction')
    expect(restoredJunction?.footprint.width).toBe(3)
    expect(restoredJunction?.ports.find((port) => port.direction === 'output')?.anchor.x).toBe(3)
    expect(restoredJunction?.ports.every((port) => port.resourceId === undefined)).toBe(true)
    expect(restored.nodes.get(asId<NodeId>('node-furnace'))?.ports.every((port) => port.resourceId !== undefined)).toBe(true)
  })
  it('expands a saved compact intake and keeps its output on the new edge', () => {
    const blueprint = createDemoBlueprint(); const intake = blueprint.nodes.get(asId<NodeId>('node-iron-input'))!
    const compact = { ...intake, footprint: { ...intake.footprint, width: 2 }, ports: intake.ports.map((port) => ({ ...port, anchor: gridPoint(2, port.anchor.y) })) } as BlueprintNode
    const restored = deserializeBlueprint(JSON.parse(canonicalBlueprint({ ...blueprint, nodes: new Map(blueprint.nodes).set(compact.id, compact) })))
    const expanded = restored.nodes.get(compact.id)
    expect(expanded?.footprint.width).toBe(4)
    expect(expanded?.ports[0]?.anchor.x).toBe(4)
  })
  it('infers the resource across both ports of a connected junction', () => {
    const blueprint = createDemoBlueprint()
    const source = blueprint.nodes.get(asId<NodeId>('node-iron-input'))!
    const junction: BlueprintNode = {
      id: asId<NodeId>('node-junction'), kind: 'junction', name: 'Junction', position: gridPoint(4, 4), footprint: { x: 0, y: 0, width: 2, height: 2 },
      ports: [
        { id: asId<PortId>('port-junction-in'), direction: 'input', capacity: parseRate('12'), anchor: gridPoint(0, 1), maxConnections: 4 },
        { id: asId<PortId>('port-junction-out'), direction: 'output', capacity: parseRate('12'), anchor: gridPoint(2, 1), maxConnections: 4 },
      ],
    }
    const edge = { ...blueprint.edges.get(asId('edge-ore'))!, targetNodeId: junction.id, targetPortId: junction.ports[0]!.id }
    const connected = { ...blueprint, nodes: new Map(blueprint.nodes).set(junction.id, junction), edges: new Map([[edge.id, edge]]) }
    expect(source.kind).toBe('external-input')
    expect(effectivePortResource(connected, junction.id, junction.ports[1]!.id)).toBe(asId<ResourceId>('ironOre'))
  })
  it('edits one route without deleting a shared trunk owner', () => {
    const blueprint = deserializeBlueprint(JSON.parse(canonicalBlueprint(createDemoBlueprint())))
    const oreNet = blueprint.nets!.get(asId<NetId>('net-ore'))!; const secondNet = { ...oreNet, id: asId<NetId>('net-ore-second') }
    const oreTrack = blueprint.tracks!.get(asId<TrackId>('track-ore'))!
    const shared = { ...blueprint, nets: new Map(blueprint.nets).set(secondNet.id, secondNet), tracks: new Map(blueprint.tracks).set(oreTrack.id, { ...oreTrack, netIds: [oreNet.id, secondNet.id] }) }
    const edited = changeConnectionGeometry(asId('edge-ore'), [gridPoint(2, 5), gridPoint(3, 5), gridPoint(3, 4), gridPoint(7, 4)]).apply(shared).blueprint
    expect([...blueprintTracks(edited).values()].some((track) => track.netIds.includes(secondNet.id))).toBe(true)
    expect([...blueprintTracks(edited).values()].some((track) => track.netIds.includes(oreNet.id))).toBe(true)
  })
  it('persists incomplete connections without changing compilation input', () => {
    const initial = createDemoBlueprint(); const source = initial.nodes.get(asId('node-iron-input'))!; const port = source.ports[0]!
    const loose = { id: asId<LooseConnectionId>('loose-test'), origin: { nodeId: source.id, portId: port.id }, resourceId: asId<ResourceId>('ironOre'), capacity: port.capacity, routeConnectors: [{ id: asId<RouteConnectorId>('connector-a'), position: gridPoint(4, 7) }] }
    const started = addLooseConnection(loose).apply(initial).blueprint
    const extended = extendLooseConnection(loose.id, { id: asId<RouteConnectorId>('connector-b'), position: gridPoint(6, 8) }).apply(started).blueprint
    expect(extended.revision).toBe(initial.revision)
    expect(canonicalCompilationInput(extended)).toBe(canonicalCompilationInput(initial))
    const serialized = JSON.parse(canonicalBlueprint(extended)); expect(serialized.schemaVersion).toBe(3)
    expect(deserializeBlueprint(serialized).looseConnections?.get(loose.id)?.routeConnectors).toHaveLength(2)
  })
  it('normalizes a route started from an input when it is completed', () => {
    const initial = disconnectEdge(asId('edge-ore')).apply(createDemoBlueprint()).blueprint
    const furnace = initial.nodes.get(asId('node-furnace'))!; const input = furnace.ports[0]!; const intake = initial.nodes.get(asId('node-iron-input'))!; const output = intake.ports[0]!
    const loose = { id: asId<LooseConnectionId>('loose-reverse'), origin: { nodeId: furnace.id, portId: input.id }, resourceId: asId<ResourceId>('ironOre'), capacity: input.capacity, routeConnectors: [{ id: asId<RouteConnectorId>('connector-near-input'), position: gridPoint(6, 4) }, { id: asId<RouteConnectorId>('connector-near-output'), position: gridPoint(4, 5) }] }
    const started = addLooseConnection(loose).apply(initial).blueprint
    const completed = completeLooseConnection(loose.id, intake.id, output.id, asId<EdgeId>('edge-reversed')).apply(started).blueprint
    const edge = completed.edges.get(asId<EdgeId>('edge-reversed'))!
    expect(edge.sourceNodeId).toBe(intake.id); expect(edge.targetNodeId).toBe(furnace.id)
    expect(edge.routeConnectors?.map((connector) => connector.id)).toEqual([asId<RouteConnectorId>('connector-near-output'), asId<RouteConnectorId>('connector-near-input')])
    expect(completed.looseConnections?.has(loose.id)).toBe(false)
  })
})
