import { boundingRect, polylineLength, RATE_SCALE, recipeById, ratioFromRate, scaleRate } from '../domain'
import type { EdgeId, FixedRatio, NodeId, PortId, RateRaw, ResourceId } from '../domain'
import type { BlueprintEdge, BlueprintNode, FactoryBlueprint } from '../editor'
import { blueprintNets, blueprintTracks, blueprintTransitions, canonicalCompilationInput, cellsOnTrack, effectiveEdgePoints, effectiveTrackPoints, findPort, legacyNetForEdge } from '../editor'
import type { FactoryContract } from './contract'
import type { CompileDiagnostic } from './diagnostics'
import { validateBlueprint } from './validate'
import { projectExternalPorts } from './footprint'

export interface FlowSolver { solve(blueprint: FactoryBlueprint, hash: string): FactoryContract | readonly CompileDiagnostic[] }
const addRate = (map: Map<ResourceId, RateRaw>, id: ResourceId, value: RateRaw): void => { map.set(id, (map.get(id) ?? 0n) + value) }
const edgeOrder = (blueprint: FactoryBlueprint, edge: BlueprintEdge): readonly [number, number, number, string] => {
  const target = blueprint.nodes.get(edge.targetNodeId)
  const net = blueprintNets(blueprint).get(legacyNetForEdge(edge).id) ?? [...blueprintNets(blueprint).values()].find((candidate) => candidate.source.portId === edge.sourcePortId && candidate.targets.some((destination) => destination.portId === edge.targetPortId))
  const transitionLength = net === undefined ? 0 : [...blueprintTransitions(blueprint).values()].filter((transition) => transition.netIds.includes(net.id)).reduce((total, transition) => total + transition.length, 0)
  return [polylineLength(effectiveEdgePoints(blueprint, edge)) + transitionLength, target?.position.y ?? 0, target?.position.x ?? 0, edge.id]
}
const compareEdge = (blueprint: FactoryBlueprint) => (a: BlueprintEdge, b: BlueprintEdge): number => {
  const ak = edgeOrder(blueprint, a); const bk = edgeOrder(blueprint, b)
  return ak[0] - bk[0] || ak[1] - bk[1] || ak[2] - bk[2] || ak[3].localeCompare(bk[3])
}
const withoutPhysicalTracks = (blueprint: FactoryBlueprint): FactoryBlueprint => {
  const logical = { ...blueprint }
  delete logical.tracks
  delete logical.transitions
  return logical
}

