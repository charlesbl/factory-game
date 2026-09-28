import { describe, expect, it } from 'vitest';
import { asId, gridPoint, gridSize, worldContent } from '../domain';
import type {
  RailNodeId,
  ResourceId,
  StationId,
  WorldEntityId,
} from '../domain';
import {
  OreKind,
  TerrainKind,
  WorldRuntime,
  defaultWorldGenerationConfig,
  deserializeWorldRuntime,
  frontDirection,
  generateWorld,
  gridIndex,
  hookupCell,
  occupy,
  occupiedCells,
  serializeWorldRuntime,
  type DepotWorldEntity,
  type QuarterTurn,
  type StationWorldEntity,
  type WorldTransform,
} from './index';

const create = () =>
  new WorldRuntime(
    generateWorld({
      ...defaultWorldGenerationConfig('rail-hookup'),
      width: 64,
      height: 64,
    }),
  );
const clear = (
  runtime: WorldRuntime,
  x: number,
  y: number,
  w: number,
  h: number,
) => {
  for (let dy = 0; dy < h; dy += 1)
    for (let dx = 0; dx < w; dx += 1) {
      const index = gridIndex(runtime.world.grid, { x: x + dx, y: y + dy });
      runtime.world.grid.terrain[index] = TerrainKind.BUILDABLE;
      runtime.world.grid.occupancy[index] = 0;
      runtime.world.grid.oreKinds[index] = OreKind.NONE;
    }
};
const stationAt = (x: number, y: number): WorldTransform => ({
  position: gridPoint(x, y),
  size: worldContent.stationFootprint,
  rotation: 0,
});

describe('rail hookup cell derivation', () => {
  it('puts the hookup cell one step outside the front edge centre for all four turns of a non-square footprint', () => {
    const size = gridSize(3, 2);
    const expected = [
      { x: 11, y: 22 }, // rotation 0: south edge at y = 22, centre x = 10 + floor(3 / 2)
      { x: 9, y: 21 }, // rotation 1: west edge at x = 9, centre y = 20 + floor(3 / 2)
      { x: 11, y: 19 }, // rotation 2: north edge at y = 19, centre x = 10 + floor(3 / 2)
      { x: 12, y: 21 }, // rotation 3: east edge at x = 12, centre y = 20 + floor(3 / 2)
    ];
    for (const rotation of [0, 1, 2, 3] as const) {
      const transform = { position: gridPoint(10, 20), size, rotation };
      const cell = hookupCell(transform);
      expect(cell).toEqual(expected[rotation]);
      const inward = {
        x: cell.x - frontDirection(rotation).x,
        y: cell.y - frontDirection(rotation).y,
      };
      expect(occupiedCells(transform)).toContainEqual(inward);
    }
  });
  it('turns the front edge clockwise exactly like the quarter-turn mapping', () => {
    const mapTurn = (point: { x: number; y: number }) => ({
      x: 0 - point.y,
      y: point.x,
    });
    let direction = { x: 0, y: 1 };
    for (const rotation of [0, 1, 2, 3] as const) {
      expect(frontDirection(rotation)).toEqual(direction);
      direction = mapTurn(direction);
    }
  });
  it('is deterministic for even footprints of stations and depots', () => {
    expect(hookupCell(stationAt(30, 40))).toEqual({ x: 31, y: 42 });
    expect(
      hookupCell({
        position: gridPoint(30, 40),
        size: gridSize(4, 4),
        rotation: 0,
      }),
    ).toEqual({ x: 32, y: 44 });
  });
});

