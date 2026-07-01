import { describe, expect, it } from 'vitest'
import { asId } from '../domain'
import type { CompileDiagnostic } from '../compiler'
import type { EdgeId, NodeId, PortId } from '../domain'
import { createDemoBlueprint } from './demo-blueprint'
import { buildDiagnosticOverlay } from './diagnostic-overlay'

describe('diagnostic overlay', () => {
  it('highlights every route connected to an over-subscribed port', () => {
    const original = createDemoBlueprint()
    const originalEdge = original.edges.get(asId<EdgeId>('edge-ingot'))!
    const secondEdge = { ...originalEdge, id: asId<EdgeId>('edge-ingot-2'), sourceNodeId: asId<NodeId>('node-second-furnace') }
    const blueprint = { ...original, edges: new Map(original.edges).set(secondEdge.id, secondEdge) }
    const diagnostic: CompileDiagnostic = {
      code: 'CONNECTION_LIMIT', severity: 'error',
      entity: { nodeId: asId<NodeId>('node-iron-output'), portId: asId<PortId>('port-ingot-target') },
    }

    const overlay = buildDiagnosticOverlay(blueprint, [diagnostic])

    expect([...overlay.edgeDiagnostics.keys()].sort()).toEqual(['edge-ingot', 'edge-ingot-2'])
    expect([...overlay.blockedEdges]).toEqual(['edge-ore'])
  })

  it('marks unrelated routes as blocked only for errors', () => {
    const blueprint = createDemoBlueprint()
    const warning: CompileDiagnostic = { code: 'LIMITED_OUTPUT', severity: 'warning', entity: { nodeId: asId<NodeId>('node-furnace'), resourceId: asId('ironIngot') } }
    const overlay = buildDiagnosticOverlay(blueprint, [warning])

    expect([...overlay.edgeDiagnostics.keys()]).toEqual(['edge-ingot'])
    expect(overlay.blockedEdges.size).toBe(0)
  })
})
