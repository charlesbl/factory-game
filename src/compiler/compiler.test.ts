import { describe, expect, it } from 'vitest'
import { asId, parseRate } from '../domain'
import type { EdgeId, NodeId, PortId, ResourceId } from '../domain'
import { createDemoBlueprint } from '../ui/demo-blueprint'
import { compileBlueprint, isContract } from './compile'
import { topologicalSort } from './topological-sort'

describe('deterministic compilation', () => {
  it('compiles a coupled line with exact conserved rates', () => {
    const compiled = compileBlueprint(createDemoBlueprint()); expect(isContract(compiled)).toBe(true)
    if (!isContract(compiled)) return
    expect(compiled.inputRates.get(asId<ResourceId>('ironOre'))).toBe(parseRate('2'))
    expect(compiled.outputRates.get(asId<ResourceId>('ironIngot'))).toBe(parseRate('1'))
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
  it('explains when two routes exceed a shared destination port limit', () => {
    const blueprint = createDemoBlueprint()
    const furnace = blueprint.nodes.get(asId<NodeId>('node-furnace'))!
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
