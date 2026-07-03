import { describe, expect, it } from 'vitest'
import { asId, gridPoint, parseRate } from '../domain'
import type { EdgeId, NodeId, PortId, ResourceId } from '../domain'
import { createBoundaryNode, createDemoBlueprint, createMachineNode } from '../ui/demo-blueprint'
import type { BlueprintNode, FactoryBlueprint } from '../editor'
import { legacyNetForEdge, legacyTrackForEdge } from '../editor'
import { compileBlueprint, isContract } from './compile'
import { topologicalSort } from './topological-sort'

const withJunctionOnOreLine = (outputCapacity = '6'): FactoryBlueprint => {
  const blueprint = createDemoBlueprint()
  const intake = blueprint.nodes.get(asId<NodeId>('node-iron-input'))!
  const oreEdge = blueprint.edges.get(asId<EdgeId>('edge-ore'))!
  const junction: BlueprintNode = {
    id: asId<NodeId>('node-junction'), kind: 'junction', name: 'Junction', position: gridPoint(4, 4), footprint: { x: 0, y: 0, width: 2, height: 2 },
    ports: [
      { id: asId<PortId>('port-junction-in'), direction: 'input', capacity: parseRate('12'), anchor: gridPoint(0, 1), maxConnections: 4 },
      { id: asId<PortId>('port-junction-out'), direction: 'output', capacity: parseRate('12'), anchor: gridPoint(2, 1), maxConnections: 4 },
    ],
  }
  const intoJunction = { ...oreEdge, targetNodeId: junction.id, targetPortId: junction.ports[0]!.id, points: [gridPoint(2, 5), gridPoint(4, 5)] }
  const outOfJunction = { ...oreEdge, id: asId<EdgeId>('edge-junction-ore'), sourceNodeId: junction.id, sourcePortId: junction.ports[1]!.id, capacity: parseRate(outputCapacity), points: [gridPoint(6, 5), gridPoint(7, 5)] }
  const edges = new Map(blueprint.edges); edges.set(intoJunction.id, intoJunction); edges.set(outOfJunction.id, outOfJunction)
  return { ...blueprint, nodes: new Map(blueprint.nodes).set(intake.id, { ...intake, position: gridPoint(-2, 4) }).set(junction.id, junction), edges }
}

const withThreeFurnaces = (): FactoryBlueprint => {
  const blueprint = createDemoBlueprint()
  const furnace = blueprint.nodes.get(asId<NodeId>('node-furnace'))!
  const intake = blueprint.nodes.get(asId<NodeId>('node-iron-input'))!
  const dispatch = blueprint.nodes.get(asId<NodeId>('node-iron-output'))!
  if (furnace.kind !== 'machine') throw new Error('Fixture furnace must be a machine')
  const cloneFurnace = (suffix: string, y: number): BlueprintNode => ({
    ...furnace,
    id: asId<NodeId>(`node-furnace-${suffix}`),
    position: gridPoint(7, y),
    ports: furnace.ports.map((port, index) => ({ ...port, id: asId<PortId>(`port-furnace-${suffix}-${index}`) })),
  })
  const second = cloneFurnace('2', 8)
  const third = cloneFurnace('3', 13)
  const junction: BlueprintNode = {
    id: asId<NodeId>('node-junction'), kind: 'junction', name: 'Junction', position: gridPoint(14, 8), footprint: { x: 0, y: 0, width: 2, height: 2 },
    ports: [
      { id: asId<PortId>('port-junction-in'), direction: 'input', capacity: parseRate('12'), anchor: gridPoint(0, 1), maxConnections: 4 },
      { id: asId<PortId>('port-junction-out'), direction: 'output', capacity: parseRate('12'), anchor: gridPoint(2, 1), maxConnections: 4 },
    ],
  }
  const ore = blueprint.edges.get(asId<EdgeId>('edge-ore'))!
  const ingot = blueprint.edges.get(asId<EdgeId>('edge-ingot'))!
  const connectOre = (target: BlueprintNode, suffix: string) => ({ ...ore, id: asId<EdgeId>(`edge-ore-${suffix}`), targetNodeId: target.id, targetPortId: target.ports[0]!.id, points: [intake.position, target.position] })
  const connectIngot = (source: BlueprintNode, suffix: string) => ({ ...ingot, id: asId<EdgeId>(`edge-ingot-${suffix}`), sourceNodeId: source.id, sourcePortId: source.ports[1]!.id, targetNodeId: junction.id, targetPortId: junction.ports[0]!.id, points: [source.position, junction.position] })
  const junctionDispatch = { ...ingot, id: asId<EdgeId>('edge-junction-dispatch'), sourceNodeId: junction.id, sourcePortId: junction.ports[1]!.id, targetNodeId: dispatch.id, targetPortId: dispatch.ports[0]!.id, capacity: parseRate('4'), points: [junction.position, dispatch.position] }
  const nodes = new Map(blueprint.nodes).set(second.id, second).set(third.id, third).set(junction.id, junction)
  const edges = new Map<EdgeId, typeof ingot>([
    [ore.id, ore],
    [asId<EdgeId>('edge-ingot-1'), connectIngot(furnace, '1')],
    [asId<EdgeId>('edge-ore-2'), connectOre(second, '2')],
    [asId<EdgeId>('edge-ingot-2'), connectIngot(second, '2')],
    [asId<EdgeId>('edge-ore-3'), connectOre(third, '3')],
    [asId<EdgeId>('edge-ingot-3'), connectIngot(third, '3')],
    [junctionDispatch.id, junctionDispatch],
  ])
  return { ...blueprint, nodes, edges }
}

