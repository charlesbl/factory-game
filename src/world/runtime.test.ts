import { describe, expect, it } from 'vitest';
import { asId, gridPoint, gridSize } from '../domain';
import type {
  RailEdgeId,
  RailNodeId,
  ResourceId,
  StationId,
  WorldEntityId,
} from '../domain';
import { WorldBuffer } from '../simulation';
import {
  OreKind,
  TerrainKind,
  WorldRuntime,
  defaultWorldGenerationConfig,
  deserializeWorldRuntime,
  parseWorldRuntime,
  serializeWorldRuntime,
  stringifyWorldRuntime,
} from './index';

describe('world runtime persistence', () => {
  it('reconnects a restored mine output to its logistics station', () => {
    const runtime = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('mine-output-restore'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    });
    const mineId = asId<WorldEntityId>('mine-restored');
    const resourceId = asId<ResourceId>('ironOre');
    runtime.entities.set(mineId, {
      id: mineId,
      kind: 'mine',
      stationId: asId<StationId>('mine-station'),
      resourceId,
      constructionBuffer: { capacity: 1_000, items: [] },
      salvageBuffer: { capacity: 1_000, items: [] },
      transform: {
        position: gridPoint(0, 0),
        size: gridSize(4, 4),
        rotation: 0,
      },
      createdAt: 0n,
    });
    runtime.addTrafficStation({
      id: `mine-output:${mineId}`,
      railNodeId: asId<RailNodeId>('mine-node'),
      role: 'provider',
      buffer: new WorldBuffer(resourceId, 100),
      priority: 0,
      target: 0,
      minBatch: 1,
      maxBatch: 10,
    });

    runtime.restoreMines([
      {
        entityId: mineId,
        resourceId,
        oreKind: OreKind.IRON,
        drills: [],
        output: { resourceId, capacity: 100, quantity: 7 },
      },
    ]);

    const mine = runtime.mines.get(mineId)!;
    const station = runtime.traffic.stations.get(`mine-output:${mineId}`)!;
    expect(station.buffer).toBe(mine.output);
    expect(station.buffer?.quantity).toBe(7);
  });

  it('boots with one finite construction hub, eight depot slots, and two pods', () => {
    const runtime = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('starter-hub'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    });
    const snapshot = runtime.snapshot();
    expect(
      snapshot.entities.filter((entity) => entity.kind === 'storage'),
    ).toHaveLength(1);
    expect(
      snapshot.entities.filter((entity) => entity.kind === 'depot'),
    ).toHaveLength(1);
    expect(snapshot.pods).toHaveLength(2);
    expect(
      snapshot.stations.find((station) => station.id === 'hub:ironPlate')
        ?.quantity,
    ).toBe(200);
    expect(runtime.traffic.stations.get('depot:starter')?.depotCapacity).toBe(
      8,
    );
    expect(
      snapshot.buildings.find((building) => building.kind === 'storage'),
    ).toEqual({
      entityId: 'world-starter-storage',
      kind: 'storage',
      inventory: {
        capacity: 500,
        items: [
          { resourceId: 'circuit', quantity: 40 },
          { resourceId: 'copperWire', quantity: 100 },
          { resourceId: 'ironPlate', quantity: 200 },
        ],
      },
    });
  });
  it('restores the complete authoritative grid, entities, rails, revision, and clock', () => {
    const runtime = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('runtime-save'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    });
    const nodeA = asId<RailNodeId>('rail-a');
    const nodeB = asId<RailNodeId>('rail-b');
    runtime.addRailNode({
      id: nodeA,
      position: gridPoint(runtime.world.spawn.x, runtime.world.spawn.y + 4),
      kind: 'station',
    });
    runtime.addRailNode({
      id: nodeB,
      position: gridPoint(runtime.world.spawn.x + 8, runtime.world.spawn.y + 4),
      kind: 'junction',
    });
    runtime.addRailEdge({
      id: asId<RailEdgeId>('rail-edge'),
      from: nodeA,
      to: nodeB,
      points: [
        gridPoint(runtime.world.spawn.x, runtime.world.spawn.y + 4),
        gridPoint(runtime.world.spawn.x + 8, runtime.world.spawn.y + 4),
      ],
      length: 8,
    });
    const stationId = asId<StationId>('station-main');
    const entityId = asId<WorldEntityId>('entity-station');
    runtime.place({
      id: entityId,
      kind: 'station',
      stationId,
      railNodeId: nodeA,
      transform: {
        position: gridPoint(runtime.world.spawn.x, runtime.world.spawn.y),
        size: gridSize(2, 2),
        rotation: 1,
      },
      createdAt: 0n,
    });
    runtime.advanceTo(5_000_000n);
    const restored = deserializeWorldRuntime(serializeWorldRuntime(runtime));
    expect(restored.logicalTime).toBe(5_000_000n);
    expect(restored.revision).toBe(runtime.revision);
    expect(restored.entities.get(entityId)?.kind).toBe('station');
    expect(restored.railEdges.size).toBe(8);
    expect(
      [...restored.railEdges.values()].every((edge) => edge.length === 1),
    ).toBe(true);
    expect(restored.world.grid.oreRemaining).toEqual(
      runtime.world.grid.oreRemaining,
    );
    expect(restored.world.grid.occupancy).toEqual(runtime.world.grid.occupancy);
    expect(restored.entitySlotRecords()).toEqual(runtime.entitySlotRecords());
  });
  it('restores pods, reserved stock, missions, and pending logical events in transit', () => {
    const runtime = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('traffic-save'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    });
    const resource = asId<ResourceId>('ironOre');
    const providerNode = asId<RailNodeId>('provider-node');
    const requesterNode = asId<RailNodeId>('requester-node');
    const depotNode = asId<RailNodeId>('depot-node');
    runtime.addRailNode({
      id: providerNode,
      position: gridPoint(10, 10),
      kind: 'station',
    });
    runtime.addRailNode({
      id: requesterNode,
      position: gridPoint(20, 10),
      kind: 'station',
    });
    runtime.addRailNode({
      id: depotNode,
      position: gridPoint(20, 20),
      kind: 'depot',
    });
    runtime.addRailEdge({
      id: asId<RailEdgeId>('delivery'),
      from: providerNode,
      to: requesterNode,
      points: [gridPoint(10, 10), gridPoint(20, 10)],
      length: 10,
    });
    runtime.addRailEdge({
      id: asId<RailEdgeId>('return'),
      from: requesterNode,
      to: depotNode,
      points: [gridPoint(20, 10), gridPoint(20, 20)],
      length: 10,
    });
    runtime.addTrafficStation({
      id: 'provider',
      railNodeId: providerNode,
      role: 'provider',
      buffer: new WorldBuffer(resource, 100, 30),
      priority: 0,
      target: 0,
      minBatch: 1,
      maxBatch: 10,
    });
    runtime.addTrafficStation({
      id: 'requester',
      railNodeId: requesterNode,
      role: 'requester',
      buffer: new WorldBuffer(resource, 20),
      priority: 1,
      target: 20,
      minBatch: 5,
      maxBatch: 10,
      requestCreatedAt: 0n,
    });
    runtime.addTrafficStation({
      id: 'depot',
      railNodeId: depotNode,
      role: 'depot',
      priority: 0,
      target: 0,
      minBatch: 0,
      maxBatch: 0,
    });
    runtime.addPod('pod-1', providerNode, 'provider');
    runtime.dispatch();
    runtime.advanceTo(1_500_000n);
    const restored = deserializeWorldRuntime(serializeWorldRuntime(runtime));
    expect(restored.traffic.missions.get('mission-1')?.status).toBe(
      'TO_REQUESTER',
    );
    expect(restored.traffic.stations.get('provider')?.buffer?.quantity).toBe(
      20,
    );
    restored.advanceTo(3_000_000n);
    expect(restored.traffic.stations.get('requester')?.buffer?.quantity).toBe(
      10,
    );
    expect(restored.snapshot().pods[0]?.state).toBe('TO_DEPOT');
  });
  it('preserves authoritative arrays, stable slots, the next slot, and canonical text', () => {
    const runtime = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('stable-slots'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    });
    const railNodeId = asId<RailNodeId>('unused-node');
    const entity = (id: string, x: number) => ({
      id: asId<WorldEntityId>(id),
      kind: 'station' as const,
      stationId: asId<StationId>(`station-${id}`),
      railNodeId,
      transform: {
        position: gridPoint(runtime.world.spawn.x + x, runtime.world.spawn.y),
        size: gridSize(1, 1),
        rotation: 0 as const,
      },
      createdAt: 0n,
    });
    const first = entity('entity-first', 0);
    const second = entity('entity-second', 2);
    runtime.place(first);
    runtime.place(second);
    runtime.remove(first.id);
    runtime.world.grid.terrain[0] = TerrainKind.OBSTACLE;
    runtime.world.grid.oreKinds[0] = OreKind.IRON;
    runtime.world.grid.oreRemaining[0] = 77;
    const text = stringifyWorldRuntime(runtime);
    const restored = parseWorldRuntime(text);
    expect(stringifyWorldRuntime(restored)).toBe(text);
    expect(restored.world.grid.terrain[0]).toBe(TerrainKind.OBSTACLE);
    expect(restored.world.grid.oreKinds[0]).toBe(OreKind.IRON);
    expect(restored.world.grid.oreRemaining[0]).toBe(77);
    expect(
      restored
        .entitySlotRecords()
        .find((record) => record.entityId === second.id)?.slot,
    ).toBe(5);
    expect(restored.nextEntitySlot).toBe(6);
    const third = {
      ...entity('entity-third', 10),
      transform: {
        position: gridPoint(
          restored.world.spawn.x + 10,
          restored.world.spawn.y,
        ),
        size: gridSize(1, 1),
        rotation: 0 as const,
      },
    };
    restored.place(third);
    expect(
      restored
        .entitySlotRecords()
        .find((record) => record.entityId === third.id)?.slot,
    ).toBe(6);
  });
  it('rejects occupancy and slot metadata inconsistent with entities', () => {
    const runtime = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('corrupt-slots'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    });
    const entityId = asId<WorldEntityId>('entity-one');
    runtime.place({
      id: entityId,
      kind: 'station',
      stationId: asId<StationId>('station-one'),
      railNodeId: asId<RailNodeId>('node-one'),
      transform: {
        position: runtime.world.spawn,
        size: gridSize(1, 1),
        rotation: 0,
      },
      createdAt: 0n,
    });
    const state = serializeWorldRuntime(runtime);
    const occupiedIndex =
      runtime.world.spawn.y * runtime.world.grid.width + runtime.world.spawn.x;
    expect(() =>
      deserializeWorldRuntime({
        ...state,
        generated: {
          ...state.generated,
          occupancy: state.generated.occupancy.map((slot, index) =>
            index === occupiedIndex ? 0 : slot,
          ),
        },
      }),
    ).toThrow(/occupancy/);
    expect(() =>
      deserializeWorldRuntime({
        ...state,
        entitySlots: [{ entityId, slot: 2 }],
        nextEntitySlot: 2,
      }),
    ).toThrow(/slot/);
  });
  it('removes a rail segment and cleans up its loose endpoint nodes', () => {
    const runtime = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('remove-rail'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    });
    const start = gridPoint(10, 10);
    const end = gridPoint(15, 10);
    const edgeIds = runtime.placeRailPath([start, end]);
    const edgeId = edgeIds[0];
    expect(edgeId).toBeDefined();
    expect(edgeIds).toHaveLength(5);
    expect(edgeIds.map((id) => runtime.railEdges.get(id)?.length)).toEqual([
      1, 1, 1, 1, 1,
    ]);
    expect(runtime.railNodes.size).toBeGreaterThanOrEqual(4);
    runtime.removeRailEdge(edgeId!);
    expect(runtime.railEdges.has(edgeId!)).toBe(false);
    expect(
      [...runtime.railNodes.values()].some(
        (node) => node.position.x === start.x && node.position.y === start.y,
      ),
    ).toBe(false);
    expect(runtime.railEdges.size).toBe(4);
  });

  it('deduplicates directed cells and connects crossings automatically', () => {
    const runtime = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('rail-crossing'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    });
    const horizontal = runtime.placeRailPath([
      gridPoint(10, 10),
      gridPoint(14, 10),
    ]);
    expect(
      runtime.placeRailPath([gridPoint(10, 10), gridPoint(14, 10)]),
    ).toEqual(horizontal);
    runtime.placeRailPath([gridPoint(12, 8), gridPoint(12, 12)]);
    const crossing = [...runtime.railNodes.values()].find(
      (node) => node.position.x === 12 && node.position.y === 10,
    );
    expect(crossing?.kind).toBe('junction');
    const west = [...runtime.railNodes.values()].find(
      (node) => node.position.x === 10 && node.position.y === 10,
    )!;
    const south = [...runtime.railNodes.values()].find(
      (node) => node.position.x === 12 && node.position.y === 12,
    )!;
    expect(runtime.rails.route(west.id, south.id)?.distance).toBe(4);
  });

  it('reserves global capacity for queued pod production', () => {
    const runtime = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('pod-capacity'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    });
    const depotId = asId<WorldEntityId>('world-starter-depot');
    for (let index = 0; index < 6; index += 1)
      runtime.queuePodProduction(depotId);
    expect(() => runtime.queuePodProduction(depotId)).toThrow(
      'Global pod capacity is full',
    );
    const depot = runtime
      .snapshot()
      .buildings.find((building) => building.kind === 'depot');
    expect(depot).toMatchObject({
      podCount: 2,
      globalPodCapacity: 8,
      queuedPodCount: 6,
      productionQueueLength: 6,
    });
    for (let index = 0; index < 6; index += 1)
      runtime.cancelPodProduction(depotId);
    const depotEntity = runtime.entities.get(depotId);
    if (depotEntity?.kind !== 'depot')
      throw new Error('Starter depot is missing');
    for (let index = 0; index < 6; index += 1)
      runtime.addPod(
        `capacity-pod-${index}`,
        depotEntity.railNodeId,
        'depot:starter',
      );
    expect(() => runtime.dismantleEntity(depotId)).toThrow(
      'Dismantling would exceed global pod capacity',
    );
  });

  it('completes pod production from exact delivered materials and persists its sequence', () => {
    const runtime = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('pod-production'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    });
    const depotId = asId<WorldEntityId>('world-starter-depot');
    const storage = runtime.storageInventories.get(
      asId<WorldEntityId>('world-starter-storage'),
    )!;
    runtime.queuePodProduction(depotId);
    for (const [resourceId, quantity] of [
      [asId<ResourceId>('ironPlate'), 10],
      [asId<ResourceId>('copperWire'), 5],
      [asId<ResourceId>('circuit'), 2],
    ] as const) {
      storage.remove(resourceId, quantity);
      runtime.traffic.stations
        .get(`pod-production:pod-production-1:${resourceId}`)!
        .buffer!.add(quantity);
    }
    const restored = deserializeWorldRuntime(serializeWorldRuntime(runtime));
    expect(
      restored
        .snapshot()
        .buildings.find((building) => building.kind === 'depot'),
    ).toMatchObject({
      queuedPodCount: 1,
      activeProduction: {
        state: 'ACTIVE',
        delivered: [
          { resourceId: 'circuit', quantity: 2 },
          { resourceId: 'copperWire', quantity: 5 },
          { resourceId: 'ironPlate', quantity: 10 },
        ],
      },
    });
    restored.advanceTo(restored.logicalTime);
    expect(restored.traffic.pods.has('pod-built-1')).toBe(true);
    expect(restored.traffic.pods.size).toBe(3);
    restored.queuePodProduction(depotId);
    expect(restored.podProductions.has('pod-production-2')).toBe(true);

    const legacyRuntime = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('pod-production-legacy'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    });
    const { nextPodSequence, podProductions, ...legacyState } =
      serializeWorldRuntime(legacyRuntime);
    void nextPodSequence;
    void podProductions;
    const migrated = deserializeWorldRuntime({
      ...legacyState,
      schemaVersion: 3,
    });
    expect(migrated.podProductions.size).toBe(0);
    expect(migrated.nextPodSequence).toBe(1);
  });

  it('cancels the latest queued order before the active order', () => {
    const runtime = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('pod-cancel'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    });
    const depotId = asId<WorldEntityId>('world-starter-depot');
    runtime.queuePodProduction(depotId);
    runtime.queuePodProduction(depotId);
    runtime.cancelPodProduction(depotId);
    expect([...runtime.podProductions.values()]).toEqual([
      expect.objectContaining({ id: 'pod-production-1', state: 'ACTIVE' }),
    ]);
    runtime.cancelPodProduction(depotId);
    expect(runtime.podProductions.size).toBe(0);
    expect(runtime.snapshot().buildings).toContainEqual(
      expect.objectContaining({
        kind: 'depot',
        queuedPodCount: 0,
        productionQueueLength: 0,
      }),
    );
  });

  it('builds through the rail network and returns in-flight materials when cancelled', () => {
    const createConnectedRuntime = (seed: string) => {
      const runtime = WorldRuntime.generate({
        ...defaultWorldGenerationConfig(seed),
        width: 64,
        height: 64,
        spawnClearingSize: 24,
      });
      const storageNode = runtime.railNodes.get('rail-starter-storage')!;
      const depotNode = runtime.railNodes.get('rail-starter-depot')!;
      runtime.placeRailPath([depotNode.position, storageNode.position]);
      runtime.placeRailPath([storageNode.position, depotNode.position]);
      return runtime;
    };
    const depotId = asId<WorldEntityId>('world-starter-depot');
    const completed = createConnectedRuntime('pod-network-build');
    completed.queuePodProduction(depotId);
    completed.advanceTo(200_000_000n);
    expect(completed.traffic.pods.has('pod-built-1')).toBe(true);
    expect(
      completed.storageInventories
        .get(asId<WorldEntityId>('world-starter-storage'))
        ?.snapshot(),
    ).toEqual([
      { resourceId: 'circuit', quantity: 38 },
      { resourceId: 'copperWire', quantity: 95 },
      { resourceId: 'ironPlate', quantity: 190 },
    ]);

    const cancelled = createConnectedRuntime('pod-network-cancel');
    const original = cancelled.storageInventories
      .get(asId<WorldEntityId>('world-starter-storage'))!
      .snapshot();
    cancelled.queuePodProduction(depotId);
    expect(
      [...cancelled.traffic.missions.values()].some(
        (mission) => mission.status !== 'DELIVERED',
      ),
    ).toBe(true);
    cancelled.cancelPodProduction(depotId);
    cancelled.advanceTo(200_000_000n);
    expect(cancelled.podProductions.size).toBe(0);
    expect(
      cancelled.storageInventories
        .get(asId<WorldEntityId>('world-starter-storage'))!
        .snapshot(),
    ).toEqual(original);
    expect(cancelled.traffic.pods.size).toBe(2);
  });
});