export class ExactDagFlowSolver implements FlowSolver {
  constructor(private readonly childContracts: ReadonlyMap<string, FactoryContract> = new Map()) {}
  solve(blueprint: FactoryBlueprint, hash: string): FactoryContract | readonly CompileDiagnostic[] {
    const validation = validateBlueprint(blueprint)
    if (!validation.ok) return validation.diagnostics
    const logicalResult = blueprint.tracks === undefined ? undefined : this.solve(withoutPhysicalTracks(blueprint), `${hash}:logical`)
    const logicalEdgeFlows = logicalResult !== undefined && 'edgeFlows' in logicalResult ? logicalResult.edgeFlows : undefined
    const edgeFlows = new Map<EdgeId, RateRaw>(); const activity = new Map<NodeId, FixedRatio>(); const diagnostics: CompileDiagnostic[] = []
    const physicalCapacityByNet = new Map([...blueprintNets(blueprint).values()].map((net) => [net.id, net.requestedCapacity] as const))
    if (blueprint.tracks !== undefined) {
      const pools = new Map<string, { capacity: RateRaw; netIds: Set<ReturnType<typeof legacyNetForEdge>['id']> }>()
      for (const track of [...blueprintTracks(blueprint).values()].sort((a, b) => a.id.localeCompare(b.id))) {
        const cells = cellsOnTrack(effectiveTrackPoints(blueprint, track))
        for (let index = 1; index < cells.length; index += 1) {
          const a = cells[index - 1]!; const b = cells[index]!; const endpoints = [`${a.x},${a.y}`, `${b.x},${b.y}`].sort(); const key = `${track.layerId}:${track.resourceId}:${endpoints.join('>')}`
          const pool = pools.get(key) ?? { capacity: track.capacity, netIds: new Set() }; if (track.capacity < pool.capacity) pool.capacity = track.capacity
          track.netIds.forEach((id) => pool.netIds.add(id)); pools.set(key, pool)
        }
      }
      for (const [, pool] of [...pools].sort(([a], [b]) => a.localeCompare(b))) {
        let remaining = pool.capacity
        const edgeForNet = (netId: ReturnType<typeof legacyNetForEdge>['id']): BlueprintEdge | undefined => {
          const net = blueprintNets(blueprint).get(netId); if (net === undefined) return undefined
          return [...blueprint.edges.values()].find((edge) => edge.sourcePortId === net.source.portId && net.targets.some((target) => target.portId === edge.targetPortId))
        }
        for (const netId of [...pool.netIds].sort((a, b) => { const edgeA = edgeForNet(a); const edgeB = edgeForNet(b); return edgeA !== undefined && edgeB !== undefined ? compareEdge(blueprint)(edgeA, edgeB) : edgeA === undefined && edgeB !== undefined ? 1 : edgeA !== undefined ? -1 : a.localeCompare(b) })) {
          const edge = edgeForNet(netId)
          const demand = edge === undefined ? blueprintNets(blueprint).get(netId)?.requestedCapacity ?? 0n : logicalEdgeFlows?.get(edge.id) ?? edge.capacity
          const allocated = demand < remaining ? demand : remaining; remaining -= allocated
          const existing = physicalCapacityByNet.get(netId); if (existing === undefined || allocated < existing) physicalCapacityByNet.set(netId, allocated)
        }
      }
    }
    const capacityFor = (edge: BlueprintEdge): RateRaw => {
      if (blueprint.nets === undefined) return edge.capacity
      const net = blueprintNets(blueprint).get(legacyNetForEdge(edge).id) ?? [...blueprintNets(blueprint).values()].find((candidate) => candidate.source.nodeId === edge.sourceNodeId && candidate.source.portId === edge.sourcePortId && candidate.targets.some((target) => target.nodeId === edge.targetNodeId && target.portId === edge.targetPortId))
      const physical = net === undefined ? edge.capacity : physicalCapacityByNet.get(net.id) ?? 0n
      return physical < edge.capacity ? physical : edge.capacity
    }
    const incomingByNode = new Map<NodeId, Map<ResourceId, RateRaw>>()
    const portFlows = new Map<PortId, RateRaw>()
    const nominalInputDemand = (node: BlueprintNode, resourceId: ResourceId): RateRaw | undefined => {
      if (node.kind === 'machine') return recipeById.get(node.recipeId)?.inputs.filter((input) => input.resourceId === resourceId).reduce((total, input) => total + input.rate, 0n)
      if (node.kind === 'sub-factory') return this.childContracts.get(node.contractId)?.inputRates.get(resourceId)
      return undefined
    }
    const allocate = (node: BlueprintNode, available: Map<ResourceId, RateRaw>): void => {
      for (const resourceId of [...available.keys()].sort()) {
        let remaining = available.get(resourceId) ?? 0n
        const edges = [...blueprint.edges.values()].filter((edge) => edge.sourceNodeId === node.id && edge.resourceId === resourceId).sort(compareEdge(blueprint))
        for (const edge of edges) {
          const sourcePort = findPort(blueprint, edge.sourceNodeId, edge.sourcePortId); const targetPort = findPort(blueprint, edge.targetNodeId, edge.targetPortId)
          if (sourcePort === undefined || targetPort === undefined) continue
          const sourceRemaining = sourcePort.capacity - (portFlows.get(sourcePort.id) ?? 0n)
          const targetRemaining = targetPort.capacity - (portFlows.get(targetPort.id) ?? 0n)
          const targetNode = blueprint.nodes.get(edge.targetNodeId)
          const nominalDemand = targetNode === undefined ? undefined : nominalInputDemand(targetNode, resourceId)
          const demandRemaining = nominalDemand === undefined ? undefined : nominalDemand - (incomingByNode.get(edge.targetNodeId)?.get(resourceId) ?? 0n)
          const limits = demandRemaining === undefined ? [remaining, capacityFor(edge), sourceRemaining, targetRemaining] : [remaining, capacityFor(edge), sourceRemaining, targetRemaining, demandRemaining]
          const flow = limits.reduce((minimum, value) => value < minimum ? value : minimum)
          edgeFlows.set(edge.id, flow); remaining -= flow
          portFlows.set(sourcePort.id, (portFlows.get(sourcePort.id) ?? 0n) + flow); portFlows.set(targetPort.id, (portFlows.get(targetPort.id) ?? 0n) + flow)
          const target = incomingByNode.get(edge.targetNodeId) ?? new Map<ResourceId, RateRaw>()
          addRate(target, resourceId, flow); incomingByNode.set(edge.targetNodeId, target)
        }
        if (remaining > 0n && node.kind === 'machine') diagnostics.push({ code: 'LIMITED_OUTPUT', severity: 'warning', entity: { nodeId: node.id, resourceId }, details: { value: resourceId } })
      }
    }
    for (const nodeId of validation.graph.order) {
      const node = blueprint.nodes.get(nodeId)!; const incoming = incomingByNode.get(nodeId) ?? new Map<ResourceId, RateRaw>()
      if (node.kind === 'external-input') {
        const available = new Map<ResourceId, RateRaw>(); for (const port of node.ports.filter((item) => item.direction === 'output')) addRate(available, port.resourceId, port.capacity)
        allocate(node, available)
      } else if (node.kind === 'junction') allocate(node, incoming)
      else if (node.kind === 'sub-factory') {
        const child = this.childContracts.get(node.contractId)
        if (child === undefined) return [{ code: 'MISSING_CHILD_CONTRACT', severity: 'error', entity: { nodeId: node.id } }]
        let ratio = RATE_SCALE
        for (const [resource, rate] of child.inputRates) { const available = incoming.get(resource) ?? 0n; const inputRatio = ratioFromRate(available, rate); if (inputRatio < ratio) ratio = inputRatio }
        for (const [resource, rate] of child.outputRates) { const capacity = [...blueprint.edges.values()].filter((edge) => edge.sourceNodeId === node.id && edge.resourceId === resource).reduce((sum, edge) => sum + capacityFor(edge), 0n); const outputRatio = ratioFromRate(capacity, rate); if (outputRatio < ratio) ratio = outputRatio }
        activity.set(node.id, ratio)
        for (const [resource, rate] of child.inputRates) {
          let required = scaleRate(rate, ratio)
          for (const edge of [...blueprint.edges.values()].filter((item) => item.targetNodeId === node.id && item.resourceId === resource).sort(compareEdge(blueprint))) { const allocated = edgeFlows.get(edge.id) ?? 0n; const consumed = allocated < required ? allocated : required; edgeFlows.set(edge.id, consumed); required -= consumed }
        }
        const available = new Map<ResourceId, RateRaw>(); for (const [resource, rate] of child.outputRates) available.set(resource, scaleRate(rate, ratio)); allocate(node, available)
      }
      else if (node.kind === 'machine') {
        const recipe = recipeById.get(node.recipeId); if (recipe === undefined) return [{ code: 'INTERNAL_VERIFICATION', severity: 'error', entity: { nodeId } }]
        let ratio = RATE_SCALE
        for (const input of recipe.inputs) ratio = ratio < ratioFromRate(incoming.get(input.resourceId) ?? 0n, input.rate) ? ratio : ratioFromRate(incoming.get(input.resourceId) ?? 0n, input.rate)
        for (const output of recipe.outputs) {
          const capacity = [...blueprint.edges.values()].filter((edge) => edge.sourceNodeId === node.id && edge.resourceId === output.resourceId).reduce((sum, edge) => sum + capacityFor(edge), 0n)
          const outputRatio = ratioFromRate(capacity, output.rate); if (outputRatio < ratio) ratio = outputRatio
        }
        if (ratio > RATE_SCALE) ratio = RATE_SCALE
        activity.set(node.id, ratio)
        for (const input of recipe.inputs) {
          let required = scaleRate(input.rate, ratio)
          const inputEdges = [...blueprint.edges.values()].filter((edge) => edge.targetNodeId === node.id && edge.resourceId === input.resourceId).sort(compareEdge(blueprint))
          for (const edge of inputEdges) {
            const allocated = edgeFlows.get(edge.id) ?? 0n
            const consumed = allocated < required ? allocated : required
            edgeFlows.set(edge.id, consumed); required -= consumed
          }
        }
        if (ratio < RATE_SCALE) diagnostics.push({ code: 'LIMITED_INPUT', severity: 'warning', entity: { nodeId }, details: { value: recipe.inputs.find((input) => (incoming.get(input.resourceId) ?? 0n) < input.rate)?.resourceId ?? 'capacity' } })
        const available = new Map<ResourceId, RateRaw>(); for (const output of recipe.outputs) addRate(available, output.resourceId, scaleRate(output.rate, ratio))
        allocate(node, available)
      }
    }
    const retainFlow = (edges: readonly BlueprintEdge[], demand: RateRaw): boolean => {
      let remaining = demand
      for (const edge of [...edges].sort(compareEdge(blueprint))) { const allocated = edgeFlows.get(edge.id) ?? 0n; const retained = allocated < remaining ? allocated : remaining; edgeFlows.set(edge.id, retained); remaining -= retained }
      return remaining === 0n
    }
    for (const nodeId of [...validation.graph.order].reverse()) {
      const node = blueprint.nodes.get(nodeId)!
      if (node.kind === 'junction') {
        const resources = new Set<ResourceId>()
        for (const edge of blueprint.edges.values()) if (edge.sourceNodeId === node.id || edge.targetNodeId === node.id) resources.add(edge.resourceId)
        for (const resource of resources) {
          const demand = [...blueprint.edges.values()].filter((edge) => edge.sourceNodeId === node.id && edge.resourceId === resource).reduce((sum, edge) => sum + (edgeFlows.get(edge.id) ?? 0n), 0n)
          if (!retainFlow([...blueprint.edges.values()].filter((edge) => edge.targetNodeId === node.id && edge.resourceId === resource), demand)) return [{ code: 'INTERNAL_VERIFICATION', severity: 'error', entity: { nodeId: node.id, resourceId: resource }, details: { value: 'junction conservation' } }]
        }
      } else if (node.kind === 'machine') {
        const recipe = recipeById.get(node.recipeId)!; let ratio = activity.get(node.id) ?? 0n
        for (const output of recipe.outputs) { const delivered = [...blueprint.edges.values()].filter((edge) => edge.sourceNodeId === node.id && edge.resourceId === output.resourceId).reduce((sum, edge) => sum + (edgeFlows.get(edge.id) ?? 0n), 0n); const outputRatio = ratioFromRate(delivered, output.rate); if (outputRatio < ratio) ratio = outputRatio }
        activity.set(node.id, ratio)
        for (const output of recipe.outputs) retainFlow([...blueprint.edges.values()].filter((edge) => edge.sourceNodeId === node.id && edge.resourceId === output.resourceId), scaleRate(output.rate, ratio))
        for (const input of recipe.inputs) if (!retainFlow([...blueprint.edges.values()].filter((edge) => edge.targetNodeId === node.id && edge.resourceId === input.resourceId), scaleRate(input.rate, ratio))) return [{ code: 'INTERNAL_VERIFICATION', severity: 'error', entity: { nodeId: node.id, resourceId: input.resourceId }, details: { value: 'machine conservation' } }]
      } else if (node.kind === 'sub-factory') {
        const child = this.childContracts.get(node.contractId); if (child === undefined) continue; let ratio = activity.get(node.id) ?? 0n
        for (const [resource, rate] of child.outputRates) { const delivered = [...blueprint.edges.values()].filter((edge) => edge.sourceNodeId === node.id && edge.resourceId === resource).reduce((sum, edge) => sum + (edgeFlows.get(edge.id) ?? 0n), 0n); const outputRatio = ratioFromRate(delivered, rate); if (outputRatio < ratio) ratio = outputRatio }
        activity.set(node.id, ratio)
        for (const [resource, rate] of child.outputRates) retainFlow([...blueprint.edges.values()].filter((edge) => edge.sourceNodeId === node.id && edge.resourceId === resource), scaleRate(rate, ratio))
        for (const [resource, rate] of child.inputRates) if (!retainFlow([...blueprint.edges.values()].filter((edge) => edge.targetNodeId === node.id && edge.resourceId === resource), scaleRate(rate, ratio))) return [{ code: 'INTERNAL_VERIFICATION', severity: 'error', entity: { nodeId: node.id, resourceId: resource }, details: { value: 'sub-factory conservation' } }]
      }
    }
    const inputRates = new Map<ResourceId, RateRaw>(); const outputRates = new Map<ResourceId, RateRaw>()
    for (const edge of blueprint.edges.values()) {
      const flow = edgeFlows.get(edge.id) ?? 0n; const source = blueprint.nodes.get(edge.sourceNodeId); const target = blueprint.nodes.get(edge.targetNodeId)
      if (source?.kind === 'external-input') addRate(inputRates, edge.resourceId, flow)
      if (target?.kind === 'external-output') addRate(outputRates, edge.resourceId, flow)
    }
    const points = [...blueprint.nodes.values()].flatMap((node) => [node.position, { x: node.position.x + node.footprint.width, y: node.position.y + node.footprint.height }]).concat([...blueprint.edges.values()].flatMap((edge) => [...effectiveEdgePoints(blueprint, edge)]))
    const footprint = boundingRect(points, 2)
    const boundaryPorts = projectExternalPorts(blueprint, footprint)
    return { schemaVersion: 1, blueprintHash: hash, inputRates, outputRates, inputPorts: boundaryPorts.filter((port) => port.direction === 'input'), outputPorts: boundaryPorts.filter((port) => port.direction === 'output'), footprint, machineActivity: activity, edgeFlows, diagnostics }
  }
}

const weakHash = (value: string): string => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return `local-${(hash >>> 0).toString(16).padStart(8, '0')}`
}
export const compileBlueprint = (blueprint: FactoryBlueprint, solver: FlowSolver = new ExactDagFlowSolver()): FactoryContract | readonly CompileDiagnostic[] => solver.solve(blueprint, weakHash(canonicalCompilationInput(blueprint)))
export const isContract = (value: FactoryContract | readonly CompileDiagnostic[]): value is FactoryContract => !Array.isArray(value)