const withTwoFurnacesOnSharedOreTrunk = (): FactoryBlueprint => {
  const blueprint = createDemoBlueprint()
  const intake = blueprint.nodes.get(asId<NodeId>('node-iron-input'))!
  const first = createMachineNode(asId<NodeId>('node-furnace'), asId('ironIngot'), 7, 1)
  const second = createMachineNode(asId<NodeId>('node-furnace-2'), asId('ironIngot'), 7, 7)
  const firstDispatch = createBoundaryNode(asId<NodeId>('node-iron-output'), asId<PortId>('port-ingot-target'), 'external-output', asId<ResourceId>('ironIngot'), 16, 1, '4')
  const secondDispatch = createBoundaryNode(asId<NodeId>('node-iron-output-2'), asId<PortId>('port-ingot-target-2'), 'external-output', asId<ResourceId>('ironIngot'), 16, 7, '4')
  const edge = (id: string, source: BlueprintNode, sourcePort: number, target: BlueprintNode, targetPort: number, points: readonly ReturnType<typeof gridPoint>[]) => ({
    id: asId<EdgeId>(id), sourceNodeId: source.id, sourcePortId: source.ports[sourcePort]!.id, targetNodeId: target.id, targetPortId: target.ports[targetPort]!.id,
    resourceId: source.ports[sourcePort]!.resourceId!, capacity: source.ports[sourcePort]!.capacity < target.ports[targetPort]!.capacity ? source.ports[sourcePort]!.capacity : target.ports[targetPort]!.capacity, points,
  })
  const edges = [
    edge('edge-ore-1', intake, 0, first, 0, [gridPoint(4, 5), gridPoint(5, 5), gridPoint(5, 2), gridPoint(7, 2)]),
    edge('edge-ore-2', intake, 0, second, 0, [gridPoint(4, 5), gridPoint(5, 5), gridPoint(5, 8), gridPoint(7, 8)]),
    edge('edge-ingot-1', first, 1, firstDispatch, 0, [gridPoint(11, 2), gridPoint(16, 2)]),
    edge('edge-ingot-2', second, 1, secondDispatch, 0, [gridPoint(11, 8), gridPoint(16, 8)]),
  ]
  return {
    ...blueprint,
    nodes: new Map([intake, first, second, firstDispatch, secondDispatch].map((node) => [node.id, node])),
    edges: new Map(edges.map((item) => [item.id, item])),
    nets: new Map(edges.map((item) => { const net = legacyNetForEdge(item); return [net.id, net] })),
    tracks: new Map(edges.map((item) => { const track = legacyTrackForEdge(item); return [track.id, track] })),
    transitions: new Map(),
    externalPorts: [],
  }
}

