import { describe, expect, it } from 'vitest'
import { asId, createIdFactory, gridPoint } from '../domain'
import type { ContractId, FactoryId, LooseConnectionId, NodeId, PortId, RouteHandleId } from '../domain'
import { createBoundaryNode, createDemoBlueprint } from '../ui/demo-blueprint'
import { createBlueprint } from './blueprint'
import type { SubFactoryNode } from './blueprint'
import { BlueprintHistory } from './history'
import { captureSubgraph, createClipboardPayload, insertSubgraph, materializeSubgraph } from './clipboard'

describe('graph clipboard', () => {
  it('captures only internal routes and keeps boundary metadata', () => {
    const blueprint = createDemoBlueprint()
    const furnace = asId<NodeId>('node-furnace')
    expect(captureSubgraph(blueprint, [furnace])?.edges).toHaveLength(0)

    const payload = captureSubgraph(blueprint, [...blueprint.nodes.keys()])!
    expect(payload.nodes).toHaveLength(3)
    expect(payload.edges).toHaveLength(2)
    expect(payload.externalPorts).toHaveLength(2)
    expect(Math.min(...payload.nodes.map((node) => node.position.x))).toBe(0)
    expect(Math.min(...payload.nodes.map((node) => node.position.y))).toBe(0)
  })

  it('remaps every placed identity and translates saved route geometry', () => {
    const blueprint = createDemoBlueprint()
    const payload = captureSubgraph(blueprint, [...blueprint.nodes.keys()])!
    const placed = materializeSubgraph(payload, gridPoint(30, 40), createIdFactory())
    const originalIds = new Set([
      ...payload.nodes.flatMap((node) => [node.id, ...node.ports.map((port) => port.id)]),
      ...payload.edges.flatMap((edge) => [edge.id, ...edge.routeHandles.map((handle) => handle.id), ...edge.bridges.map((bridge) => bridge.id)]),
    ])
    const placedIds = [
      ...placed.nodes.flatMap((node) => [node.id, ...node.ports.map((port) => port.id)]),
      ...placed.edges.flatMap((edge) => [edge.id, ...edge.routeHandles.map((handle) => handle.id), ...edge.bridges.map((bridge) => bridge.id)]),
    ]
    expect(placedIds.every((id) => !originalIds.has(id))).toBe(true)
    expect(new Set(placedIds).size).toBe(placedIds.length)
    expect(Math.min(...placed.nodes.map((node) => node.position.x))).toBe(30)
    expect(Math.min(...placed.nodes.map((node) => node.position.y))).toBe(40)
    expect(placed.edges.every((edge) => placed.nodeIds.includes(edge.sourceNodeId) && placed.nodeIds.includes(edge.targetNodeId))).toBe(true)
    expect(placed.externalPorts.every((external) => placed.nodeIds.includes(external.nodeId) && placed.nodes.some((node) => node.ports.some((port) => port.id === external.portId)))).toBe(true)
  })

  it('preserves immutable sub-factory contract references', () => {
    const contractPortId = asId<PortId>('contract-input')
    const node: SubFactoryNode = {
      id: asId<NodeId>('child'), kind: 'sub-factory', name: 'Child', factoryId: asId<FactoryId>('factory-child'), version: 3, contractId: asId<ContractId>('contract-child-v3'),
      position: gridPoint(4, 6), footprint: { x: 0, y: 0, width: 4, height: 3 },
      ports: [{ id: asId<PortId>('placed-input'), contractPortId, direction: 'input', resourceId: asId('ironOre'), capacity: 1n, anchor: gridPoint(0, 1) }],
    }
    const placed = materializeSubgraph(createClipboardPayload([node])!, gridPoint(10, 12), createIdFactory())
    const copy = placed.nodes[0] as SubFactoryNode
    expect(copy.id).not.toBe(node.id)
    expect(copy.ports[0]!.id).not.toBe(node.ports[0]!.id)
    expect(copy.ports[0]!.contractPortId).toBe(contractPortId)
    expect(copy.contractId).toBe(node.contractId)
    expect(copy.factoryId).toBe(node.factoryId)
    expect(copy.version).toBe(3)
  })

  it('copies an incomplete route with its origin and remaps its identities', () => {
    const nodeId = asId<NodeId>('loose-origin')
    const portId = asId<PortId>('loose-port')
    const looseId = asId<LooseConnectionId>('loose-route')
    const node = createBoundaryNode(nodeId, portId, 'external-input', asId('ironOre'), 4, 6)
    const loose = { id: looseId, origin: { nodeId, portId }, routeHandles: [{ id: asId<RouteHandleId>('loose-end'), position: gridPoint(12, 10) }] }
    const source = { ...createBlueprint(asId<FactoryId>('factory-source')), nodes: new Map([[node.id, node]]), looseConnections: new Map([[loose.id, loose]]) }

    const payload = captureSubgraph(source, [], [looseId])!
    expect(payload.nodes).toHaveLength(1)
    expect(payload.looseConnections).toHaveLength(1)

    const placed = materializeSubgraph(payload, gridPoint(20, 30), createIdFactory())
    expect(placed.looseConnections[0]!.id).not.toBe(looseId)
    expect(placed.looseConnections[0]!.origin.nodeId).toBe(placed.nodes[0]!.id)
    expect(placed.looseConnections[0]!.origin.portId).toBe(placed.nodes[0]!.ports[0]!.id)
    expect(placed.looseConnections[0]!.routeHandles[0]!.position).toEqual(gridPoint(28, 34))

    const inserted = new BlueprintHistory(createBlueprint(asId<FactoryId>('factory-target'))).execute(insertSubgraph(placed))
    expect(inserted.nodes.size).toBe(1)
    expect(inserted.looseConnections.size).toBe(1)
  })

  it('inserts a complete subgraph as one undoable history entry', () => {
    const source = createDemoBlueprint()
    const payload = captureSubgraph(source, [...source.nodes.keys()])!
    const placed = materializeSubgraph(payload, gridPoint(20, 20), createIdFactory())
    const empty = createBlueprint(asId<FactoryId>('factory-target'))
    const history = new BlueprintHistory(empty)
    const inserted = history.execute(insertSubgraph(placed))
    expect(inserted.nodes.size).toBe(3)
    expect(inserted.edges.size).toBe(2)
    expect(inserted.externalPorts).toHaveLength(2)
    expect(history.canUndo).toBe(true)
    expect(history.undo()).toBe(empty)
  })
})
