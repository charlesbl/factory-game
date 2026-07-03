import { Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, type EdgeChange, type NodeChange, type OnSelectionChangeParams, type ReactFlowInstance, type Viewport, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { asId, gridPoint, resourceById } from '../domain'
import type { EdgeId, GridPoint, LooseConnectionId, NodeId, PortId, RateRaw, ResourceId, RouteConnectorId } from '../domain'
import type { CompileDiagnostic, FactoryContract } from '../compiler'
import { diagnosticText } from '../compiler'
import type { BlueprintEdge, FactoryBlueprint, LooseConnection, PortReference, RouteConnector } from '../editor'
import { addBridgeAt, addLooseConnection, blueprintLooseConnections, blueprintTracks, blueprintTransitions, completeLooseConnection, connectPorts, disconnectEdge, edgeRoute, effectivePortResource, effectiveTrackPoints, extendLooseConnection, insertRouteConnector, legacyNetForEdge, looseConnectionRoute, materializeConnectorRoute, moveLooseConnector, moveNode, moveRouteConnector, nearestRouteSpan, portRouteAxis, removeLooseConnector, removeNode, removeRouteConnector, transaction } from '../editor'
import type { EditCommand, RouteAxis } from '../editor'
import { FactoryNodeView, type FactoryFlowNode } from './FactoryNode'
import { buildDiagnosticOverlay } from './diagnostic-overlay'
import { formatPortRate } from './factory-node-rates'
import { GRID_SIZE, gridToPixel, pixelToGrid } from './grid-projection'
import { ConveyorEdgeView, type ConveyorFlowEdge } from './ConveyorEdge'
import { layoutEdgeLabels, metricLabelAnchor } from './edge-label-layout'

const nodeTypes = { factory: FactoryNodeView }
const edgeTypes = { conveyor: ConveyorEdgeView }

interface ConnectorSelection { readonly edgeId?: EdgeId; readonly looseId?: LooseConnectionId; readonly connectorId: RouteConnectorId }
export interface GraphSelection { readonly nodeIds: readonly NodeId[]; readonly edgeIds: readonly EdgeId[]; readonly connector?: ConnectorSelection }
interface PortDrag { readonly kind: 'new'; readonly origin: PortReference; readonly resourceId: ResourceId; readonly capacity: RateRaw; readonly start: GridPoint; readonly axis: RouteAxis }
interface LooseDrag { readonly kind: 'extend'; readonly looseId: LooseConnectionId; readonly resourceId: ResourceId; readonly capacity: RateRaw; readonly start: GridPoint; readonly axis: RouteAxis }
type ConnectionDrag = PortDrag | LooseDrag
interface ConnectorDrag { readonly edgeId?: EdgeId; readonly looseId?: LooseConnectionId; readonly connectorId: RouteConnectorId; readonly start: GridPoint }
interface BridgeMenu { readonly edgeId: EdgeId; readonly position: GridPoint }
interface Props { readonly blueprint: FactoryBlueprint; readonly contract: FactoryContract | undefined; readonly diagnostics: readonly CompileDiagnostic[]; readonly diagnosticsVisible: boolean; readonly onCommand: (command: EditCommand) => void; readonly onSelection: (selection: GraphSelection) => void }

const samePoint = (a: GridPoint, b: GridPoint): boolean => a.x === b.x && a.y === b.y
const connectorsForEdge = (edge: BlueprintEdge): readonly RouteConnector[] => edge.routeConnectors ?? edge.points.slice(1, -1).map((position, index) => ({ id: asId<RouteConnectorId>(`${edge.id}:connector:${index}`), position }))
const axisOfLastSegment = (points: readonly GridPoint[], fallback: RouteAxis): RouteAxis => {
  const end = points.at(-1); const before = points.at(-2)
  if (end === undefined || before === undefined) return fallback
  return end.y === before.y ? 'horizontal' : 'vertical'
}

export const FactoryGraphEditor = ({ blueprint, contract, diagnostics, diagnosticsVisible, onCommand, onSelection }: Props) => {
  const flow = useRef<ReactFlowInstance<FactoryFlowNode, ConveyorFlowEdge> | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const [connectionDrag, setConnectionDrag] = useState<ConnectionDrag>()
  const [connectorDrag, setConnectorDrag] = useState<ConnectorDrag>()
  const [pointer, setPointer] = useState<GridPoint>()
  const [selectedConnector, setSelectedConnector] = useState<ConnectorSelection>()
  const [bridgeMenu, setBridgeMenu] = useState<BridgeMenu>()
  const [connectionError, setConnectionError] = useState<string>()

  const diagnosticOverlay = useMemo(() => buildDiagnosticOverlay(blueprint, diagnosticsVisible ? diagnostics : []), [blueprint, diagnostics, diagnosticsVisible])
  const portFlows = useMemo(() => {
    if (contract === undefined) return undefined
    const flows = new Map<PortId, RateRaw>()
    for (const edge of blueprint.edges.values()) {
      const flowRate = contract.edgeFlows.get(edge.id) ?? 0n
      flows.set(edge.sourcePortId, (flows.get(edge.sourcePortId) ?? 0n) + flowRate); flows.set(edge.targetPortId, (flows.get(edge.targetPortId) ?? 0n) + flowRate)
    }
    return flows
  }, [blueprint, contract])

  const pointFromEvent = useCallback((event: { readonly clientX: number; readonly clientY: number }): GridPoint | undefined => {
    const instance = flow.current; if (instance === null) return undefined
    const position = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    return gridPoint(pixelToGrid(position.x), pixelToGrid(position.y))
  }, [])
  const portAtPointer = (event: { readonly clientX: number; readonly clientY: number }): PortReference | undefined => {
    const instance = flow.current; if (instance === null) return undefined
    const position = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }); const threshold = 14 / viewport.zoom
    return [...blueprint.nodes.values()].flatMap((node) => node.ports.map((port) => ({ reference: { nodeId: node.id, portId: port.id }, distance: Math.hypot(position.x - gridToPixel(node.position.x + port.anchor.x), position.y - gridToPixel(node.position.y + port.anchor.y)) }))).filter((candidate) => candidate.distance <= threshold).sort((a, b) => a.distance - b.distance)[0]?.reference
  }
  const validateTarget = (drag: ConnectionDrag, target: PortReference): string | undefined => {
    const origin = drag.kind === 'new' ? drag.origin : blueprintLooseConnections(blueprint).get(drag.looseId)?.origin
    const originPort = origin === undefined ? undefined : blueprint.nodes.get(origin.nodeId)?.ports.find((port) => port.id === origin.portId)
    const targetPort = blueprint.nodes.get(target.nodeId)?.ports.find((port) => port.id === target.portId)
    if (origin === undefined || originPort === undefined || targetPort === undefined || origin.nodeId === target.nodeId && origin.portId === target.portId) return 'Choose another machine port.'
    if (originPort.direction === targetPort.direction) return 'A connection must join an output to an input.'
    const resource = effectivePortResource(blueprint, target.nodeId, target.portId)
    return resource !== undefined && resource !== drag.resourceId ? 'Connection rejected: ports must carry the same resource.' : undefined
  }

  const beginPortDrag = useCallback((nodeId: NodeId, portId: PortId) => {
    const node = blueprint.nodes.get(nodeId); const port = node?.ports.find((candidate) => candidate.id === portId); if (node === undefined || port === undefined) return
    const resourceId = effectivePortResource(blueprint, nodeId, portId)
    if (resourceId === undefined) { setConnectionError('Connect this junction to a typed resource first.'); return }
    const start = gridPoint(node.position.x + port.anchor.x, node.position.y + port.anchor.y)
    setConnectionDrag({ kind: 'new', origin: { nodeId, portId }, resourceId, capacity: port.capacity, start, axis: portRouteAxis(blueprint, { nodeId, portId }) }); setPointer(start); setConnectionError(undefined)
  }, [blueprint])

  const connectorPosition = connectorDrag === undefined ? undefined : pointer ?? connectorDrag.start
  const displayBlueprint = useMemo(() => {
    if (connectorDrag?.edgeId === undefined || connectorPosition === undefined) return blueprint
    const edge = blueprint.edges.get(connectorDrag.edgeId); if (edge === undefined) return blueprint
    const routeConnectors = connectorsForEdge(edge).map((connector) => connector.id === connectorDrag.connectorId ? { ...connector, position: connectorPosition } : connector)
    return { ...blueprint, edges: new Map(blueprint.edges).set(edge.id, { ...edge, routeConnectors }) }
  }, [blueprint, connectorDrag, connectorPosition])

  const projectedNodes = useMemo<FactoryFlowNode[]>(() => [...blueprint.nodes.values()].map((node) => {
    const diagnostic = diagnosticOverlay.nodeDiagnostics.get(node.id)
    const portResources = new Map(node.ports.flatMap((port) => { const resource = effectivePortResource(blueprint, node.id, port.id); return resource === undefined ? [] : [[port.id, resource] as const] }))
    return { id: node.id, type: 'factory', position: { x: gridToPixel(node.position.x), y: gridToPixel(node.position.y) }, data: { node, portResources, onPortPointerDown: beginPortDrag, ...(portFlows !== undefined ? { portFlows } : {}), activity: Number(contract?.machineActivity.get(node.id) ?? 0n) / 10_000, ...(diagnostic !== undefined ? { diagnostic: diagnosticText(diagnostic), issueSeverity: diagnostic.severity } : {}) }, draggable: true }
  }), [beginPortDrag, blueprint, contract, diagnosticOverlay, portFlows])

  const projectedEdges = useMemo<ConveyorFlowEdge[]>(() => {
    const drafts = [...displayBlueprint.edges.values()].map((edge) => {
    const flowRate = contract?.edgeFlows.get(edge.id) ?? 0n; const ratio = edge.capacity === 0n ? 0 : Number((flowRate * 100n) / edge.capacity)
    const resourceColour = resourceById.get(edge.resourceId)?.colour ?? '#8ba39a'; const diagnostic = diagnosticOverlay.edgeDiagnostics.get(edge.id); const blocked = diagnosticOverlay.blockedEdges.has(edge.id)
    const colour = diagnostic?.severity === 'error' ? '#ff746d' : diagnostic?.severity === 'warning' ? '#efb15f' : blocked ? '#927052' : resourceColour
    const rateLabel = formatPortRate(flowRate, edge.capacity); const label = !diagnosticsVisible ? undefined : diagnostic !== undefined ? `${diagnostic.severity === 'error' ? 'Problem' : 'Limited'} · ${rateLabel}` : blocked ? `Blocked · ${rateLabel}` : rateLabel
    const netId = legacyNetForEdge(edge).id; const tracks = [...blueprintTracks(displayBlueprint).values()].filter((track) => track.netIds.includes(netId)); const transitions = [...blueprintTransitions(displayBlueprint).values()].filter((transition) => transition.netIds.includes(netId))
    const routeSections = connectorDrag?.edgeId === edge.id || tracks.length === 0 ? [{ layerId: 'primary' as const, points: edgeRoute(displayBlueprint, edge).points }] : tracks.map((track) => ({ layerId: track.layerId, points: effectiveTrackPoints(displayBlueprint, track) }))
    const sections = routeSections.map((section) => ({ layerId: section.layerId, points: section.points.map((point) => ({ x: gridToPixel(point.x), y: gridToPixel(point.y) })) }))
    return { edge, flowRate, ratio, diagnostic, blocked, colour, label, sections, transitions: transitions.map((transition) => ({ x: gridToPixel(transition.position.x), y: gridToPixel(transition.position.y) })) }
    })
    const nodeObstacles = [...displayBlueprint.nodes.values()].map((node) => ({ x: gridToPixel(node.position.x + node.footprint.x) - 8, y: gridToPixel(node.position.y + node.footprint.y) - 8, width: gridToPixel(node.footprint.width) + 16, height: gridToPixel(node.footprint.height) + 16 }))
    const labelPositions = layoutEdgeLabels(drafts.flatMap((draft) => draft.label === undefined ? [] : [{ id: draft.edge.id, text: draft.label, sections: draft.sections }]), nodeObstacles)
    return drafts.map(({ edge, flowRate, ratio, diagnostic, blocked, colour, label, sections, transitions }): ConveyorFlowEdge => { const labelPosition = labelPositions.get(edge.id); return ({ id: edge.id, type: 'conveyor', source: edge.sourceNodeId, sourceHandle: edge.sourcePortId, target: edge.targetNodeId, targetHandle: edge.targetPortId,
      data: { sections, transitions, ...(label === undefined ? {} : labelPosition === undefined ? { label } : { label, labelPosition }), width: diagnostic !== undefined ? 5 : 2 + Math.min(5, ratio / 25), invalid: diagnostic?.severity === 'error' || blocked, saturated: ratio >= 95 },
      animated: flowRate > 0n && diagnostic === undefined && !blocked, style: { stroke: colour, opacity: diagnostic !== undefined ? 1 : blocked ? .55 : flowRate === 0n ? .35 : 1, ...(blocked ? { strokeDasharray: '8 7' } : {}) }, markerEnd: { type: MarkerType.ArrowClosed, color: colour }, zIndex: diagnostic !== undefined ? 10 : 1,
      ...(diagnostic !== undefined ? { className: `diagnostic-edge diagnostic-edge--${diagnostic.severity}` } : blocked ? { className: 'diagnostic-edge diagnostic-edge--blocked' } : {}),
    }) })
  }, [connectorDrag?.edgeId, contract, diagnosticOverlay, diagnosticsVisible, displayBlueprint])
  const [nodes, setNodes] = useState(projectedNodes); const [edges, setEdges] = useState(projectedEdges)
  const [nodeProjection, setNodeProjection] = useState(projectedNodes); const [edgeProjection, setEdgeProjection] = useState(projectedEdges)
  if (nodeProjection !== projectedNodes) { setNodeProjection(projectedNodes); setNodes(projectedNodes) }
  if (edgeProjection !== projectedEdges) { setEdgeProjection(projectedEdges); setEdges(projectedEdges) }

  const onNodesChange = useCallback((changes: NodeChange<FactoryFlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current)); const removed = changes.filter((change) => change.type === 'remove')
    if (removed.length > 0) onCommand(transaction('Delete nodes', removed.map((change) => removeNode(asId<NodeId>(change.id)))))
    for (const change of changes) if (change.type === 'position' && change.dragging === false && change.position !== undefined) onCommand(moveNode(asId<NodeId>(change.id), gridPoint(pixelToGrid(change.position.x), pixelToGrid(change.position.y))))
  }, [onCommand])
  const onEdgesChange = useCallback((changes: EdgeChange<ConveyorFlowEdge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current)); const removed = changes.filter((change) => change.type === 'remove')
    if (removed.length > 0) onCommand(transaction('Delete routes', removed.map((change) => disconnectEdge(asId<EdgeId>(change.id)))))
  }, [onCommand])
  const selection = useCallback(({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => {
    const next = { nodeIds: selectedNodes.map((node) => asId<NodeId>(node.id)), edgeIds: selectedEdges.map((edge) => asId<EdgeId>(edge.id)) }; setSelectedConnector(undefined); onSelection(next)
  }, [onSelection])

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
          else {
            const forward = originPort.direction === 'output'; const source = forward ? connectionDrag.origin : target; const destination = forward ? target : connectionDrag.origin; const capacity = connectionDrag.capacity < targetPort.capacity ? connectionDrag.capacity : targetPort.capacity
            const edge: BlueprintEdge = { id: edgeId, sourceNodeId: source.nodeId, sourcePortId: source.portId, targetNodeId: destination.nodeId, targetPortId: destination.portId, resourceId: connectionDrag.resourceId, capacity, points: [], routeConnectors: [] }
            onCommand(connectPorts(edge)); setConnectionError(undefined)
          }
        }
        if (connectionDrag.kind === 'extend') setConnectionError(undefined)
      }
    } else if (drop !== undefined && !samePoint(drop, connectionDrag.start)) {
      const connector: RouteConnector = { id: asId<RouteConnectorId>(`connector-${crypto.randomUUID()}`), position: drop }
      if (connectionDrag.kind === 'new') onCommand(addLooseConnection({ id: asId<LooseConnectionId>(`loose-${crypto.randomUUID()}`), origin: connectionDrag.origin, resourceId: connectionDrag.resourceId, capacity: connectionDrag.capacity, routeConnectors: [connector] }))
      else onCommand(extendLooseConnection(connectionDrag.looseId, connector))
    }
    setConnectionDrag(undefined); setPointer(undefined)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setBridgeMenu(undefined); if (connectionDrag !== undefined) { event.preventDefault(); setConnectionDrag(undefined); setPointer(undefined); return } }
      if ((event.key !== 'Delete' && event.key !== 'Backspace') || selectedConnector === undefined) return
      event.preventDefault(); event.stopImmediatePropagation()
      if (selectedConnector.edgeId !== undefined) onCommand(removeRouteConnector(selectedConnector.edgeId, selectedConnector.connectorId))
      else if (selectedConnector.looseId !== undefined) onCommand(removeLooseConnector(selectedConnector.looseId, selectedConnector.connectorId))
      setSelectedConnector(undefined); onSelection({ nodeIds: [], edgeIds: [] })
    }
    window.addEventListener('keydown', onKeyDown, true); return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [connectionDrag, onCommand, onSelection, selectedConnector])

  const screenPoint = (point: GridPoint) => ({ x: gridToPixel(point.x) * viewport.zoom + viewport.x, y: gridToPixel(point.y) * viewport.zoom + viewport.y })
  const preview = connectionDrag === undefined || pointer === undefined ? undefined : materializeConnectorRoute(connectionDrag.start, [{ id: 'preview' as RouteConnectorId, position: pointer }], connectionDrag.axis)
  const previewScreenPoints = preview?.points.map((point) => `${screenPoint(point).x},${screenPoint(point).y}`).join(' ')
  const looseRoutes = [...blueprintLooseConnections(blueprint).values()].map((loose) => {
    if (connectorDrag?.looseId !== loose.id || connectorPosition === undefined) return { loose, route: looseConnectionRoute(blueprint, loose) }
    const routeConnectors = loose.routeConnectors.map((connector) => connector.id === connectorDrag.connectorId ? { ...connector, position: connectorPosition } : connector)
    return { loose: { ...loose, routeConnectors }, route: looseConnectionRoute(blueprint, { ...loose, routeConnectors }) }
  })
  const firstError = diagnosticsVisible ? diagnostics.find((diagnostic) => diagnostic.severity === 'error') : undefined

  const beginConnectorMove = (event: React.PointerEvent<HTMLButtonElement>, selectionValue: ConnectorSelection, position: GridPoint) => {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setSelectedConnector(selectionValue); setConnectorDrag({ ...selectionValue, start: position }); setPointer(position)
    onSelection({ nodeIds: [], edgeIds: selectionValue.edgeId === undefined ? [] : [selectionValue.edgeId], connector: selectionValue })
  }
  const deleteConnectorOnDoubleClick = (event: React.MouseEvent<HTMLButtonElement>, selectionValue: ConnectorSelection) => {
    event.preventDefault(); event.stopPropagation(); setConnectorDrag(undefined); setPointer(undefined); setSelectedConnector(undefined)
    if (selectionValue.edgeId !== undefined) onCommand(removeRouteConnector(selectionValue.edgeId, selectionValue.connectorId))
    else if (selectionValue.looseId !== undefined) onCommand(removeLooseConnector(selectionValue.looseId, selectionValue.connectorId))
    onSelection({ nodeIds: [], edgeIds: selectionValue.edgeId === undefined ? [] : [selectionValue.edgeId] })
  }
  const beginLooseExtension = (event: React.PointerEvent<HTMLButtonElement>, loose: LooseConnection) => {
    event.preventDefault(); event.stopPropagation(); const route = looseConnectionRoute(blueprint, loose); const start = route.points.at(-1); if (start === undefined) return
    setConnectionDrag({ kind: 'extend', looseId: loose.id, resourceId: loose.resourceId, capacity: loose.capacity, start, axis: axisOfLastSegment(route.points, portRouteAxis(blueprint, loose.origin)) }); setPointer(start); setConnectionError(undefined)
  }

  return <div className="graph-canvas" aria-label="Factory graph editor" onPointerMoveCapture={(event) => { const next = pointFromEvent(event); if (next !== undefined && (connectionDrag !== undefined || connectorDrag !== undefined)) setPointer(next) }} onPointerUpCapture={(event) => {
    if (connectorDrag !== undefined) {
      const next = pointFromEvent(event) ?? connectorDrag.start
      if (!samePoint(next, connectorDrag.start)) {
        if (connectorDrag.edgeId !== undefined) onCommand(moveRouteConnector(connectorDrag.edgeId, connectorDrag.connectorId, next))
        else if (connectorDrag.looseId !== undefined) onCommand(moveLooseConnector(connectorDrag.looseId, connectorDrag.connectorId, next))
      }
      setConnectorDrag(undefined); setPointer(undefined); return
    }
    commitConnectionDrop(event)
  }} onPointerCancelCapture={() => { setConnectionDrag(undefined); setConnectorDrag(undefined); setPointer(undefined) }}>
    {connectionError !== undefined && <div className="connection-error" role="alert">{connectionError}<button aria-label="Dismiss connection error" onClick={() => setConnectionError(undefined)}>×</button></div>}
    {firstError !== undefined && <div className="graph-diagnostic-summary" role="alert"><strong>Compilation blocked</strong><span>{diagnosticText(firstError)}</span></div>}
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={(instance) => { flow.current = instance; setViewport(instance.getViewport()) }} onMove={(_, nextViewport) => setViewport(nextViewport)} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onSelectionChange={selection} fitView snapToGrid snapGrid={[GRID_SIZE, GRID_SIZE]} deleteKeyCode={['Backspace', 'Delete']} minZoom={.25} maxZoom={1.7} nodesDraggable nodesConnectable={false} elementsSelectable>
      <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE} size={1.4} color="rgba(130, 184, 160, .22)" />
      <MiniMap pannable zoomable nodeColor={(node) => (node.data as FactoryFlowNode['data']).node.kind === 'machine' ? '#d1844f' : '#4c9478'} maskColor="rgba(4, 12, 10, .72)" />
      <Controls showInteractive={false} />
    </ReactFlow>
    <div className="route-overlay" aria-label="Connection connectors">
      <svg aria-hidden="true">
        {looseRoutes.map(({ loose, route }) => <polyline className="loose-route" key={loose.id} points={route.points.map((point) => `${screenPoint(point).x},${screenPoint(point).y}`).join(' ')} />)}
        {previewScreenPoints !== undefined && <polyline className="route-preview" points={previewScreenPoints} />}
      </svg>
      {[...blueprint.edges.values()].flatMap((edge) => edgeRoute(blueprint, edge).points.slice(1).map((end, index) => ({ edge, start: edgeRoute(blueprint, edge).points[index]!, end, index }))).map(({ edge, start, end, index }) => {
        const a = screenPoint(start); const b = screenPoint(end); const horizontal = a.y === b.y; const length = Math.abs(horizontal ? b.x - a.x : b.y - a.y); if (length <= 16) return null
        const style = horizontal ? { left: Math.min(a.x, b.x) + 8, top: a.y - 9, width: length - 16, height: 18 } : { left: a.x - 9, top: Math.min(a.y, b.y) + 8, width: 18, height: length - 16 }
        return <button key={`hit-${edge.id}-${index}`} className="route-segment-hit" data-edge-id={edge.id} aria-label={`Route ${edge.id} segment ${index + 1}`} style={style} onClick={(event) => { event.stopPropagation(); setSelectedConnector(undefined); setBridgeMenu(undefined); onSelection({ nodeIds: [], edgeIds: [edge.id] }) }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); const position = pointFromEvent(event); if (position !== undefined) setBridgeMenu({ edgeId: edge.id, position }) }} onDoubleClick={(event) => {
          event.preventDefault(); event.stopPropagation(); const point = pointFromEvent(event); if (point === undefined) return
          const connectorIndex = nearestRouteSpan(edgeRoute(blueprint, edge), point); const connector = { id: asId<RouteConnectorId>(`connector-${crypto.randomUUID()}`), position: point }; onCommand(insertRouteConnector(edge.id, connectorIndex, connector)); const next = { edgeId: edge.id, connectorId: connector.id }; setSelectedConnector(next); onSelection({ nodeIds: [], edgeIds: [edge.id], connector: next })
        }} />
      })}
      {[...blueprint.edges.values()].flatMap((edge) => connectorsForEdge(edge).map((connector) => ({ edge, connector }))).map(({ edge, connector }) => {
        const position = connectorDrag?.edgeId === edge.id && connectorDrag.connectorId === connector.id ? connectorPosition ?? connector.position : connector.position; const selectionValue = { edgeId: edge.id, connectorId: connector.id }
        return <button key={connector.id} className={`route-connector${selectedConnector?.connectorId === connector.id ? ' is-selected' : ''}`} aria-label="Connection connector" title="Drag to move · double-click to delete" style={{ left: screenPoint(position).x, top: screenPoint(position).y }} onPointerDown={(event) => beginConnectorMove(event, selectionValue, connector.position)} onDoubleClick={(event) => deleteConnectorOnDoubleClick(event, selectionValue)} />
      })}
      {looseRoutes.flatMap(({ loose }) => loose.routeConnectors.map((connector, index) => ({ loose, connector, free: index === loose.routeConnectors.length - 1 }))).map(({ loose, connector, free }) => {
        const position = connectorDrag?.looseId === loose.id && connectorDrag.connectorId === connector.id ? connectorPosition ?? connector.position : connector.position; const selectionValue = { looseId: loose.id, connectorId: connector.id }
        return <button key={connector.id} className={`route-connector${free ? ' is-free' : ''}${selectedConnector?.connectorId === connector.id ? ' is-selected' : ''}`} aria-label={free ? 'Free connection endpoint' : 'Connection connector'} title={free ? 'Drag to extend' : 'Drag to move · double-click to delete'} style={{ left: screenPoint(position).x, top: screenPoint(position).y }} onPointerDown={(event) => free ? beginLooseExtension(event, loose) : beginConnectorMove(event, selectionValue, connector.position)} {...(free ? {} : { onDoubleClick: (event: React.MouseEvent<HTMLButtonElement>) => deleteConnectorOnDoubleClick(event, selectionValue) })} />
      })}
      {edges.flatMap((edge) => {
        const data = edge.data; const labelPoint = data?.labelPosition ?? (data === undefined ? undefined : metricLabelAnchor(data.sections))
        if (data?.label === undefined || labelPoint === undefined) return []
        return <div key={`label-${edge.id}`} className="conveyor-label nodrag nopan" style={{ left: labelPoint.x * viewport.zoom + viewport.x, top: labelPoint.y * viewport.zoom + viewport.y, transform: `translate(-50%, -50%) scale(${viewport.zoom})` }}>{data.label}{data.locked === true && <span title="Manual geometry locked"> ▣</span>}</div>
      })}
      {bridgeMenu !== undefined && <div className="route-context-menu" style={{ left: screenPoint(bridgeMenu.position).x, top: screenPoint(bridgeMenu.position).y }}><button onClick={(event) => { event.stopPropagation(); onCommand(addBridgeAt(bridgeMenu.edgeId, bridgeMenu.position)); setBridgeMenu(undefined) }}>Add bridge here</button></div>}
      {preview !== undefined && <div className="route-drag-hint">Release on empty space to place a connector · release on a compatible port to finish · Esc to cancel</div>}
    </div>
  </div>
}
