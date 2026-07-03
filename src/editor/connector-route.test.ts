import { describe, expect, it } from 'vitest'
import { asId, gridPoint } from '../domain'
import { validateBlueprint } from '../compiler/validate'
import { createDemoBlueprint } from '../ui/demo-blueprint'
import { materializeConnectorRoute } from './connector-route'
import { addBridgeAt, moveNode } from './commands'
import { blueprintTracks, blueprintTransitions } from './blueprint'

describe('connector-driven orthogonal routes', () => {
  it('materializes one inherited right-angle bend per unaligned span', () => {
    const route = materializeConnectorRoute(gridPoint(0, 0), [
      { id: asId('connector-a'), position: gridPoint(4, 3) },
      { id: asId('connector-b'), position: gridPoint(7, 6) },
    ], 'horizontal')
    expect(route.points).toEqual([gridPoint(0, 0), gridPoint(4, 0), gridPoint(4, 3), gridPoint(4, 6), gridPoint(7, 6)])
    expect(route.spans.every((span) => span.length <= 3)).toBe(true)
  })
  it('chooses the other L when the inherited one would backtrack over the route', () => {
    const route = materializeConnectorRoute(gridPoint(0, 0), [
      { id: asId('connector-forward'), position: gridPoint(4, 3) },
      { id: asId('connector-back'), position: gridPoint(2, 1) },
    ], 'horizontal')
    expect(route.spans[1]).toEqual([gridPoint(4, 3), gridPoint(2, 3), gridPoint(2, 1)])
  })

  it('keeps connectors fixed and reports when a moved machine overlaps their passive route', () => {
    const first = moveNode(asId('node-furnace'), gridPoint(8, 3)).apply(createDemoBlueprint()).blueprint
    const latest = moveNode(asId('node-furnace'), gridPoint(9, 3)).apply(first).blueprint
    const validation = validateBlueprint(latest); expect(validation.ok).toBe(false)
    if (!validation.ok) expect(validation.diagnostics).toContainEqual(expect.objectContaining({ code: 'MACHINE_KEEPOUT', entity: expect.objectContaining({ nodeId: 'node-furnace' }) }))
  })
  it('adds a short contextual bridge without changing logical connectivity', () => {
    const blueprint = createDemoBlueprint(); const bridged = addBridgeAt(asId('edge-ore'), gridPoint(5, 4)).apply(blueprint).blueprint
    expect([...blueprintTracks(bridged).values()].filter((track) => track.layerId === 'bridge')).toHaveLength(1)
    expect(blueprintTransitions(bridged).size).toBe(2)
    expect(bridged.edges.size).toBe(blueprint.edges.size)
  })
})
