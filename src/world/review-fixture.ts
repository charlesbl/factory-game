import type { StationId } from '../domain';
import { asId, gridPoint, gridSize, worldContent } from '../domain';
import { WorldRuntime } from './runtime';
import { OreKind, TerrainKind, defaultWorldGenerationConfig } from './model';

/** Small current-schema fixture for real-worker ore/occupancy and scene acceptance. */
export function createReviewFixture() {
  const runtime = WorldRuntime.generate({
    ...defaultWorldGenerationConfig('world-review-v1'),
    width: 64,
    height: 64,
    spawnClearingSize: 24,
  });
  for (let y = 8; y < 24; y++)
    for (let x = 8; x < 26; x++) {
      const index = y * 64 + x;
      runtime.world.grid.terrain[index] = TerrainKind.BUILDABLE;
      runtime.world.grid.oreKinds[index] = OreKind.NONE;
      runtime.world.grid.oreRemaining[index] = 0;
    }
  const node = runtime.placeControlNode('station', gridPoint(10, 10));
  const stationId = asId<StationId>('review-station');
  runtime.place({
    id: asId('review-station-entity'),
    kind: 'station',
    stationId,
    railNodeId: node.id,
    transform: {
      position: gridPoint(10, 10),
      size: gridSize(2, 2),
      rotation: 0,
    },
    createdAt: 0n,
  });
  const oreIndex = 10 * 64 + 16;
  runtime.world.grid.oreKinds[oreIndex] = OreKind.IRON;
  runtime.world.grid.oreRemaining[oreIndex] = 1;
  const mine = runtime.createConstructionSite({
    targetKind: 'mine',
    transform: {
      position: gridPoint(12, 10),
      size: gridSize(4, 4),
      rotation: 0,
    },
    stationId,
    cost: [],
    resourceId: asId('ironOre'),
  });
  const mineId = mine.id;
  runtime.placeDrill(mineId, asId('review-drill'), gridPoint(16, 10));
  for (const cost of worldContent.drill.buildCost)
    runtime.traffic.stations
      .get(`drill-build:review-drill:${cost.resourceId}`)!
      .buffer!.add(cost.quantity);
  runtime.advanceTo(1n);
  runtime.takeGridChanges();
  return { runtime, oreIndex, mineId };
}
