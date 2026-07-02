import { describe, expect, it } from 'vitest'
import { asId, createIdFactory, gridPoint, parseRate } from '../domain'
import type { NodeId, PortId, ResourceId } from '../domain'
import { createDemoBlueprint } from '../ui/demo-blueprint'
import type { BlueprintNode } from './blueprint'
import { effectivePortResource } from './blueprint'
import { canonicalBlueprint, deserializeBlueprint } from './canonicalize'
import { connectPorts, duplicateNodes, moveNode, removeNode } from './commands'
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
    expect(restoredJunction?.ports.every((port) => port.resourceId === undefined)).toBe(true)
    expect(restored.nodes.get(asId<NodeId>('node-furnace'))?.ports.every((port) => port.resourceId !== undefined)).toBe(true)
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
})
