import { polylineLength } from '../domain'
import type { NodeId, PortId } from '../domain'
import type { FactoryBlueprint } from '../editor'
import { findPort } from '../editor'
import type { CompileDiagnostic } from './diagnostics'
import { topologicalSort } from './topological-sort'

export interface ValidatedGraph { readonly blueprint: FactoryBlueprint; readonly order: readonly NodeId[]; readonly diagnostics: readonly CompileDiagnostic[] }
export type ValidationResult = { readonly ok: true; readonly graph: ValidatedGraph } | { readonly ok: false; readonly diagnostics: readonly CompileDiagnostic[]; readonly partialOrder: readonly NodeId[] }

export const validateBlueprint = (blueprint: FactoryBlueprint): ValidationResult => {
  const diagnostics: CompileDiagnostic[] = []
  const usage = new Map<PortId, number>()
  for (const edge of [...blueprint.edges.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const sourceNode = blueprint.nodes.get(edge.sourceNodeId); const targetNode = blueprint.nodes.get(edge.targetNodeId)
    const source = findPort(blueprint, edge.sourceNodeId, edge.sourcePortId); const target = findPort(blueprint, edge.targetNodeId, edge.targetPortId)
    if (sourceNode === undefined || targetNode === undefined || source === undefined || target === undefined) {
      diagnostics.push({ code: 'BROKEN_REFERENCE', severity: 'error', entity: { edgeId: edge.id } }); continue
    }
    if (source.direction !== 'output' || target.direction !== 'input') diagnostics.push({ code: 'PORT_DIRECTION', severity: 'error', entity: { edgeId: edge.id } })
    if (source.resourceId !== target.resourceId || source.resourceId !== edge.resourceId) diagnostics.push({ code: 'RESOURCE_MISMATCH', severity: 'error', entity: { edgeId: edge.id } })
    if (edge.capacity <= 0n) diagnostics.push({ code: 'NON_POSITIVE_CAPACITY', severity: 'error', entity: { edgeId: edge.id } })
    try { if (polylineLength(edge.points) === 0) diagnostics.push({ code: 'ZERO_LENGTH', severity: 'error', entity: { edgeId: edge.id } }) } catch { diagnostics.push({ code: 'ZERO_LENGTH', severity: 'error', entity: { edgeId: edge.id } }) }
    usage.set(source.id, (usage.get(source.id) ?? 0) + 1); usage.set(target.id, (usage.get(target.id) ?? 0) + 1)
  }
  for (const node of blueprint.nodes.values()) for (const port of node.ports) {
    const connected = usage.get(port.id) ?? 0
    if (connected > port.maxConnections) diagnostics.push({
      code: 'CONNECTION_LIMIT', severity: 'error', entity: { nodeId: node.id, portId: port.id },
      details: { connected: connected.toString(), limit: port.maxConnections.toString() },
    })
  }
  for (const node of blueprint.nodes.values()) {
    const incoming = [...blueprint.edges.values()].filter((edge) => edge.targetNodeId === node.id)
    const outgoing = [...blueprint.edges.values()].filter((edge) => edge.sourceNodeId === node.id)
    if (node.kind === 'machine') {
      for (const port of node.ports.filter((item) => item.direction === 'input')) if (!incoming.some((edge) => edge.targetPortId === port.id)) diagnostics.push({ code: 'UNREACHABLE_INPUT', severity: 'error', entity: { nodeId: node.id, portId: port.id, resourceId: port.resourceId } })
      for (const port of node.ports.filter((item) => item.direction === 'output')) if (!outgoing.some((edge) => edge.sourcePortId === port.id)) diagnostics.push({ code: 'UNROUTED_OUTPUT', severity: 'error', entity: { nodeId: node.id, portId: port.id, resourceId: port.resourceId } })
    }
    if (node.kind === 'sub-factory' && node.contractId.length === 0) diagnostics.push({ code: 'MISSING_CHILD_CONTRACT', severity: 'error', entity: { nodeId: node.id } })
  }
  const topological = topologicalSort(blueprint)
  for (const nodeId of topological.cyclic) diagnostics.push({ code: 'CYCLE', severity: 'error', entity: { nodeId } })
  const errors = diagnostics.filter((item) => item.severity === 'error')
  return errors.length > 0 ? { ok: false, diagnostics, partialOrder: topological.order } : { ok: true, graph: { blueprint, order: topological.order, diagnostics } }
}
