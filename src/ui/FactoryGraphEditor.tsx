import { Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, type Connection, type Edge, type EdgeChange, type NodeChange, type OnSelectionChangeParams, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useMemo, useState } from 'react'
import { asId, gridPoint, resourceById } from '../domain'
import type { EdgeId, NodeId, PortId } from '../domain'
import type { FactoryContract } from '../compiler'
import { diagnosticText } from '../compiler'
import type { BlueprintEdge, FactoryBlueprint } from '../editor'
import { connectPorts, disconnectEdge, moveNode, removeNode, transaction } from '../editor'
import type { EditCommand } from '../editor'
import { FactoryNodeView, type FactoryFlowNode } from './FactoryNode'
import { GRID_SIZE, gridToPixel, pixelToGrid } from './grid-projection'

const nodeTypes = { factory: FactoryNodeView }

export interface GraphSelection { readonly nodeIds: readonly NodeId[]; readonly edgeIds: readonly EdgeId[] }
interface Props { readonly blueprint: FactoryBlueprint; readonly contract: FactoryContract | undefined; readonly diagnosticsVisible: boolean; readonly onCommand: (command: EditCommand) => void; readonly onSelection: (selection: GraphSelection) => void }
export const FactoryGraphEditor = ({ blueprint, contract, diagnosticsVisible, onCommand, onSelection }: Props) => {
  const projectedNodes = useMemo<FactoryFlowNode[]>(() => [...blueprint.nodes.values()].map((node) => {
    const diagnostic = contract?.diagnostics.find((item) => item.entity.nodeId === node.id)
    return { id: node.id, type: 'factory', position: { x: gridToPixel(node.position.x), y: gridToPixel(node.position.y) }, data: { node, activity: Number(contract?.machineActivity.get(node.id) ?? 0n) / 10_000, ...(diagnosticsVisible && diagnostic !== undefined ? { diagnostic: diagnosticText(diagnostic) } : {}) }, draggable: true }
  }), [blueprint, contract, diagnosticsVisible])
  const projectedEdges = useMemo<Edge[]>(() => [...blueprint.edges.values()].map((edge) => {
    const flow = contract?.edgeFlows.get(edge.id) ?? 0n; const ratio = edge.capacity === 0n ? 0 : Number((flow * 100n) / edge.capacity)
    const colour = resourceById.get(edge.resourceId)?.colour ?? '#8ba39a'
    return { id: edge.id, type: 'straight', source: edge.sourceNodeId, sourceHandle: edge.sourcePortId, target: edge.targetNodeId, targetHandle: edge.targetPortId, label: diagnosticsVisible ? `${Number(flow) / 1_000_000}/${Number(edge.capacity) / 1_000_000}/s` : undefined, animated: flow > 0n, style: { stroke: colour, strokeWidth: 2 + Math.min(5, ratio / 25), opacity: flow === 0n ? 0.35 : 1 }, markerEnd: { type: MarkerType.ArrowClosed, color: colour } }
  }), [blueprint.edges, contract, diagnosticsVisible])
  const [nodes, setNodes] = useState(projectedNodes); const [edges, setEdges] = useState(projectedEdges)
  const [connectionError, setConnectionError] = useState<string>()
  if (nodes.length !== projectedNodes.length || nodes.some((node, index) => node.id !== projectedNodes[index]?.id || node.data.node.position !== projectedNodes[index]?.data.node.position)) setNodes(projectedNodes)
  if (edges.length !== projectedEdges.length || edges.some((edge, index) => edge.id !== projectedEdges[index]?.id || edge.label !== projectedEdges[index]?.label)) setEdges(projectedEdges)
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
    if (sourceNode === undefined || targetNode === undefined || sourcePort === undefined || targetPort === undefined || sourcePort.resourceId !== targetPort.resourceId) { setConnectionError('Connection rejected: ports must carry the same resource.'); return }
    const id = asId<EdgeId>(`edge-${crypto.randomUUID()}`)
    const edge: BlueprintEdge = { id, sourceNodeId: sourceNode.id, sourcePortId: asId<PortId>(connection.sourceHandle), targetNodeId: targetNode.id, targetPortId: asId<PortId>(connection.targetHandle), resourceId: sourcePort.resourceId, capacity: sourcePort.capacity < targetPort.capacity ? sourcePort.capacity : targetPort.capacity, points: [sourceNode.position, targetNode.position] }
    setConnectionError(undefined); onCommand(connectPorts(edge))
  }, [blueprint, onCommand])
  const selection = useCallback(({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => onSelection({ nodeIds: selectedNodes.map((node) => asId<NodeId>(node.id)), edgeIds: selectedEdges.map((edge) => asId<EdgeId>(edge.id)) }), [onSelection])
  return <div className="graph-canvas" aria-label="Factory graph editor">
    {connectionError !== undefined && <div className="connection-error" role="alert">{connectionError}<button aria-label="Dismiss connection error" onClick={() => setConnectionError(undefined)}>×</button></div>}
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onSelectionChange={selection} fitView snapToGrid snapGrid={[GRID_SIZE, GRID_SIZE]} deleteKeyCode={['Backspace', 'Delete']} minZoom={0.25} maxZoom={1.7}>
      <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE} size={1.4} color="rgba(130, 184, 160, .22)" />
      <MiniMap pannable zoomable nodeColor={(node) => (node.data as FactoryFlowNode['data']).node.kind === 'machine' ? '#d1844f' : '#4c9478'} maskColor="rgba(4, 12, 10, .72)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  </div>
}
