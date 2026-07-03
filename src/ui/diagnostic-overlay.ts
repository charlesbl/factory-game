import type { CompileDiagnostic, DiagnosticSeverity } from '../compiler'
import type { EdgeId, NodeId } from '../domain'
import type { FactoryBlueprint } from '../editor'
import { blueprintNets, blueprintTracks, blueprintTransitions, legacyNetForEdge } from '../editor'

export interface DiagnosticOverlay {
  readonly edgeDiagnostics: ReadonlyMap<EdgeId, CompileDiagnostic>
  readonly nodeDiagnostics: ReadonlyMap<NodeId, CompileDiagnostic>
  readonly blockedEdges: ReadonlySet<EdgeId>
}

const severityRank: Record<DiagnosticSeverity, number> = { info: 0, warning: 1, error: 2 }
const keepMostSevere = <Id>(map: Map<Id, CompileDiagnostic>, id: Id, diagnostic: CompileDiagnostic): void => {
  const current = map.get(id)
  if (current === undefined || severityRank[diagnostic.severity] > severityRank[current.severity]) map.set(id, diagnostic)
}

export const buildDiagnosticOverlay = (blueprint: FactoryBlueprint, diagnostics: readonly CompileDiagnostic[]): DiagnosticOverlay => {
  const edgeDiagnostics = new Map<EdgeId, CompileDiagnostic>()
  const nodeDiagnostics = new Map<NodeId, CompileDiagnostic>()

  for (const diagnostic of diagnostics) {
    const { edgeId, netId, trackId, transitionId, nodeId, portId, resourceId } = diagnostic.entity
    if (edgeId !== undefined) keepMostSevere(edgeDiagnostics, edgeId, diagnostic)
    if (nodeId !== undefined) keepMostSevere(nodeDiagnostics, nodeId, diagnostic)

    for (const edge of blueprint.edges.values()) {
      const edgeNet = blueprintNets(blueprint).get(legacyNetForEdge(edge).id) ?? [...blueprintNets(blueprint).values()].find((net) => net.source.portId === edge.sourcePortId && net.targets.some((target) => target.portId === edge.targetPortId))
      const belongsToPhysicalRoute = (netId !== undefined && edgeNet?.id === netId)
        || (trackId !== undefined && blueprintTracks(blueprint).get(trackId)?.netIds.includes(edgeNet?.id ?? legacyNetForEdge(edge).id) === true)
        || (transitionId !== undefined && blueprintTransitions(blueprint).get(transitionId)?.netIds.includes(edgeNet?.id ?? legacyNetForEdge(edge).id) === true)
      const belongsToNode = nodeId === undefined || edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId
      const touchesPort = portId !== undefined && (edge.sourcePortId === portId || edge.targetPortId === portId)
      const entersLimitedNode = diagnostic.code === 'LIMITED_INPUT' && edge.targetNodeId === nodeId && (resourceId === undefined || edge.resourceId === resourceId)
      const leavesLimitedNode = diagnostic.code === 'LIMITED_OUTPUT' && edge.sourceNodeId === nodeId && (resourceId === undefined || edge.resourceId === resourceId)
      const touchesBrokenNode = (diagnostic.code === 'CYCLE' || diagnostic.code === 'INTERNAL_VERIFICATION')
        && nodeId !== undefined && (edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId)

      if (belongsToPhysicalRoute || (belongsToNode && (touchesPort || entersLimitedNode || leavesLimitedNode || touchesBrokenNode))) {
        keepMostSevere(edgeDiagnostics, edge.id, diagnostic)
      }
    }
  }

  const hasBlockingError = diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  const blockedEdges = new Set<EdgeId>()
  if (hasBlockingError) {
    for (const edgeId of blueprint.edges.keys()) if (!edgeDiagnostics.has(edgeId)) blockedEdges.add(edgeId)
  }

  return { edgeDiagnostics, nodeDiagnostics, blockedEdges }
}
