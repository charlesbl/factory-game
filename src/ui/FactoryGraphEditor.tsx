import { Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, type Connection, type Edge, type EdgeChange, type NodeChange, type OnSelectionChangeParams, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useMemo, useState } from 'react'
import { asId, gridPoint, resourceById } from '../domain'
import type { EdgeId, NodeId, PortId, RateRaw } from '../domain'
import type { CompileDiagnostic, FactoryContract } from '../compiler'
import { diagnosticText } from '../compiler'
import type { BlueprintEdge, FactoryBlueprint } from '../editor'
import { connectPorts, disconnectEdge, effectivePortResource, moveNode, removeNode, transaction } from '../editor'
import type { EditCommand } from '../editor'
import { FactoryNodeView, type FactoryFlowNode } from './FactoryNode'
import { buildDiagnosticOverlay } from './diagnostic-overlay'
import { formatPortRate } from './factory-node-rates'
import { GRID_SIZE, gridToPixel, pixelToGrid } from './grid-projection'

const nodeTypes = { factory: FactoryNodeView }

export interface GraphSelection { readonly nodeIds: readonly NodeId[]; readonly edgeIds: readonly EdgeId[] }
interface Props { readonly blueprint: FactoryBlueprint; readonly contract: FactoryContract | undefined; readonly diagnostics: readonly CompileDiagnostic[]; readonly diagnosticsVisible: boolean; readonly onCommand: (command: EditCommand) => void; readonly onSelection: (selection: GraphSelection) => void }
export const FactoryGraphEditor = ({ blueprint, contract, diagnostics, diagnosticsVisible, onCommand, onSelection }: Props) => {
  const diagnosticOverlay = useMemo(() => buildDiagnosticOverlay(blueprint, diagnosticsVisible ? diagnostics : []), [blueprint, diagnostics, diagnosticsVisible])
  const portFlows = useMemo(() => {
    if (contract === undefined) return undefined
    const flows = new Map<PortId, RateRaw>()
    for (const edge of blueprint.edges.values()) {
      const flow = contract.edgeFlows.get(edge.id) ?? 0n
      flows.set(edge.sourcePortId, (flows.get(edge.sourcePortId) ?? 0n) + flow)
      flows.set(edge.targetPortId, (flows.get(edge.targetPortId) ?? 0n) + flow)
    }
    return flows
  }, [blueprint, contract])
  const projectedNodes = useMemo<FactoryFlowNode[]>(() => [...blueprint.nodes.values()].map((node) => {
    const diagnostic = diagnosticOverlay.nodeDiagnostics.get(node.id)
    const portResources = new Map(node.ports.flatMap((port) => {
      const resource = effectivePortResource(blueprint, node.id, port.id)
      return resource === undefined ? [] : [[port.id, resource] as const]
    }))
    return { id: node.id, type: 'factory', position: { x: gridToPixel(node.position.x), y: gridToPixel(node.position.y) }, data: { node, portResources, ...(portFlows !== undefined ? { portFlows } : {}), activity: Number(contract?.machineActivity.get(node.id) ?? 0n) / 10_000, ...(diagnostic !== undefined ? { diagnostic: diagnosticText(diagnostic), issueSeverity: diagnostic.severity } : {}) }, draggable: true }
  }), [blueprint, contract, diagnosticOverlay, portFlows])
  const projectedEdges = useMemo<Edge[]>(() => [...blueprint.edges.values()].map((edge) => {
    const flow = contract?.edgeFlows.get(edge.id) ?? 0n; const ratio = edge.capacity === 0n ? 0 : Number((flow * 100n) / edge.capacity)
    const resourceColour = resourceById.get(edge.resourceId)?.colour ?? '#8ba39a'
    const diagnostic = diagnosticOverlay.edgeDiagnostics.get(edge.id)
    const blocked = diagnosticOverlay.blockedEdges.has(edge.id)
    const colour = diagnostic?.severity === 'error' ? '#ff746d' : diagnostic?.severity === 'warning' ? '#efb15f' : blocked ? '#927052' : resourceColour
    const rateLabel = formatPortRate(flow, edge.capacity)
    const label = !diagnosticsVisible ? undefined : diagnostic !== undefined ? `${diagnostic.severity === 'error' ? 'Problem' : 'Limited'} · ${rateLabel}` : blocked ? `Blocked · ${rateLabel}` : rateLabel
    return {
      id: edge.id, type: 'straight', source: edge.sourceNodeId, sourceHandle: edge.sourcePortId, target: edge.targetNodeId, targetHandle: edge.targetPortId,
      label,
      animated: flow > 0n && diagnostic === undefined && !blocked,
      ...(diagnostic !== undefined ? { className: `diagnostic-edge diagnostic-edge--${diagnostic.severity}` } : blocked ? { className: 'diagnostic-edge diagnostic-edge--blocked' } : {}),
      style: { stroke: colour, strokeWidth: diagnostic !== undefined ? 5 : 2 + Math.min(5, ratio / 25), opacity: diagnostic !== undefined ? 1 : blocked ? 0.55 : flow === 0n ? 0.35 : 1, strokeDasharray: blocked ? '8 7' : undefined, filter: diagnostic !== undefined ? `drop-shadow(0 0 5px ${colour})` : undefined },
      labelStyle: { fill: diagnostic !== undefined ? '#ffe5e1' : blocked ? '#e5c5a4' : '#dce9e3', fontSize: 10, fontWeight: diagnostic !== undefined ? 700 : 500 },
      labelShowBg: true, labelBgPadding: [6, 4], labelBgBorderRadius: 4,
      labelBgStyle: { fill: diagnostic !== undefined ? '#351613' : blocked ? '#251b14' : '#08110e', fillOpacity: 0.96, stroke: diagnostic !== undefined ? colour : '#294238', strokeWidth: 1 },
      markerEnd: { type: MarkerType.ArrowClosed, color: colour }, zIndex: diagnostic !== undefined ? 10 : blocked ? 0 : 1,
    }
  }), [blueprint.edges, contract, diagnosticOverlay, diagnosticsVisible])
  const [nodes, setNodes] = useState(projectedNodes); const [edges, setEdges] = useState(projectedEdges)
  const [nodeProjection, setNodeProjection] = useState(projectedNodes); const [edgeProjection, setEdgeProjection] = useState(projectedEdges)
  const [connectionError, setConnectionError] = useState<string>()
  if (nodeProjection !== projectedNodes) { setNodeProjection(projectedNodes); setNodes(projectedNodes) }
  if (edgeProjection !== projectedEdges) { setEdgeProjection(projectedEdges); setEdges(projectedEdges) }
  const onNodesChange = useCallback((changes: NodeChange<FactoryFlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current))
    const removed = changes.filter((change) => change.type === 'remove')
    if (removed.length > 0) onCommand(transaction('Delete nodes', removed.map((change) => removeNode(asId<NodeId>(change.id)))))
    for (const change of changes) if (change.type === 'position' && change.dragging === false && change.position !== undefined) onCommand(moveNode(asId<NodeId>(change.id), gridPoint(pixelToGrid(change.position.x), pixelToGrid(change.position.y))))
  }, [onCommand])
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current))
    const removed = changes.filter((change) => change.type === 'remove')
    if (removed.length > 0) onCommand(transaction('Delete routes', removed.map((change) => disconnectEdge(asId<EdgeId>(change.id)))))
  }, [onCommand])
  const onConnect = useCallback((connection: Connection) => {
    if (connection.sourceHandle === null || connection.targetHandle === null) { setConnectionError('Choose a typed source and destination port.'); return }
    const sourceNode = blueprint.nodes.get(asId<NodeId>(connection.source)); const targetNode = blueprint.nodes.get(asId<NodeId>(connection.target))
    const sourcePort = sourceNode?.ports.find((port) => port.id === connection.sourceHandle); const targetPort = targetNode?.ports.find((port) => port.id === connection.targetHandle)
    if (sourceNode === undefined || targetNode === undefined || sourcePort === undefined || targetPort === undefined) { setConnectionError('Connection rejected: ports must carry the same resource.'); return }
    const sourceResource = effectivePortResource(blueprint, sourceNode.id, sourcePort.id)
    const targetResource = effectivePortResource(blueprint, targetNode.id, targetPort.id)
    if (sourceResource !== undefined && targetResource !== undefined && sourceResource !== targetResource) { setConnectionError('Connection rejected: ports must carry the same resource.'); return }
    const resourceId = sourceResource ?? targetResource
    if (resourceId === undefined) { setConnectionError('Connect at least one junction to a typed resource first.'); return }
    const id = asId<EdgeId>(`edge-${crypto.randomUUID()}`)
    const edge: BlueprintEdge = { id, sourceNodeId: sourceNode.id, sourcePortId: asId<PortId>(connection.sourceHandle), targetNodeId: targetNode.id, targetPortId: asId<PortId>(connection.targetHandle), resourceId, capacity: sourcePort.capacity < targetPort.capacity ? sourcePort.capacity : targetPort.capacity, points: [gridPoint(sourceNode.position.x + sourcePort.anchor.x, sourceNode.position.y + sourcePort.anchor.y), gridPoint(targetNode.position.x + targetPort.anchor.x, targetNode.position.y + targetPort.anchor.y)] }
    setConnectionError(undefined); onCommand(connectPorts(edge))
  }, [blueprint, onCommand])
  const selection = useCallback(({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => onSelection({ nodeIds: selectedNodes.map((node) => asId<NodeId>(node.id)), edgeIds: selectedEdges.map((edge) => asId<EdgeId>(edge.id)) }), [onSelection])
  const firstError = diagnosticsVisible ? diagnostics.find((diagnostic) => diagnostic.severity === 'error') : undefined
  const problemRouteCount = [...diagnosticOverlay.edgeDiagnostics.values()].filter((diagnostic) => diagnostic.severity === 'error').length
  return <div className="graph-canvas" aria-label="Factory graph editor">
    {connectionError !== undefined && <div className="connection-error" role="alert">{connectionError}<button aria-label="Dismiss connection error" onClick={() => setConnectionError(undefined)}>×</button></div>}
    {firstError !== undefined && <div className="graph-diagnostic-summary" role="alert"><strong>Compilation blocked</strong><span>{diagnosticText(firstError)}</span>{problemRouteCount > 0 && <small>{problemRouteCount} problem {problemRouteCount === 1 ? 'route is' : 'routes are'} highlighted</small>}</div>}
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onSelectionChange={selection} fitView snapToGrid snapGrid={[GRID_SIZE, GRID_SIZE]} deleteKeyCode={['Backspace', 'Delete']} minZoom={0.25} maxZoom={1.7}>
      <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE} size={1.4} color="rgba(130, 184, 160, .22)" />
      <MiniMap pannable zoomable nodeColor={(node) => (node.data as FactoryFlowNode['data']).node.kind === 'machine' ? '#d1844f' : '#4c9478'} maskColor="rgba(4, 12, 10, .72)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  </div>
}
