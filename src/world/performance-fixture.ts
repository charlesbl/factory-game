import { asId, gridPoint, gridSize, worldContent } from '../domain';
import type { StationId, ResourceId } from '../domain';
import { compileBlueprint, isContract, serializeContract } from '../compiler';
import { createDemoBlueprint } from '../ui/demo-blueprint';
import { WorldBuffer } from '../simulation';
import { generateWorld } from './generation';
import { hookupCell } from './placement';
import { WorldRuntime } from './runtime';
import {
  defaultWorldGenerationConfig,
  OreKind,
  TerrainKind,
  type WorldTransform,
} from './model';

/** 500 real entities, 200 pods, 2000 directed rail cells. No render-only actors. */
export function createPerformanceFixture() {
  const runtime = new WorldRuntime(
    generateWorld(defaultWorldGenerationConfig('world-performance-v1')),
  );
  const contract = compileBlueprint(createDemoBlueprint());
  if (!isContract(contract))
    throw new Error('Performance factory must compile');
  const resource = asId<ResourceId>('ironPlate');
  for (let i = 0; i < 100; i++) {
    const x = 3 + (i % 10) * 25,
      y = 3 + Math.floor(i / 10) * 25;
    for (let dy = 0; dy < 25; dy++)
      for (let dx = 0; dx < 25; dx++) {
        const index = (y + dy) * 256 + x + dx;
        runtime.world.grid.terrain[index] = TerrainKind.BUILDABLE;
        runtime.world.grid.oreKinds[index] = OreKind.NONE;
        runtime.world.grid.oreRemaining[index] = 0;
      }
    const a = runtime.placeControlNode('station', gridPoint(x + 2, y + 8)),
      aAnchor = gridPoint(x + 2, y + 8);
    const b = runtime.placeControlNode('station', gridPoint(x + 12, y + 8)),
      bAnchor = gridPoint(x + 12, y + 8);
    const stationA = asId<StationId>(`fixture-station-a-${i}`),
      stationB = asId<StationId>(`fixture-station-b-${i}`);
    for (const [node, stationId, anchor] of [
      [a, stationA, aAnchor],
      [b, stationB, bAnchor],
    ] as const)
      runtime.place({
        id: asId(`fixture-entity-${stationId}`),
        kind: 'station',
        stationId,
        railNodeId: node.id,
        transform: {
          position: anchor,
          size: worldContent.stationFootprint,
          rotation: 0,
        },
        createdAt: 0n,
      });
    runtime.placeRailPath([a.position, b.position]);
    runtime.placeRailPath([b.position, a.position]);
    const storage = runtime.createConstructionSite({
      targetKind: 'storage',
      transform: {
        position: gridPoint(x + 4, y + 6),
        size: gridSize(4, 4),
        rotation: 0,
      },
      stationId: stationA,
      cost: [],
    });
    runtime.storageInventories.get(storage.id)!.add(resource, 500);
    runtime.configureStation(storage.id, resource, 'provide', 0, 0);
    if (i < 90) {
      const factory = runtime.createConstructionSite({
        targetKind: 'factory',
        transform: {
          position: gridPoint(x, y),
          size: gridSize(contract.footprint.width, contract.footprint.height),
          rotation: 0,
        },
        stationId: stationB,
        cost: [],
        factoryId: asId('factory-main'),
        instanceId: asId(`fixture-factory-${i}`),
        contract: serializeContract(contract),
      });
      const instance = runtime.factoryInstances.get(factory.id)!;
      instance.addInput(asId('ironOre'), 10);
      const depotTransform: WorldTransform = {
        position: gridPoint(x + 14, y + 8),
        size: gridSize(4, 4),
        rotation: 0,
      };
      // The depot owns its rail node at its hookup cell; traffic stays on the
      // fixture's synthetic hub node.
      runtime.addRailNode({
        id: asId(`fixture-depot-node-${i}`),
        position: hookupCell(depotTransform),
        kind: 'depot',
      });
      runtime.place({
        id: asId(`fixture-depot-${i}`),
        kind: 'depot',
        railNodeId: asId(`fixture-depot-node-${i}`),
        podCapacity: 2,
        podIds: [],
        transform: depotTransform,
        createdAt: 0n,
      });
    } else {
      const point = gridPoint(x + 14, y + 4),
        index = point.y * 256 + point.x;
      runtime.world.grid.oreKinds[index] = OreKind.IRON;
      runtime.world.grid.oreRemaining[index] = 100;
      const mine = runtime.createConstructionSite({
        targetKind: 'mine',
        transform: {
          position: gridPoint(x + 10, y + 4),
          size: gridSize(4, 4),
          rotation: 0,
        },
        stationId: stationB,
        cost: [],
        resourceId: asId('ironOre'),
      });
      runtime.placeDrill(mine.id, asId(`fixture-drill-${i}`), point);
      for (const cost of worldContent.drill.buildCost)
        runtime.traffic.stations
          .get(`drill-build:${mine.id}:${cost.resourceId}`)!
          .buffer!.add(cost.quantity);
    }
    runtime.addTrafficStation({
      id: `fixture-request-${i}`,
      railNodeId: b.id,
      role: 'requester',
      priority: 0,
      target: 500,
      minBatch: 1,
      maxBatch: 10,
      buffer: new WorldBuffer(resource, 500),
    });
    runtime.addTrafficStation({
      id: `fixture-depot-station-${i}`,
      railNodeId: b.id,
      role: 'depot',
      priority: 0,
      target: 0,
      minBatch: 0,
      maxBatch: 0,
      depotCapacity: 2,
    });
    for (let pod = 0; pod < 2; pod++)
      runtime.addPod(
        `fixture-pod-${i}-${pod}`,
        b.id,
        `fixture-depot-station-${i}`,
      );
  }
  runtime.setTimeControl(false, 1);
  runtime.advanceTo(1n);
  runtime.takeGridChanges();
  return runtime;
}
