import { describe, expect, it } from 'vitest'
import { asId, gridPoint, gridSize } from '../domain'
import type { RailEdgeId, RailNodeId, ResourceId, StationId, WorldEntityId } from '../domain'
import { WorldBuffer } from '../simulation'
import { OreKind, TerrainKind, WorldRuntime, defaultWorldGenerationConfig, deserializeWorldRuntime, parseWorldRuntime, serializeWorldRuntime, stringifyWorldRuntime } from './index'

describe('world runtime persistence', () => {
  it('boots with one finite construction hub, eight depot slots, and two pods', () => {
    const runtime = WorldRuntime.generate({ ...defaultWorldGenerationConfig('starter-hub'), width: 64, height: 64, spawnClearingSize: 24 }); const snapshot = runtime.snapshot()
    expect(snapshot.entities.filter((entity) => entity.kind === 'storage')).toHaveLength(1); expect(snapshot.entities.filter((entity) => entity.kind === 'depot')).toHaveLength(1); expect(snapshot.pods).toHaveLength(2)
    expect(snapshot.stations.find((station) => station.id === 'hub:ironPlate')?.quantity).toBe(200); expect(runtime.traffic.stations.get('depot:starter')?.depotCapacity).toBe(8)
    expect(snapshot.buildings.find((building) => building.kind === 'storage')).toEqual({ entityId: 'world-starter-storage', kind: 'storage', inventory: { capacity: 500, items: [{ resourceId: 'circuit', quantity: 40 }, { resourceId: 'copperWire', quantity: 100 }, { resourceId: 'ironPlate', quantity: 200 }] } })
  })
  it('restores the complete authoritative grid, entities, rails, revision, and clock', () => {
    const runtime = WorldRuntime.generate({ ...defaultWorldGenerationConfig('runtime-save'), width: 64, height: 64, spawnClearingSize: 24 })
    const nodeA = asId<RailNodeId>('rail-a'); const nodeB = asId<RailNodeId>('rail-b')
    runtime.addRailNode({ id: nodeA, position: gridPoint(runtime.world.spawn.x, runtime.world.spawn.y + 4), kind: 'station' }); runtime.addRailNode({ id: nodeB, position: gridPoint(runtime.world.spawn.x + 8, runtime.world.spawn.y + 4), kind: 'junction' }); runtime.addRailEdge({ id: asId<RailEdgeId>('rail-edge'), from: nodeA, to: nodeB, points: [gridPoint(runtime.world.spawn.x, runtime.world.spawn.y + 4), gridPoint(runtime.world.spawn.x + 8, runtime.world.spawn.y + 4)], length: 8 })
    const stationId = asId<StationId>('station-main'); const entityId = asId<WorldEntityId>('entity-station'); runtime.place({ id: entityId, kind: 'station', stationId, railNodeId: nodeA, transform: { position: gridPoint(runtime.world.spawn.x, runtime.world.spawn.y), size: gridSize(2, 2), rotation: 1 }, createdAt: 0n }); runtime.advanceTo(5_000_000n)
    const restored = deserializeWorldRuntime(serializeWorldRuntime(runtime)); expect(restored.logicalTime).toBe(5_000_000n); expect(restored.revision).toBe(runtime.revision); expect(restored.entities.get(entityId)?.kind).toBe('station'); expect(restored.railEdges.get('rail-edge')?.length).toBe(8); expect(restored.world.grid.oreRemaining).toEqual(runtime.world.grid.oreRemaining); expect(restored.world.grid.occupancy).toEqual(runtime.world.grid.occupancy); expect(restored.entitySlotRecords()).toEqual(runtime.entitySlotRecords())
  })
  it('restores pods, reserved stock, missions, and pending logical events in transit', () => {
    const runtime = WorldRuntime.generate({ ...defaultWorldGenerationConfig('traffic-save'), width: 64, height: 64, spawnClearingSize: 24 }); const resource = asId<ResourceId>('ironOre'); const providerNode = asId<RailNodeId>('provider-node'); const requesterNode = asId<RailNodeId>('requester-node'); const depotNode = asId<RailNodeId>('depot-node')
    runtime.addRailNode({ id: providerNode, position: gridPoint(10, 10), kind: 'station' }); runtime.addRailNode({ id: requesterNode, position: gridPoint(20, 10), kind: 'station' }); runtime.addRailNode({ id: depotNode, position: gridPoint(20, 20), kind: 'depot' }); runtime.addRailEdge({ id: asId<RailEdgeId>('delivery'), from: providerNode, to: requesterNode, points: [gridPoint(10, 10), gridPoint(20, 10)], length: 10 }); runtime.addRailEdge({ id: asId<RailEdgeId>('return'), from: requesterNode, to: depotNode, points: [gridPoint(20, 10), gridPoint(20, 20)], length: 10 })
    runtime.addTrafficStation({ id: 'provider', railNodeId: providerNode, role: 'provider', buffer: new WorldBuffer(resource, 100, 30), priority: 0, target: 0, minBatch: 1, maxBatch: 10 }); runtime.addTrafficStation({ id: 'requester', railNodeId: requesterNode, role: 'requester', buffer: new WorldBuffer(resource, 20), priority: 1, target: 20, minBatch: 5, maxBatch: 10, requestCreatedAt: 0n }); runtime.addTrafficStation({ id: 'depot', railNodeId: depotNode, role: 'depot', priority: 0, target: 0, minBatch: 0, maxBatch: 0 }); runtime.addPod('pod-1', providerNode, 'provider'); runtime.dispatch(); runtime.advanceTo(1_500_000n)
    const restored = deserializeWorldRuntime(serializeWorldRuntime(runtime)); expect(restored.traffic.missions.get('mission-1')?.status).toBe('TO_REQUESTER'); expect(restored.traffic.stations.get('provider')?.buffer?.quantity).toBe(20); restored.advanceTo(3_000_000n); expect(restored.traffic.stations.get('requester')?.buffer?.quantity).toBe(10); expect(restored.snapshot().pods[0]?.state).toBe('TO_DEPOT')
  })
  it('preserves authoritative arrays, stable slots, the next slot, and canonical text', () => {
    const runtime = WorldRuntime.generate({ ...defaultWorldGenerationConfig('stable-slots'), width: 64, height: 64, spawnClearingSize: 24 }); const railNodeId = asId<RailNodeId>('unused-node')
    const entity = (id: string, x: number) => ({ id: asId<WorldEntityId>(id), kind: 'station' as const, stationId: asId<StationId>(`station-${id}`), railNodeId, transform: { position: gridPoint(runtime.world.spawn.x + x, runtime.world.spawn.y), size: gridSize(1, 1), rotation: 0 as const }, createdAt: 0n })
    const first = entity('entity-first', 0); const second = entity('entity-second', 2); runtime.place(first); runtime.place(second); runtime.remove(first.id)
    runtime.world.grid.terrain[0] = TerrainKind.OBSTACLE; runtime.world.grid.oreKinds[0] = OreKind.IRON; runtime.world.grid.oreRemaining[0] = 77
    const text = stringifyWorldRuntime(runtime); const restored = parseWorldRuntime(text)
    expect(stringifyWorldRuntime(restored)).toBe(text); expect(restored.world.grid.terrain[0]).toBe(TerrainKind.OBSTACLE); expect(restored.world.grid.oreKinds[0]).toBe(OreKind.IRON); expect(restored.world.grid.oreRemaining[0]).toBe(77)
    expect(restored.entitySlotRecords().find((record) => record.entityId === second.id)?.slot).toBe(5); expect(restored.nextEntitySlot).toBe(6)
    const third = { ...entity('entity-third', 10), transform: { position: gridPoint(restored.world.spawn.x + 10, restored.world.spawn.y), size: gridSize(1, 1), rotation: 0 as const } }; restored.place(third); expect(restored.entitySlotRecords().find((record) => record.entityId === third.id)?.slot).toBe(6)
  })
  it('rejects occupancy and slot metadata inconsistent with entities', () => {
    const runtime = WorldRuntime.generate({ ...defaultWorldGenerationConfig('corrupt-slots'), width: 64, height: 64, spawnClearingSize: 24 }); const entityId = asId<WorldEntityId>('entity-one'); runtime.place({ id: entityId, kind: 'station', stationId: asId<StationId>('station-one'), railNodeId: asId<RailNodeId>('node-one'), transform: { position: runtime.world.spawn, size: gridSize(1, 1), rotation: 0 }, createdAt: 0n })
    const state = serializeWorldRuntime(runtime); const occupiedIndex = runtime.world.spawn.y * runtime.world.grid.width + runtime.world.spawn.x
    expect(() => deserializeWorldRuntime({ ...state, generated: { ...state.generated, occupancy: state.generated.occupancy.map((slot, index) => index === occupiedIndex ? 0 : slot) } })).toThrow(/occupancy/)
    expect(() => deserializeWorldRuntime({ ...state, entitySlots: [{ entityId, slot: 2 }], nextEntitySlot: 2 })).toThrow(/slot/)
  })
  it('removes a rail segment and cleans up its loose endpoint nodes', () => {
    const runtime = WorldRuntime.generate({ ...defaultWorldGenerationConfig('remove-rail'), width: 64, height: 64, spawnClearingSize: 24 }); const start = gridPoint(10, 10); const end = gridPoint(15, 10)
    const [edgeId] = runtime.placeRailPath([start, end]); expect(edgeId).toBeDefined(); expect(runtime.railNodes.size).toBeGreaterThanOrEqual(4)
    runtime.removeRailEdge(edgeId!); expect(runtime.railEdges.has(edgeId!)).toBe(false); expect([...runtime.railNodes.values()].some((node) => node.position.x === start.x && node.position.y === start.y)).toBe(false); expect([...runtime.railNodes.values()].some((node) => node.position.x === end.x && node.position.y === end.y)).toBe(false)
  })
})
