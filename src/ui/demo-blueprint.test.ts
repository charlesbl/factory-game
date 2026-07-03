import { describe, expect, it } from 'vitest'
import { asId } from '../domain'
import type { NodeId, PortId, RecipeId, ResourceId } from '../domain'
import { createBoundaryNode, createDemoBlueprint, createMachineNode } from './demo-blueprint'

describe('starter factory', () => {
  it('uses the same constructors as player-placed machines and boundary ports', () => {
    const blueprint = createDemoBlueprint()
    expect(blueprint.nodes.get(asId<NodeId>('node-furnace'))).toEqual(createMachineNode(asId<NodeId>('node-furnace'), asId<RecipeId>('ironIngot'), 7, 3))
    expect(blueprint.nodes.get(asId<NodeId>('node-iron-input'))).toEqual(createBoundaryNode(asId<NodeId>('node-iron-input'), asId<PortId>('port-iron-source'), 'external-input', asId<ResourceId>('ironOre'), 0, 4))
    expect(blueprint.nodes.get(asId<NodeId>('node-iron-output'))).toEqual(createBoundaryNode(asId<NodeId>('node-iron-output'), asId<PortId>('port-ingot-target'), 'external-output', asId<ResourceId>('ironIngot'), 16, 4, '4'))
    expect(blueprint.nodes.get(asId<NodeId>('node-iron-input'))?.footprint.width).toBe(4)
    expect(blueprint.nodes.get(asId<NodeId>('node-iron-input'))?.ports[0]?.anchor.x).toBe(4)
  })
})
