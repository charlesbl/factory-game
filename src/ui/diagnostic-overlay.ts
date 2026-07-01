import type { CompileDiagnostic, DiagnosticSeverity } from '../compiler'
import type { EdgeId, NodeId } from '../domain'
import type { FactoryBlueprint } from '../editor'

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
    const { edgeId, nodeId, portId, resourceId } = diagnostic.entity
    if (edgeId !== undefined) keepMostSevere(edgeDiagnostics, edgeId, diagnostic)
    if (nodeId !== undefined) keepMostSevere(nodeDiagnostics, nodeId, diagnostic)

    for (const edge of blueprint.edges.values()) {
      const belongsToNode = nodeId === undefined || edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId
      const touchesPort = portId !== undefined && (edge.sourcePortId === portId || edge.targetPortId === portId)
      const entersLimitedNode = diagnostic.code === 'LIMITED_INPUT' && edge.targetNodeId === nodeId && (resourceId === undefined || edge.resourceId === resourceId)
      const leavesLimitedNode = diagnostic.code === 'LIMITED_OUTPUT' && edge.sourceNodeId === nodeId && (resourceId === undefined || edge.resourceId === resourceId)
      const touchesBrokenNode = (diagnostic.code === 'CYCLE' || diagnostic.code === 'INTERNAL_VERIFICATION')
        && nodeId !== undefined && (edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId)

      if (belongsToNode && (touchesPort || entersLimitedNode || leavesLimitedNode || touchesBrokenNode)) {
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
