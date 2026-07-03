import { describe, expect, it } from 'vitest'
import { asId, gridPoint, polylineLength } from '../domain'
import type { EdgeId, NodeId } from '../domain'
import { createDemoBlueprint } from '../ui/demo-blueprint'
import { effectiveEdgePoints } from './blueprint'
import { blueprintTracks } from './blueprint'
import { canonicalBlueprint, deserializeBlueprint } from './canonicalize'
import { moveNode } from './commands'
import { orthogonalLength } from './routing'

describe('moving a graph node', () => {
  it('moves connected route endpoints to their absolute port positions', () => {
    const blueprint = createDemoBlueprint()
    const moved = moveNode(asId<NodeId>('node-furnace'), gridPoint(7, 10)).apply(blueprint).blueprint
    const incoming = moved.edges.get(asId<EdgeId>('edge-ore'))!
    const outgoing = moved.edges.get(asId<EdgeId>('edge-ingot'))!

    expect(incoming.points.at(-1)).toEqual(gridPoint(7, 11))
    expect(outgoing.points[0]).toEqual(gridPoint(11, 11))
    expect(polylineLength(incoming.points)).toBeGreaterThan(polylineLength(blueprint.edges.get(incoming.id)!.points))
  })

  it('repairs a stale endpoint left by an earlier move', () => {
    const blueprint = createDemoBlueprint()
    const stale = {
      ...blueprint,
      nodes: new Map(blueprint.nodes).set(asId<NodeId>('node-furnace'), { ...blueprint.nodes.get(asId<NodeId>('node-furnace'))!, position: gridPoint(7, 10) }),
    }

    expect(effectiveEdgePoints(stale, stale.edges.get(asId<EdgeId>('edge-ore'))!).at(-1)).toEqual(gridPoint(7, 11))

    const repaired = moveNode(asId<NodeId>('node-furnace'), gridPoint(7, 11)).apply(stale).blueprint
    expect(repaired.edges.get(asId<EdgeId>('edge-ore'))!.points.at(-1)).toEqual(gridPoint(7, 12))
  })

  it('recomputes attached tracks without invoking an autorouter and preserves one history transaction', () => {
    const migrated = deserializeBlueprint(JSON.parse(canonicalBlueprint(createDemoBlueprint())))
    const moved = moveNode(asId<NodeId>('node-furnace'), gridPoint(8, 9)).apply(migrated).blueprint
    const attached = [...blueprintTracks(moved).values()].filter((track) => track.netIds.some((id) => id === asId('net-ore') || id === asId('net-ingot')))
    expect(attached.some((track) => track.id.includes('reroute:'))).toBe(false)
    expect(attached.every((track) => orthogonalLength(track.points) > 0)).toBe(true)
    expect(moved.revision).toBe(migrated.revision + 1)
  })
})
