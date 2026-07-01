import { describe, expect, it } from 'vitest'
import { asId, createIdFactory, gridPoint } from '../domain'
import type { NodeId } from '../domain'
import { createDemoBlueprint } from '../ui/demo-blueprint'
import { canonicalBlueprint } from './canonicalize'
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
})
