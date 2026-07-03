import { describe, expect, it } from 'vitest'
import { asId, gridPoint } from '../domain'
import type { EdgeId, FactoryId, LooseConnectionId, NodeId, PortId, ResourceId, RouteHandleId } from '../domain'
import { createBoundaryNode, createDemoBlueprint } from '../ui/demo-blueprint'
import type { BlueprintEdge, FactoryBlueprint } from './blueprint'
import { createBlueprint, effectivePortResource, isPortOccupied, routeResource } from './blueprint'
import { canonicalBlueprint, deserializeBlueprint } from './canonicalize'
import { addLooseConnection, addNode, connectPorts, createJunctionNode, disconnectEdge, removeLooseConnection } from './commands'

const apply = (blueprint: FactoryBlueprint, command: ReturnType<typeof addNode>): FactoryBlueprint => command.apply(blueprint).blueprint
const edge = (id: string, sourceNodeId: NodeId, sourcePortId: PortId, targetNodeId: NodeId, targetPortId: PortId): BlueprintEdge => ({ id: asId<EdgeId>(id), sourceNodeId, sourcePortId, targetNodeId, targetPortId, routeHandles: [], bridges: [] })
const freePort = (blueprint: FactoryBlueprint, nodeId: NodeId, direction: 'input' | 'output') => blueprint.nodes.get(nodeId)!.ports.find((port) => port.direction === direction && !isPortOccupied(blueprint, port.id))!

describe('route schema V4', () => {
  it('round-trips deterministically and rejects old schemas', () => {
    const blueprint = createDemoBlueprint(); const serialized = canonicalBlueprint(blueprint)
    expect(JSON.parse(serialized).schemaVersion).toBe(4)
    expect(canonicalBlueprint(deserializeBlueprint(JSON.parse(serialized)))).toBe(serialized)
    expect(() => deserializeBlueprint({ schemaVersion: 3 })).toThrow(/expected V4/)
  })

  it('lets Any junction chains inherit and release one shared resource', () => {
    const a = createJunctionNode(asId<NodeId>('junction-a'), gridPoint(10, 1)); const b = createJunctionNode(asId<NodeId>('junction-b'), gridPoint(20, 1))
    const iron = createBoundaryNode(asId<NodeId>('iron-source'), asId<PortId>('iron-output'), 'external-input', asId<ResourceId>('ironOre'), 0, 1)
    const copper = createBoundaryNode(asId<NodeId>('copper-source'), asId<PortId>('copper-output'), 'external-input', asId<ResourceId>('copperOre'), 0, 8)
    let blueprint = createBlueprint(asId<FactoryId>('factory-junctions'))
    for (const node of [a, b, iron, copper]) blueprint = apply(blueprint, addNode(node))
    const anyEdge = edge('edge-any', a.id, freePort(blueprint, a.id, 'output').id, b.id, freePort(blueprint, b.id, 'input').id)
    blueprint = connectPorts(anyEdge).apply(blueprint).blueprint; expect(routeResource(blueprint, anyEdge)).toBeUndefined()
    const typedEdge = edge('edge-typed', iron.id, iron.ports[0]!.id, a.id, freePort(blueprint, a.id, 'input').id)
    blueprint = connectPorts(typedEdge).apply(blueprint).blueprint
    expect(effectivePortResource(blueprint, b.id, freePort(blueprint, b.id, 'output').id)).toBe(asId<ResourceId>('ironOre'))
    const incompatible = edge('edge-copper', copper.id, copper.ports[0]!.id, b.id, freePort(blueprint, b.id, 'input').id)
    expect(() => connectPorts(incompatible).apply(blueprint)).toThrow(/same resource/)
    blueprint = disconnectEdge(typedEdge.id).apply(blueprint).blueprint
    expect(effectivePortResource(blueprint, a.id, freePort(blueprint, a.id, 'input').id)).toBeUndefined()
  })

  it('keeps one free junction connector per side up to three and counts loose routes as occupied', () => {
    const junction = createJunctionNode(asId<NodeId>('junction-dynamic'), gridPoint(5, 5)); let blueprint = apply(createBlueprint(asId<FactoryId>('factory-dynamic')), addNode(junction))
    const looseIds: LooseConnectionId[] = []
    for (let index = 1; index <= 3; index += 1) {
      const port = freePort(blueprint, junction.id, 'output'); const id = asId<LooseConnectionId>(`loose-${index}`); looseIds.push(id)
      blueprint = addLooseConnection({ id, origin: { nodeId: junction.id, portId: port.id }, routeHandles: [{ id: asId<RouteHandleId>(`handle-${index}`), position: gridPoint(10, index) }] }).apply(blueprint).blueprint
    }
    const outputs = blueprint.nodes.get(junction.id)!.ports.filter((port) => port.direction === 'output')
    expect(outputs).toHaveLength(3); expect(outputs.every((port) => isPortOccupied(blueprint, port.id))).toBe(true)
    const occupied = outputs[0]!
    expect(() => addLooseConnection({ id: asId<LooseConnectionId>('loose-extra'), origin: { nodeId: junction.id, portId: occupied.id }, routeHandles: [{ id: asId<RouteHandleId>('handle-extra'), position: gridPoint(12, 1) }] }).apply(blueprint)).toThrow(/only one route/)
    blueprint = removeLooseConnection(looseIds[0]!).apply(blueprint).blueprint
    expect(blueprint.nodes.get(junction.id)!.ports.filter((port) => port.direction === 'output' && !isPortOccupied(blueprint, port.id))).toHaveLength(1)
  })
})