describe('deterministic compilation', () => {
  it('compiles a coupled line with exact conserved rates', () => {
    const compiled = compileBlueprint(createDemoBlueprint()); expect(isContract(compiled)).toBe(true)
    if (!isContract(compiled)) return
    expect(compiled.inputRates.get(asId<ResourceId>('ironOre'))).toBe(parseRate('2'))
    expect(compiled.outputRates.get(asId<ResourceId>('ironIngot'))).toBe(parseRate('1'))
    expect(compiled.inputPorts).toContainEqual(expect.objectContaining({ resourceId: asId<ResourceId>('ironOre'), capacity: parseRate('6') }))
    expect(compiled.outputPorts).toContainEqual(expect.objectContaining({ resourceId: asId<ResourceId>('ironIngot'), capacity: parseRate('4') }))
    expect(compiled.machineActivity.get(asId<NodeId>('node-furnace'))).toBe(1_000_000n)
  })
  it('is unchanged when map insertion order changes', () => {
    const first = createDemoBlueprint(); const second = { ...first, nodes: new Map([...first.nodes].reverse()), edges: new Map([...first.edges].reverse()) }
    const a = compileBlueprint(first); const b = compileBlueprint(second)
    expect(isContract(a) && isContract(b) && [...a.edgeFlows]).toEqual(isContract(b) ? [...b.edgeFlows] : [])
  })
  it('detects a cycle', () => {
    const blueprint = createDemoBlueprint(); const edge = blueprint.edges.get(asId('edge-ore'))!
    const cyclic = { ...blueprint, edges: new Map(blueprint.edges).set(asId('edge-back'), { ...edge, id: asId('edge-back'), sourceNodeId: edge.targetNodeId, targetNodeId: edge.sourceNodeId }) }
    expect(topologicalSort(cyclic).cyclic.length).toBeGreaterThan(0)
  })
  it('infers a junction resource and conserves its flow', () => {
    const compiled = compileBlueprint(withJunctionOnOreLine())
    expect(isContract(compiled)).toBe(true)
    if (!isContract(compiled)) return
    expect(compiled.inputRates.get(asId<ResourceId>('ironOre'))).toBe(parseRate('2'))
    expect(compiled.outputRates.get(asId<ResourceId>('ironIngot'))).toBe(parseRate('1'))
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false)
  })
  it('rejects a junction without an output', () => {
    const blueprint = withJunctionOnOreLine()
    const edges = new Map(blueprint.edges); edges.delete(asId<EdgeId>('edge-junction-ore'))
    const compiled = compileBlueprint({ ...blueprint, edges })
    expect(isContract(compiled)).toBe(false)
    if (isContract(compiled)) return
    expect(compiled).toContainEqual(expect.objectContaining({ code: 'UNROUTED_OUTPUT', entity: { nodeId: asId<NodeId>('node-junction') } }))
  })
  it('rejects a junction that mixes resources', () => {
    const blueprint = withJunctionOnOreLine()
    const edge = blueprint.edges.get(asId<EdgeId>('edge-junction-ore'))!
    const edges = new Map(blueprint.edges).set(edge.id, { ...edge, resourceId: asId<ResourceId>('copperOre') })
    const compiled = compileBlueprint({ ...blueprint, edges })
    expect(isContract(compiled)).toBe(false)
    if (isContract(compiled)) return
    expect(compiled).toContainEqual(expect.objectContaining({ code: 'RESOURCE_MISMATCH', entity: { nodeId: asId<NodeId>('node-junction') } }))
  })
  it('rejects an isolated junction', () => {
    const blueprint = withJunctionOnOreLine()
    const junction = blueprint.nodes.get(asId<NodeId>('node-junction'))!
    const base = createDemoBlueprint()
    const compiled = compileBlueprint({ ...base, nodes: new Map(base.nodes).set(junction.id, junction) })
    expect(isContract(compiled)).toBe(false)
    if (isContract(compiled)) return
    expect(compiled).toContainEqual(expect.objectContaining({ code: 'UNREACHABLE_INPUT', entity: { nodeId: junction.id } }))
    expect(compiled).toContainEqual(expect.objectContaining({ code: 'UNROUTED_OUTPUT', entity: { nodeId: junction.id } }))
  })
  it('backpressures a saturated junction without reporting a graph error', () => {
    const compiled = compileBlueprint(withJunctionOnOreLine('1'))
    expect(isContract(compiled)).toBe(true)
    if (!isContract(compiled)) return
    expect(compiled.inputRates.get(asId<ResourceId>('ironOre'))).toBe(parseRate('1'))
    expect(compiled.machineActivity.get(asId<NodeId>('node-furnace'))).toBe(500_000n)
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false)
  })
  it('supplies three furnaces when the shared boundaries have enough capacity', () => {
    const compiled = compileBlueprint(withThreeFurnaces())
    expect(isContract(compiled)).toBe(true)
    if (!isContract(compiled)) return
    expect(compiled.inputRates.get(asId<ResourceId>('ironOre'))).toBe(parseRate('6'))
    expect(compiled.outputRates.get(asId<ResourceId>('ironIngot'))).toBe(parseRate('3'))
    expect([...compiled.machineActivity.values()]).toEqual([1_000_000n, 1_000_000n, 1_000_000n])
    expect(['edge-ore', 'edge-ore-2', 'edge-ore-3'].map((id) => compiled.edgeFlows.get(asId<EdgeId>(id)))).toEqual([parseRate('2'), parseRate('2'), parseRate('2')])
  })
  it('adapts a shared intake trunk to the actual recipe demand of every branch', () => {
    const compiled = compileBlueprint(withTwoFurnacesOnSharedOreTrunk())
    expect(isContract(compiled)).toBe(true)
    if (!isContract(compiled)) return
    expect(compiled.inputRates.get(asId<ResourceId>('ironOre'))).toBe(parseRate('4'))
    expect(compiled.machineActivity.get(asId<NodeId>('node-furnace'))).toBe(1_000_000n)
    expect(compiled.machineActivity.get(asId<NodeId>('node-furnace-2'))).toBe(1_000_000n)
    expect(compiled.edgeFlows.get(asId<EdgeId>('edge-ore-1'))).toBe(parseRate('2'))
    expect(compiled.edgeFlows.get(asId<EdgeId>('edge-ore-2'))).toBe(parseRate('2'))
  })
  it('explains when two routes exceed a shared destination port limit', () => {
    const blueprint = createDemoBlueprint()
    const furnace = blueprint.nodes.get(asId<NodeId>('node-furnace'))!
    if (furnace.kind !== 'machine') throw new Error('Fixture furnace must be a machine')
    const secondFurnace = {
      ...furnace,
      id: asId<NodeId>('node-furnace-2'),
      ports: furnace.ports.map((port, index) => ({ ...port, id: asId<PortId>(`port-furnace-2-${index}`) })),
    }
    const ore = blueprint.edges.get(asId<EdgeId>('edge-ore'))!
    const ingot = blueprint.edges.get(asId<EdgeId>('edge-ingot'))!
    const secondOre = { ...ore, id: asId<EdgeId>('edge-ore-2'), targetNodeId: secondFurnace.id, targetPortId: secondFurnace.ports[0]!.id }
    const secondIngot = { ...ingot, id: asId<EdgeId>('edge-ingot-2'), sourceNodeId: secondFurnace.id, sourcePortId: secondFurnace.ports[1]!.id }
    const invalid = { ...blueprint, nodes: new Map(blueprint.nodes).set(secondFurnace.id, secondFurnace), edges: new Map(blueprint.edges).set(secondOre.id, secondOre).set(secondIngot.id, secondIngot) }

    const compiled = compileBlueprint(invalid)

    expect(isContract(compiled)).toBe(false)
    if (isContract(compiled)) return
    expect(compiled).toContainEqual(expect.objectContaining({ code: 'CONNECTION_LIMIT', details: { connected: '2', limit: '1' } }))
  })
})