describe('station and depot hookup validation', () => {
  it('rejects a station whose hookup cell falls outside the map', () => {
    const runtime = create();
    clear(runtime, 9, 61, 4, 3);
    const validation = runtime.validateInteraction(
      'station',
      gridPoint(10, 62),
    );
    expect(validation).toEqual({ valid: false, reason: 'HOOKUP_BLOCKED' });
    expect(() =>
      runtime.placeControlNode('station', gridPoint(10, 62)),
    ).toThrow(/HOOKUP_BLOCKED/);
  });
  it('rejects a station whose hookup cell is an obstacle', () => {
    const runtime = create();
    clear(runtime, 9, 9, 5, 6);
    runtime.world.grid.terrain[
      gridIndex(runtime.world.grid, gridPoint(11, 12))
    ] = TerrainKind.OBSTACLE;
    expect(runtime.validateInteraction('station', gridPoint(10, 10))).toEqual({
      valid: false,
      reason: 'HOOKUP_BLOCKED',
    });
  });
  it('rejects a station whose hookup cell is occupied by another entity', () => {
    const runtime = create();
    clear(runtime, 9, 9, 5, 6);
    occupy(
      runtime.world.grid,
      { position: gridPoint(11, 12), size: gridSize(1, 1), rotation: 0 },
      1,
    );
    expect(runtime.validateInteraction('station', gridPoint(10, 10))).toEqual({
      valid: false,
      reason: 'HOOKUP_BLOCKED',
    });
  });
  it('rejects a depot whose hookup cell is claimed by another station rail node', () => {
    const runtime = create();
    clear(runtime, 8, 8, 7, 9);
    const station = runtime.placeControlNode('station', gridPoint(10, 10));
    expect(station.position).toEqual({ x: 11, y: 12 });
    const depotTransform: WorldTransform = {
      position: gridPoint(10, 13),
      size: gridSize(2, 2),
      rotation: 2,
    };
    expect(hookupCell(depotTransform)).toEqual({ x: 11, y: 12 });
    expect(runtime.validateGhost('depot', depotTransform)).toEqual({
      valid: false,
      reason: 'HOOKUP_BLOCKED',
    });
    expect(() =>
      runtime.createConstructionSite({
        targetKind: 'depot',
        transform: depotTransform,
        stationId: asId<StationId>('station-claimed'),
        cost: [],
      }),
    ).toThrow(/HOOKUP_BLOCKED/);
  });
  it('claims a pending depot hookup cell against a later station', () => {
    const runtime = create();
    clear(runtime, 8, 8, 7, 9);
    const depotTransform: WorldTransform = {
      position: gridPoint(10, 13),
      size: gridSize(2, 2),
      rotation: 2,
    };
    runtime.createConstructionSite({
      targetKind: 'depot',
      transform: depotTransform,
      stationId: asId<StationId>('station-pending'),
      cost: [{ resourceId: asId<ResourceId>('ironPlate'), quantity: 5 }],
    });
    expect(() =>
      runtime.placeControlNode('station', gridPoint(10, 10)),
    ).toThrow(/HOOKUP_BLOCKED/);
  });
});

