import { Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, type EdgeChange, type NodeChange, type OnSelectionChangeParams, type ReactFlowInstance, type Viewport, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { asId, gridPoint, resourceById } from '../domain'
import type { EdgeId, GridPoint, LooseConnectionId, NodeId, PortId, RateRaw, RouteHandleId } from '../domain'
import type { CompileDiagnostic, FactoryContract } from '../compiler'
import { diagnosticText } from '../compiler'
import type { FactoryBlueprint, LooseConnection, PortReference, RouteHandle } from '../editor'
import { addBridgeAt, addLooseConnection, completeLooseConnection, connectPorts, disconnectEdge, edgeRoute, effectivePortResource, extendLooseConnection, insertRouteHandle, isPortOccupied, looseConnectionRoute, materializeHandleRoute, moveLooseHandle, moveNode, moveRouteHandle, nearestRouteSpan, portRouteAxis, removeLooseHandle, removeNode, removeRouteHandle, routeBridgeMarkers, routeCapacity, routeResource, routeSections, transaction } from '../editor'
import type { EditCommand, RouteAxis } from '../editor'
import { FactoryNodeView, type FactoryFlowNode } from './FactoryNode'
import { buildDiagnosticOverlay } from './diagnostic-overlay'
import { GRID_SIZE, gridToPixel, pixelToGrid } from './grid-projection'
import { ConveyorEdgeView, type ConveyorFlowEdge } from './ConveyorEdge'

const nodeTypes = { factory: FactoryNodeView }; const edgeTypes = { conveyor: ConveyorEdgeView }
interface HandleSelection { readonly edgeId?: EdgeId; readonly looseId?: LooseConnectionId; readonly handleId: RouteHandleId }
export interface GraphSelection { readonly nodeIds: readonly NodeId[]; readonly edgeIds: readonly EdgeId[]; readonly handle?: HandleSelection }
interface PortDrag { readonly kind: 'new'; readonly origin: PortReference; readonly start: GridPoint; readonly axis: RouteAxis }
interface LooseDrag { readonly kind: 'extend'; readonly looseId: LooseConnectionId; readonly start: GridPoint; readonly axis: RouteAxis }
type ConnectionDrag = PortDrag | LooseDrag
interface HandleDrag extends HandleSelection { readonly start: GridPoint }
interface BridgeMenu { readonly edgeId: EdgeId; readonly position: GridPoint }
interface Props { readonly blueprint: FactoryBlueprint; readonly contract: FactoryContract | undefined; readonly childContracts: ReadonlyMap<string, FactoryContract>; readonly diagnostics: readonly CompileDiagnostic[]; readonly diagnosticsVisible: boolean; readonly onCommand: (command: EditCommand) => void; readonly onSelection: (selection: GraphSelection) => void }
const samePoint = (a: GridPoint, b: GridPoint): boolean => a.x === b.x && a.y === b.y
const axisOfLastSegment = (points: readonly GridPoint[], fallback: RouteAxis): RouteAxis => { const end = points.at(-1); const before = points.at(-2); return end === undefined || before === undefined ? fallback : end.y === before.y ? 'horizontal' : 'vertical' }

export const FactoryGraphEditor = ({ blueprint, contract, childContracts, diagnostics, diagnosticsVisible, onCommand, onSelection }: Props) => {
  const flow = useRef<ReactFlowInstance<FactoryFlowNode, ConveyorFlowEdge> | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 }); const [connectionDrag, setConnectionDrag] = useState<ConnectionDrag>(); const [handleDrag, setHandleDrag] = useState<HandleDrag>(); const [pointer, setPointer] = useState<GridPoint>(); const [selectedHandle, setSelectedHandle] = useState<HandleSelection>(); const [bridgeMenu, setBridgeMenu] = useState<BridgeMenu>(); const [connectionError, setConnectionError] = useState<string>()
  const diagnosticOverlay = useMemo(() => buildDiagnosticOverlay(blueprint, diagnosticsVisible ? diagnostics : []), [blueprint, diagnostics, diagnosticsVisible])
  const portFlows = useMemo(() => {
    if (contract === undefined) return undefined
    const flows = new Map<PortId, RateRaw>(); for (const edge of blueprint.edges.values()) { const flowRate = contract.edgeFlows.get(edge.id) ?? 0n; flows.set(edge.sourcePortId, flowRate); flows.set(edge.targetPortId, flowRate) }
    return flows
  }, [blueprint, contract])
  const pointFromEvent = useCallback((event: { readonly clientX: number; readonly clientY: number }): GridPoint | undefined => { const instance = flow.current; if (instance === null) return undefined; const position = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }); return gridPoint(pixelToGrid(position.x), pixelToGrid(position.y)) }, [])
  const portAtPointer = (event: { readonly clientX: number; readonly clientY: number }): PortReference | undefined => {
    const instance = flow.current; if (instance === null) return undefined
    const position = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }); const threshold = 14 / viewport.zoom
    return [...blueprint.nodes.values()].flatMap((node) => node.ports.map((port) => ({ reference: { nodeId: node.id, portId: port.id }, distance: Math.hypot(position.x - gridToPixel(node.position.x + port.anchor.x), position.y - gridToPixel(node.position.y + port.anchor.y)) }))).filter((candidate) => candidate.distance <= threshold).sort((a, b) => a.distance - b.distance)[0]?.reference
  }
  const dragOrigin = (drag: ConnectionDrag): PortReference | undefined => drag.kind === 'new' ? drag.origin : blueprint.looseConnections.get(drag.looseId)?.origin
  const validateTarget = (drag: ConnectionDrag, target: PortReference): string | undefined => {
    const origin = dragOrigin(drag); const originPort = origin === undefined ? undefined : blueprint.nodes.get(origin.nodeId)?.ports.find((port) => port.id === origin.portId); const targetPort = blueprint.nodes.get(target.nodeId)?.ports.find((port) => port.id === target.portId)
    if (origin === undefined || originPort === undefined || targetPort === undefined || origin.nodeId === target.nodeId && origin.portId === target.portId) return 'Choose another machine port.'
    if (originPort.direction === targetPort.direction) return 'A connection must join an output to an input.'
    if (isPortOccupied(blueprint, target.portId, drag.kind === 'extend' ? drag.looseId : undefined)) return 'This connector already carries a route.'
    const originResource = effectivePortResource(blueprint, origin.nodeId, origin.portId); const targetResource = effectivePortResource(blueprint, target.nodeId, target.portId)
    return originResource !== undefined && targetResource !== undefined && originResource !== targetResource ? 'Connection rejected: junction components carry different resources.' : undefined
  }
  const beginPortDrag = useCallback((nodeId: NodeId, portId: PortId) => {
    const node = blueprint.nodes.get(nodeId); const port = node?.ports.find((candidate) => candidate.id === portId); if (node === undefined || port === undefined) return
    if (isPortOccupied(blueprint, portId)) { setConnectionError('This connector already carries a route.'); return }
    const start = gridPoint(node.position.x + port.anchor.x, node.position.y + port.anchor.y); setConnectionDrag({ kind: 'new', origin: { nodeId, portId }, start, axis: portRouteAxis(blueprint, { nodeId, portId }) }); setPointer(start); setConnectionError(undefined)
  }, [blueprint])
  const handlePosition = handleDrag === undefined ? undefined : pointer ?? handleDrag.start
  const displayBlueprint = useMemo(() => {
    if (handleDrag?.edgeId === undefined || handlePosition === undefined) return blueprint
    const edge = blueprint.edges.get(handleDrag.edgeId); if (edge === undefined) return blueprint
    const routeHandles = edge.routeHandles.map((handle) => handle.id === handleDrag.handleId ? { ...handle, position: handlePosition } : handle)
    return { ...blueprint, edges: new Map(blueprint.edges).set(edge.id, { ...edge, routeHandles }) }
  }, [blueprint, handleDrag, handlePosition])
  const projectedNodes = useMemo<FactoryFlowNode[]>(() => [...blueprint.nodes.values()].map((node) => {
    const diagnostic = diagnosticOverlay.nodeDiagnostics.get(node.id); const portResources = new Map(node.ports.flatMap((port) => { const resource = effectivePortResource(blueprint, node.id, port.id); return resource === undefined ? [] : [[port.id, resource] as const] }))
    const childContract = node.kind === 'sub-factory' ? childContracts.get(node.contractId) : undefined
    return { id: node.id, type: 'factory', position: { x: gridToPixel(node.position.x), y: gridToPixel(node.position.y) }, data: { node, portResources, onPortPointerDown: beginPortDrag, ...(childContract === undefined ? {} : { childContract }), ...(portFlows !== undefined ? { portFlows } : {}), activity: Number(contract?.machineActivity.get(node.id) ?? 0n) / 10_000, ...(diagnostic !== undefined ? { diagnostic: diagnosticText(diagnostic), issueSeverity: diagnostic.severity } : {}) }, draggable: true }
  }), [beginPortDrag, blueprint, childContracts, contract, diagnosticOverlay, portFlows])
  const projectedEdges = useMemo<ConveyorFlowEdge[]>(() => [...displayBlueprint.edges.values()].map((edge) => {
    const flowRate = contract?.edgeFlows.get(edge.id) ?? 0n; const capacity = routeCapacity(displayBlueprint, edge); const ratio = capacity === 0n ? 0 : Number((flowRate * 100n) / capacity); const resource = routeResource(displayBlueprint, edge)
    const diagnostic = diagnosticOverlay.edgeDiagnostics.get(edge.id); const blocked = diagnosticOverlay.blockedEdges.has(edge.id); const resourceColour = resource === undefined ? '#8ba39a' : resourceById.get(resource)?.colour ?? '#8ba39a'; const colour = diagnostic?.severity === 'error' ? '#ff746d' : diagnostic?.severity === 'warning' ? '#efb15f' : blocked ? '#927052' : resourceColour
    const sections = routeSections(displayBlueprint, edge).map((section) => ({ layerId: section.layerId, points: section.points.map((point) => ({ x: gridToPixel(point.x), y: gridToPixel(point.y) })) })); const transitions = routeBridgeMarkers(displayBlueprint, edge).map((point) => ({ x: gridToPixel(point.x), y: gridToPixel(point.y) }))
    return { id: edge.id, type: 'conveyor', source: edge.sourceNodeId, sourceHandle: edge.sourcePortId, target: edge.targetNodeId, targetHandle: edge.targetPortId, data: { sections, transitions, width: diagnostic !== undefined ? 5 : 2 + Math.min(5, ratio / 25), invalid: diagnostic?.severity === 'error' || blocked, saturated: ratio >= 95 }, animated: flowRate > 0n && diagnostic === undefined && !blocked, style: { stroke: colour, opacity: diagnostic !== undefined ? 1 : blocked ? .55 : flowRate === 0n ? .35 : 1, ...(blocked ? { strokeDasharray: '8 7' } : {}) }, markerEnd: { type: MarkerType.ArrowClosed, color: colour }, zIndex: diagnostic !== undefined ? 10 : 1, ...(diagnostic !== undefined ? { className: `diagnostic-edge diagnostic-edge--${diagnostic.severity}` } : blocked ? { className: 'diagnostic-edge diagnostic-edge--blocked' } : {}) }
  }), [contract, diagnosticOverlay, displayBlueprint])
  const [nodes, setNodes] = useState(projectedNodes); const [edges, setEdges] = useState(projectedEdges); const [nodeProjection, setNodeProjection] = useState(projectedNodes); const [edgeProjection, setEdgeProjection] = useState(projectedEdges)
  if (nodeProjection !== projectedNodes) { setNodeProjection(projectedNodes); setNodes(projectedNodes) }
  if (edgeProjection !== projectedEdges) { setEdgeProjection(projectedEdges); setEdges(projectedEdges) }
  const onNodesChange = useCallback((changes: NodeChange<FactoryFlowNode>[]) => { setNodes((current) => applyNodeChanges(changes, current)); const removed = changes.filter((change) => change.type === 'remove'); if (removed.length > 0) onCommand(transaction('Delete nodes', removed.map((change) => removeNode(asId<NodeId>(change.id))))); for (const change of changes) if (change.type === 'position' && change.dragging === false && change.position !== undefined) onCommand(moveNode(asId<NodeId>(change.id), gridPoint(pixelToGrid(change.position.x), pixelToGrid(change.position.y)))) }, [onCommand])
  const onEdgesChange = useCallback((changes: EdgeChange<ConveyorFlowEdge>[]) => { setEdges((current) => applyEdgeChanges(changes, current)); const removed = changes.filter((change) => change.type === 'remove'); if (removed.length > 0) onCommand(transaction('Delete routes', removed.map((change) => disconnectEdge(asId<EdgeId>(change.id))))) }, [onCommand])
  const selection = useCallback(({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => { setSelectedHandle(undefined); onSelection({ nodeIds: selectedNodes.map((node) => asId<NodeId>(node.id)), edgeIds: selectedEdges.map((edge) => asId<EdgeId>(edge.id)) }) }, [onSelection])
  const commitConnectionDrop = (event: React.PointerEvent<HTMLDivElement>) => {
    if (connectionDrag === undefined) return
    const drop = pointFromEvent(event); const target = portAtPointer(event)
    if (target !== undefined) {
      const error = validateTarget(connectionDrag, target)
      if (error !== undefined) setConnectionError(error)
      else {
        const edgeId = asId<EdgeId>(`edge-${crypto.randomUUID()}`)
        if (connectionDrag.kind === 'extend') onCommand(completeLooseConnection(connectionDrag.looseId, target.nodeId, target.portId, edgeId))
        else {
          const originPort = blueprint.nodes.get(connectionDrag.origin.nodeId)?.ports.find((port) => port.id === connectionDrag.origin.portId); const targetPort = blueprint.nodes.get(target.nodeId)?.ports.find((port) => port.id === target.portId)
          if (originPort === undefined || targetPort === undefined) setConnectionError('Choose another machine port.')
          else { const forward = originPort.direction === 'output'; const source = forward ? connectionDrag.origin : target; const destination = forward ? target : connectionDrag.origin; onCommand(connectPorts({ id: edgeId, sourceNodeId: source.nodeId, sourcePortId: source.portId, targetNodeId: destination.nodeId, targetPortId: destination.portId, routeHandles: [], bridges: [] })); setConnectionError(undefined) }
        }
      }
    } else if (drop !== undefined && !samePoint(drop, connectionDrag.start)) {
      const handle: RouteHandle = { id: asId<RouteHandleId>(`handle-${crypto.randomUUID()}`), position: drop }
      if (connectionDrag.kind === 'new') onCommand(addLooseConnection({ id: asId<LooseConnectionId>(`loose-${crypto.randomUUID()}`), origin: connectionDrag.origin, routeHandles: [handle] })); else onCommand(extendLooseConnection(connectionDrag.looseId, handle))
    }
    setConnectionDrag(undefined); setPointer(undefined)
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setBridgeMenu(undefined); if (connectionDrag !== undefined) { event.preventDefault(); setConnectionDrag(undefined); setPointer(undefined); return } }
      if ((event.key !== 'Delete' && event.key !== 'Backspace') || selectedHandle === undefined) return
      event.preventDefault(); event.stopImmediatePropagation(); if (selectedHandle.edgeId !== undefined) onCommand(removeRouteHandle(selectedHandle.edgeId, selectedHandle.handleId)); else if (selectedHandle.looseId !== undefined) onCommand(removeLooseHandle(selectedHandle.looseId, selectedHandle.handleId)); setSelectedHandle(undefined); onSelection({ nodeIds: [], edgeIds: [] })
    }
    window.addEventListener('keydown', onKeyDown, true); return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [connectionDrag, onCommand, onSelection, selectedHandle])
  const screenPoint = (point: GridPoint) => ({ x: gridToPixel(point.x) * viewport.zoom + viewport.x, y: gridToPixel(point.y) * viewport.zoom + viewport.y })
  const preview = connectionDrag === undefined || pointer === undefined ? undefined : materializeHandleRoute(connectionDrag.start, [{ id: asId<RouteHandleId>('preview'), position: pointer }], connectionDrag.axis)
  const looseRoutes = [...blueprint.looseConnections.values()].map((loose) => {
    if (handleDrag?.looseId !== loose.id || handlePosition === undefined) return { loose, route: looseConnectionRoute(blueprint, loose) }
    const routeHandles = loose.routeHandles.map((handle) => handle.id === handleDrag.handleId ? { ...handle, position: handlePosition } : handle); const projected = { ...loose, routeHandles }; return { loose: projected, route: looseConnectionRoute(blueprint, projected) }
  })
  const beginHandleMove = (event: React.PointerEvent<HTMLButtonElement>, value: HandleSelection, position: GridPoint) => { event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setSelectedHandle(value); setHandleDrag({ ...value, start: position }); setPointer(position); onSelection({ nodeIds: [], edgeIds: value.edgeId === undefined ? [] : [value.edgeId], handle: value }) }
  const deleteHandle = (event: React.MouseEvent<HTMLButtonElement>, value: HandleSelection) => { event.preventDefault(); event.stopPropagation(); setHandleDrag(undefined); setPointer(undefined); setSelectedHandle(undefined); if (value.edgeId !== undefined) onCommand(removeRouteHandle(value.edgeId, value.handleId)); else if (value.looseId !== undefined) onCommand(removeLooseHandle(value.looseId, value.handleId)); onSelection({ nodeIds: [], edgeIds: value.edgeId === undefined ? [] : [value.edgeId] }) }
  const beginLooseExtension = (event: React.PointerEvent<HTMLButtonElement>, loose: LooseConnection) => { event.preventDefault(); event.stopPropagation(); const route = looseConnectionRoute(blueprint, loose); const start = route.points.at(-1); if (start === undefined) return; setConnectionDrag({ kind: 'extend', looseId: loose.id, start, axis: axisOfLastSegment(route.points, portRouteAxis(blueprint, loose.origin)) }); setPointer(start); setConnectionError(undefined) }
  const firstError = diagnosticsVisible ? diagnostics.find((diagnostic) => diagnostic.severity === 'error') : undefined

  return <div className="graph-canvas" aria-label="Factory graph editor" onPointerMoveCapture={(event) => { const next = pointFromEvent(event); if (next !== undefined && (connectionDrag !== undefined || handleDrag !== undefined)) setPointer(next) }} onPointerUpCapture={(event) => {
    if (handleDrag !== undefined) { const next = pointFromEvent(event) ?? handleDrag.start; if (!samePoint(next, handleDrag.start)) { if (handleDrag.edgeId !== undefined) onCommand(moveRouteHandle(handleDrag.edgeId, handleDrag.handleId, next)); else if (handleDrag.looseId !== undefined) onCommand(moveLooseHandle(handleDrag.looseId, handleDrag.handleId, next)) } setHandleDrag(undefined); setPointer(undefined); return }
    commitConnectionDrop(event)
  }} onPointerCancelCapture={() => { setConnectionDrag(undefined); setHandleDrag(undefined); setPointer(undefined) }}>
    {connectionError !== undefined && <div className="connection-error" role="alert">{connectionError}<button aria-label="Dismiss connection error" onClick={() => setConnectionError(undefined)}>×</button></div>}
    {firstError !== undefined && <div className="graph-diagnostic-summary" role="alert"><strong>Compilation blocked</strong><span>{diagnosticText(firstError)}</span></div>}
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={(instance) => { flow.current = instance; setViewport(instance.getViewport()) }} onMove={(_, nextViewport) => setViewport(nextViewport)} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onSelectionChange={selection} fitView snapToGrid snapGrid={[GRID_SIZE, GRID_SIZE]} deleteKeyCode={['Backspace', 'Delete']} minZoom={.25} maxZoom={1.7} nodesDraggable nodesConnectable={false} elementsSelectable>
      <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE} size={1.4} color="rgba(130, 184, 160, .22)" /><MiniMap pannable zoomable nodeColor={(node) => (node.data as FactoryFlowNode['data']).node.kind === 'machine' ? '#d1844f' : '#4c9478'} maskColor="rgba(4, 12, 10, .72)" /><Controls showInteractive={false} />
    </ReactFlow>
    <div className="route-overlay" aria-label="Route handles">
      <svg aria-hidden="true">{looseRoutes.map(({ loose, route }) => <polyline className="loose-route" key={loose.id} points={route.points.map((point) => `${screenPoint(point).x},${screenPoint(point).y}`).join(' ')} />)}{preview !== undefined && <polyline className="route-preview" points={preview.points.map((point) => `${screenPoint(point).x},${screenPoint(point).y}`).join(' ')} />}</svg>
      {[...blueprint.edges.values()].flatMap((edge) => edgeRoute(blueprint, edge).points.slice(1).map((end, index) => ({ edge, start: edgeRoute(blueprint, edge).points[index]!, end, index }))).map(({ edge, start, end, index }) => {
        const a = screenPoint(start); const b = screenPoint(end); const horizontal = a.y === b.y; const length = Math.abs(horizontal ? b.x - a.x : b.y - a.y); if (length <= 16) return null
        const style = horizontal ? { left: Math.min(a.x, b.x) + 8, top: a.y - 9, width: length - 16, height: 18 } : { left: a.x - 9, top: Math.min(a.y, b.y) + 8, width: 18, height: length - 16 }
        return <button key={`hit-${edge.id}-${index}`} className="route-segment-hit" data-edge-id={edge.id} aria-label={`Route ${edge.id} segment ${index + 1}`} style={style} onClick={(event) => { event.stopPropagation(); setSelectedHandle(undefined); setBridgeMenu(undefined); onSelection({ nodeIds: [], edgeIds: [edge.id] }) }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); const position = pointFromEvent(event); if (position !== undefined) setBridgeMenu({ edgeId: edge.id, position }) }} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); const point = pointFromEvent(event); if (point === undefined) return; const handle = { id: asId<RouteHandleId>(`handle-${crypto.randomUUID()}`), position: point }; onCommand(insertRouteHandle(edge.id, nearestRouteSpan(edgeRoute(blueprint, edge), point), handle)); const next = { edgeId: edge.id, handleId: handle.id }; setSelectedHandle(next); onSelection({ nodeIds: [], edgeIds: [edge.id], handle: next }) }} />
      })}
      {[...blueprint.edges.values()].flatMap((edge) => edge.routeHandles.map((handle) => ({ edge, handle }))).map(({ edge, handle }) => { const position = handleDrag?.edgeId === edge.id && handleDrag.handleId === handle.id ? handlePosition ?? handle.position : handle.position; const value = { edgeId: edge.id, handleId: handle.id }; return <button key={handle.id} className={`route-connector${selectedHandle?.handleId === handle.id ? ' is-selected' : ''}`} aria-label="Route handle" title="Drag to move · double-click to delete" style={{ left: screenPoint(position).x, top: screenPoint(position).y }} onPointerDown={(event) => beginHandleMove(event, value, handle.position)} onDoubleClick={(event) => deleteHandle(event, value)} /> })}
      {looseRoutes.flatMap(({ loose }) => loose.routeHandles.map((handle, index) => ({ loose, handle, free: index === loose.routeHandles.length - 1 }))).map(({ loose, handle, free }) => { const position = handleDrag?.looseId === loose.id && handleDrag.handleId === handle.id ? handlePosition ?? handle.position : handle.position; const value = { looseId: loose.id, handleId: handle.id }; return <button key={handle.id} className={`route-connector${free ? ' is-free' : ''}${selectedHandle?.handleId === handle.id ? ' is-selected' : ''}`} aria-label={free ? 'Free route endpoint' : 'Route handle'} title={free ? 'Drag to extend' : 'Drag to move · double-click to delete'} style={{ left: screenPoint(position).x, top: screenPoint(position).y }} onPointerDown={(event) => free ? beginLooseExtension(event, loose) : beginHandleMove(event, value, handle.position)} {...(free ? {} : { onDoubleClick: (event: React.MouseEvent<HTMLButtonElement>) => deleteHandle(event, value) })} /> })}
      {bridgeMenu !== undefined && <div className="route-context-menu" style={{ left: screenPoint(bridgeMenu.position).x, top: screenPoint(bridgeMenu.position).y }}><button onClick={(event) => { event.stopPropagation(); onCommand(addBridgeAt(bridgeMenu.edgeId, bridgeMenu.position)); setBridgeMenu(undefined) }}>Add bridge here</button></div>}
      {preview !== undefined && <div className="route-drag-hint">Release on empty space to place a handle · release on a compatible connector to finish · Esc to cancel</div>}
    </div>
  </div>
}
