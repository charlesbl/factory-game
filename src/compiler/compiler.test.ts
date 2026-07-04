import { describe, expect, it } from 'vitest'
import { asId, gridPoint } from '../domain'
import type { EdgeId, FactoryId, NodeId, PortId, ResourceId } from '../domain'
import type { BlueprintEdge, FactoryBlueprint } from '../editor'
import { addNode, connectPorts, createBlueprint, createJunctionNode, isPortOccupied, routeCapacity, type EditCommand } from '../editor'
import { createBoundaryNode, createDemoBlueprint, createMachineNode } from '../ui/demo-blueprint'
import { compileBlueprint, isContract } from './compile'

const apply = (blueprint: FactoryBlueprint, command: EditCommand): FactoryBlueprint => command.apply(blueprint).blueprint
const freePort = (blueprint: FactoryBlueprint, nodeId: NodeId, direction: 'input' | 'output') => blueprint.nodes.get(nodeId)!.ports.find((port) => port.direction === direction && !isPortOccupied(blueprint, port.id))!
const route = (id: string, sourceNodeId: NodeId, sourcePortId: PortId, targetNodeId: NodeId, targetPortId: PortId): BlueprintEdge => ({ id: asId<EdgeId>(id), sourceNodeId, sourcePortId, targetNodeId, targetPortId, routeHandles: [], bridges: [] })
const addAll = (nodes: readonly ReturnType<typeof createBoundaryNode>[]): FactoryBlueprint => {
  let blueprint = createBlueprint(asId<FactoryId>('factory-flow')); for (const node of nodes) blueprint = apply(blueprint, addNode(node)); return blueprint
}

describe('exact point-to-point flow compiler', () => {
  it('compiles the starter factory using connector-derived capacities', () => {
    const blueprint = createDemoBlueprint(); const ore = blueprint.edges.get(asId<EdgeId>('edge-ore'))!; const compiled = compileBlueprint(blueprint)
    expect(isContract(compiled)).toBe(true)
    if (!isContract(compiled)) return
    expect(routeCapacity(blueprint, ore)).toBe(4_000_000n)
    expect(compiled.inputRates.get(asId<ResourceId>('ironOre'))).toBe(2_000_000n)
    expect(compiled.outputRates.get(asId<ResourceId>('ironIngot'))).toBe(1_000_000n)
    expect(compiled.inputPorts[0]?.rate).toBe(2_000_000n)
    expect(compiled.outputPorts[0]?.rate).toBe(1_000_000n)
  })

  it('splits through independent junction connectors without a global junction cap', () => {
    const source = createBoundaryNode(asId<NodeId>('source'), asId<PortId>('source-out'), 'external-input', asId<ResourceId>('ironOre'), 0, 5, '12')
    const junction = createJunctionNode(asId<NodeId>('split'), gridPoint(8, 4)); const furnaceA = createMachineNode(asId<NodeId>('furnace-a'), asId('ironIngot'), 18, 0); const furnaceB = createMachineNode(asId<NodeId>('furnace-b'), asId('ironIngot'), 18, 9)
    const outputA = createBoundaryNode(asId<NodeId>('output-a'), asId<PortId>('output-a-in'), 'external-output', asId<ResourceId>('ironIngot'), 30, 1, '4'); const outputB = createBoundaryNode(asId<NodeId>('output-b'), asId<PortId>('output-b-in'), 'external-output', asId<ResourceId>('ironIngot'), 30, 10, '4')
    let blueprint = addAll([source, junction, furnaceA, furnaceB, outputA, outputB])
    const routes = [
      route('source-split', source.id, source.ports[0]!.id, junction.id, freePort(blueprint, junction.id, 'input').id),
    ]
    blueprint = apply(blueprint, connectPorts(routes[0]!))
    for (const [index, furnace] of [furnaceA, furnaceB].entries()) { const next = route(`split-${index}`, junction.id, freePort(blueprint, junction.id, 'output').id, furnace.id, furnace.ports[0]!.id); routes.push(next); blueprint = apply(blueprint, connectPorts(next)) }
    blueprint = apply(blueprint, connectPorts(route('furnace-a-output', furnaceA.id, furnaceA.ports[1]!.id, outputA.id, outputA.ports[0]!.id)))
    blueprint = apply(blueprint, connectPorts(route('furnace-b-output', furnaceB.id, furnaceB.ports[1]!.id, outputB.id, outputB.ports[0]!.id)))
    const compiled = compileBlueprint(blueprint); expect(isContract(compiled)).toBe(true)
    if (isContract(compiled)) { expect(compiled.edgeFlows.get(asId<EdgeId>('split-0'))).toBe(2_000_000n); expect(compiled.edgeFlows.get(asId<EdgeId>('split-1'))).toBe(2_000_000n) }
  })

  it('merges several connectors and conserves only downstream demand', () => {
    const sourceA = createBoundaryNode(asId<NodeId>('source-a'), asId<PortId>('source-a-out'), 'external-input', asId<ResourceId>('ironOre'), 0, 1)
    const sourceB = createBoundaryNode(asId<NodeId>('source-b'), asId<PortId>('source-b-out'), 'external-input', asId<ResourceId>('ironOre'), 0, 9)
    const junction = createJunctionNode(asId<NodeId>('merge'), gridPoint(10, 4)); const furnace = createMachineNode(asId<NodeId>('furnace'), asId('ironIngot'), 20, 4); const output = createBoundaryNode(asId<NodeId>('output'), asId<PortId>('output-in'), 'external-output', asId<ResourceId>('ironIngot'), 30, 5, '4')
    let blueprint = addAll([sourceA, sourceB, junction, furnace, output])
    blueprint = apply(blueprint, connectPorts(route('merge-a', sourceA.id, sourceA.ports[0]!.id, junction.id, freePort(blueprint, junction.id, 'input').id)))
    blueprint = apply(blueprint, connectPorts(route('merge-b', sourceB.id, sourceB.ports[0]!.id, junction.id, freePort(blueprint, junction.id, 'input').id)))
    blueprint = apply(blueprint, connectPorts(route('merge-out', junction.id, freePort(blueprint, junction.id, 'output').id, furnace.id, furnace.ports[0]!.id)))
    blueprint = apply(blueprint, connectPorts(route('product', furnace.id, furnace.ports[1]!.id, output.id, output.ports[0]!.id)))
    const compiled = compileBlueprint(blueprint); expect(isContract(compiled)).toBe(true)
    if (isContract(compiled)) expect((compiled.edgeFlows.get(asId<EdgeId>('merge-a')) ?? 0n) + (compiled.edgeFlows.get(asId<EdgeId>('merge-b')) ?? 0n)).toBe(2_000_000n)
  })

  it('blocks a completed Any-to-Any route until its component is typed', () => {
    const a = createJunctionNode(asId<NodeId>('any-a'), gridPoint(0, 0)); const b = createJunctionNode(asId<NodeId>('any-b'), gridPoint(10, 0)); let blueprint = addAll([a, b])
    blueprint = apply(blueprint, connectPorts(route('any-route', a.id, freePort(blueprint, a.id, 'output').id, b.id, freePort(blueprint, b.id, 'input').id)))
    expect(compileBlueprint(blueprint)).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'UNTYPED_ROUTE' })]))
  })
})