describe('station and depot rail nodes', () => {
  it('creates the station node at the hookup cell and splits rails drawn there', () => {
    const runtime = create();
    clear(runtime, 4, 9, 18, 14);
    runtime.placeRailPath([gridPoint(5, 12), gridPoint(20, 12)]);
    const node = runtime.placeControlNode('station', gridPoint(10, 10));
    expect(node.position).toEqual({ x: 11, y: 12 });
    expect(node.kind).toBe('station');
    // The station entity transform stays at the command position.
    expect(occupiedCells(stationAt(10, 10))).not.toContainEqual(node.position);
    const attached = [...runtime.railEdges.values()].filter(
      (edge) => edge.from === node.id || edge.to === node.id,
    );
    expect(attached).toHaveLength(2);
  });
  it('gives a depot its own rail node at its hookup cell and wires the depot traffic station', () => {
    const runtime = create();
    clear(runtime, 18, 18, 20, 20);
    const stationNode = runtime.placeControlNode('station', gridPoint(24, 24));
    runtime.place({
      id: asId<WorldEntityId>('station-entity'),
      kind: 'station',
      stationId: asId<StationId>('station-delivery'),
      railNodeId: stationNode.id,
      transform: stationAt(24, 24),
      createdAt: 0n,
    });
    const depotTransform: WorldTransform = {
      position: gridPoint(30, 30),
      size: gridSize(4, 4),
      rotation: 1 as QuarterTurn,
    };
    const site = runtime.createConstructionSite({
      targetKind: 'depot',
      transform: depotTransform,
      stationId: asId<StationId>('station-delivery'),
      cost: [],
    });
    const depot = runtime.entities.get(site.id) as DepotWorldEntity;
    expect(depot.kind).toBe('depot');
    const depotNode = runtime.railNodes.get(depot.railNodeId)!;
    expect(depotNode.position).toEqual(hookupCell(depotTransform));
    expect(depotNode.kind).toBe('depot');
    expect(depotNode.id).not.toBe(stationNode.id);
    expect(runtime.traffic.stations.get(`depot:${site.id}`)?.railNodeId).toBe(
      depotNode.id,
    );
  });
  it('keeps paid depot construction delivery on the supplying station', () => {
    const runtime = create();
    clear(runtime, 18, 18, 20, 20);
    const stationNode = runtime.placeControlNode('station', gridPoint(24, 24));
    runtime.place({
      id: asId<WorldEntityId>('station-entity'),
      kind: 'station',
      stationId: asId<StationId>('station-delivery'),
      railNodeId: stationNode.id,
      transform: stationAt(24, 24),
      createdAt: 0n,
    });
    runtime.createConstructionSite({
      targetKind: 'depot',
      transform: {
        position: gridPoint(30, 30),
        size: gridSize(4, 4),
        rotation: 0,
      },
      stationId: asId<StationId>('station-delivery'),
      cost: [{ resourceId: asId<ResourceId>('ironPlate'), quantity: 5 }],
    });
    const requesters = [...runtime.traffic.stations.values()].filter(
      (station) => station.role === 'requester',
    );
    expect(
      requesters.some((station) => station.railNodeId === stationNode.id),
    ).toBe(true);
  });
  it('generates the starter hub with station and depot nodes at their hookup cells', () => {
    const runtime = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('hookup-hub'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    });
    for (const kind of ['station', 'depot'] as const) {
      const entity = [...runtime.entities.values()].find(
        (candidate) => candidate.kind === kind,
      ) as StationWorldEntity | DepotWorldEntity;
      const node = runtime.railNodes.get(entity.railNodeId)!;
      expect(node.kind).toBe(kind);
      expect(node.position).toEqual(hookupCell(entity.transform));
    }
  });
  it('loads a legacy save whose rail nodes lie inside the buildings without rejecting or migrating them', () => {
    const runtime = create();
    clear(runtime, 28, 28, 14, 8);
    const stationTransform = stationAt(30, 30);
    const depotTransform: WorldTransform = {
      position: gridPoint(36, 30),
      size: gridSize(4, 4),
      rotation: 0,
    };
    // Old rules put the station node at the footprint minimum corner and the
    // depot node at its centre cell; both lie inside/under the building.
    runtime.addRailNode({
      id: asId<RailNodeId>('rail-legacy-station'),
      position: gridPoint(30, 30),
      kind: 'station',
    });
    runtime.addRailNode({
      id: asId<RailNodeId>('rail-legacy-depot'),
      position: gridPoint(37, 31),
      kind: 'depot',
    });
    runtime.place({
      id: asId<WorldEntityId>('legacy-station'),
      kind: 'station',
      stationId: asId<StationId>('station-legacy'),
      railNodeId: asId<RailNodeId>('rail-legacy-station'),
      transform: stationTransform,
      createdAt: 0n,
    });
    runtime.place({
      id: asId<WorldEntityId>('legacy-depot'),
      kind: 'depot',
      railNodeId: asId<RailNodeId>('rail-legacy-depot'),
      podCapacity: 8,
      podIds: [],
      transform: depotTransform,
      createdAt: 0n,
    });
    const restored = deserializeWorldRuntime(serializeWorldRuntime(runtime));
    for (const [entityId, nodeId, transform] of [
      [
        asId<WorldEntityId>('legacy-station'),
        asId<RailNodeId>('rail-legacy-station'),
        stationTransform,
      ],
      [
        asId<WorldEntityId>('legacy-depot'),
        asId<RailNodeId>('rail-legacy-depot'),
        depotTransform,
      ],
    ] as const) {
      const entity = restored.entities.get(entityId);
      expect(entity).toBeDefined();
      const node = restored.railNodes.get(nodeId)!;
      expect(node).toBeDefined();
      // Legacy discriminator: the renderer shows only the marker when the node
      // is not at the derived hookup cell.
      expect(hookupCell(transform)).not.toEqual(node.position);
    }
  });
});

