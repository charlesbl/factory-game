import { describe, expect, it } from 'vitest'
import { asId, gridPoint } from '../domain'
import type { EdgeId, NodeId } from '../domain'
import { createDemoBlueprint } from '../ui/demo-blueprint'
import { moveNode } from './commands'
import { edgeRoute } from './connector-route'

describe('moving a graph node', () => {
  it('derives moved endpoints without rewriting route data', () => {
    const blueprint = createDemoBlueprint(); const edge = blueprint.edges.get(asId<EdgeId>('edge-ore'))!; const before = edgeRoute(blueprint, edge).points
    const moved = moveNode(asId<NodeId>('node-furnace'), gridPoint(8, 9)).apply(blueprint).blueprint
    expect(moved.edges.get(edge.id)).toBe(edge)
    expect(edgeRoute(moved, edge).points.at(-1)).toEqual(gridPoint(8, 10))
    expect(edgeRoute(moved, edge).points).not.toEqual(before)
  })
})
