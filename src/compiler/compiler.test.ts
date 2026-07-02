import { describe, expect, it } from 'vitest'
import { asId, gridPoint, parseRate } from '../domain'
import type { EdgeId, NodeId, PortId, ResourceId } from '../domain'
import { createDemoBlueprint } from '../ui/demo-blueprint'
import type { BlueprintNode, FactoryBlueprint } from '../editor'
import { compileBlueprint, isContract } from './compile'
import { topologicalSort } from './topological-sort'

const withJunctionOnOreLine = (outputCapacity = '6'): FactoryBlueprint => {
  const blueprint = createDemoBlueprint()
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
  return { ...blueprint, nodes: new Map(blueprint.nodes).set(junction.id, junction), edges }
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