describe('hookup reclaim after removal', () => {
  it('rebuilds a station on the same cell after removing it', () => {
    const runtime = create();
    clear(runtime, 4, 9, 18, 14);
    const first = runtime.placeControlNode('station', gridPoint(10, 10));
    runtime.place({
      id: asId<WorldEntityId>('station-entity'),
      kind: 'station',
      stationId: asId<StationId>('station-a'),
      railNodeId: first.id,
      transform: stationAt(10, 10),
      createdAt: 0n,
    });
    runtime.remove(asId<WorldEntityId>('station-entity'));
    const rebuilt = runtime.placeControlNode('station', gridPoint(10, 10));
    expect(rebuilt.position).toEqual(first.position);
    expect(rebuilt.kind).toBe('station');
  });
  it('reclaims the residual node and keeps rails drawn to the hookup cell', () => {
    const runtime = create();
    clear(runtime, 4, 9, 18, 14);
    const first = runtime.placeControlNode('station', gridPoint(10, 10));
    runtime.place({
      id: asId<WorldEntityId>('station-entity'),
      kind: 'station',
      stationId: asId<StationId>('station-a'),
      railNodeId: first.id,
      transform: stationAt(10, 10),
      createdAt: 0n,
    });
    runtime.placeRailPath([gridPoint(5, 12), gridPoint(11, 12)]);
    const attached = () =>
      [...runtime.railEdges.values()].filter(
        (edge) => edge.from === first.id || edge.to === first.id,
      );
    expect(attached().length).toBeGreaterThan(0);
    runtime.remove(asId<WorldEntityId>('station-entity'));
    // Rails survive the removal: the node is downgraded, not deleted.
    expect(runtime.railNodes.get(first.id)?.kind).toBe('endpoint');
    const rebuilt = runtime.placeControlNode('station', gridPoint(10, 10));
    expect(rebuilt.id).toBe(first.id);
    expect(rebuilt.kind).toBe('station');
    expect(attached().length).toBeGreaterThan(0);
  });
  it('rebuilds a depot site on the same cell reusing its residual node', () => {
    const runtime = create();
    clear(runtime, 18, 18, 20, 20);
    const stationNode = runtime.placeControlNode('station', gridPoint(24, 24));
    runtime.place({
      id: asId<WorldEntityId>('station-entity'),
      kind: 'station',
      stationId: asId<StationId>('station-delivery'),
      railNodeId: stationNode.id,
      transform: stationAt(24, 24),
      createdAt: 0n,
    });
    const depotTransform: WorldTransform = {
      position: gridPoint(30, 30),
      size: gridSize(4, 4),
      rotation: 0,
    };
    const site = runtime.createConstructionSite({
      targetKind: 'depot',
      transform: depotTransform,
      stationId: asId<StationId>('station-delivery'),
      cost: [],
    });
    const depot = runtime.entities.get(site.id) as DepotWorldEntity;
    const reused = depot.railNodeId;
    // A rail pinned to the depot hookup cell keeps the node alive on removal.
    runtime.placeRailPath([gridPoint(32, 34), gridPoint(32, 36)]);
    runtime.remove(site.id);
    expect(runtime.railNodes.get(reused)?.kind).toBe('endpoint');
    const again = runtime.createConstructionSite({
      targetKind: 'depot',
      transform: depotTransform,
      stationId: asId<StationId>('station-delivery'),
      cost: [],
    });
    const rebuilt = runtime.entities.get(again.id) as DepotWorldEntity;
    expect(rebuilt.kind).toBe('depot');
    expect(rebuilt.railNodeId).toBe(reused);
    expect(runtime.railNodes.get(reused)!.kind).toBe('depot');
    expect(runtime.traffic.stations.get(`depot:${again.id}`)?.railNodeId).toBe(
      reused,
    );
  });
});
