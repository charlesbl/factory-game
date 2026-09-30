import { asId, gridPoint, gridSize, worldContent } from '../domain';
import type {
  FactoryId,
  GridPoint,
  InstanceId,
  ResourceId,
  StationId,
} from '../domain';
import { compileBlueprint, isContract, serializeContract } from '../compiler';
import { createDemoBlueprint } from '../ui/demo-blueprint';
import { generateWorld } from './generation';
import { WorldRuntime } from './runtime';
import { defaultWorldGenerationConfig, OreKind, TerrainKind } from './model';

/**
 * Deterministic world for stopped-machinery and drill-placement acceptance:
 * a factory stuck on WAITING_INPUT, a factory driven to OUTPUT_BLOCKED with an
 * undeliverable full output, an ACTIVE drill whose mine output is full while
 * its ore tile still holds stock, plus pristine tiles for every drill/mine
 * placement rule. No pods and no rails exist, so nothing can ever drain a
 * buffer or deliver an input. Layout is placed inside the spawn clearing.
 */
export interface StatesFixture {
  readonly runtime: WorldRuntime;
  /** Buffers the completion site to the exact cap; call before loadFixture. */
  armCompleteSite: () => void;
  readonly spawn: GridPoint;
  readonly ids: {
    readonly waitingFactory: string;
    readonly blockedFactory: string;
    readonly mine: string;
    readonly drill: string;
    readonly drillBuildStation: string;
    readonly mineHeadStation: string;
    readonly constructionSite: string;
    readonly completeSite: string;
  };
  readonly positions: {
    readonly waitingFactory: GridPoint;
    readonly blockedFactory: GridPoint;
    readonly mine: GridPoint;
    readonly drill: GridPoint;
    readonly waitingStation: GridPoint;
    readonly mineStation: GridPoint;
    readonly constructionSite: GridPoint;
    readonly completeSite: GridPoint;
  };
  readonly tiles: {
    /** Touches the mine directly; free for drill placement tests. */
    readonly chainFirst: GridPoint;
    /** Touches chainFirst only; accepted as a chained second drill. */
    readonly chainSecond: GridPoint;
    /** Matching ore but touches neither mine nor chain. */
    readonly disconnected: GridPoint;
    /** Copper ore under an iron-bound drill tool. */
    readonly wrongOre: GridPoint;
    /** Matching ore with zero stock. */
    readonly exhaustedOre: GridPoint;
    /** Copper ore tile under a candidate mine head. */
    readonly mineHeadOre: GridPoint;
    /** 4x4 mine-head position whose footprint covers mineHeadOre. */
    readonly mineHeadPosition: GridPoint;
    /** Adjacent free station required by mine-head validation. */
    readonly mineHeadStation: GridPoint;
  };
}

const forceCell = (
  runtime: WorldRuntime,
  x: number,
  y: number,
  ore: OreKind,
  remaining: number,
): void => {
  const index = y * runtime.world.grid.width + x;
  runtime.world.grid.terrain[index] = TerrainKind.BUILDABLE;
  runtime.world.grid.oreKinds[index] = ore;
  runtime.world.grid.oreRemaining[index] = remaining;
};

const placeStation = (
  runtime: WorldRuntime,
  stationId: StationId,
  entityId: string,
  position: GridPoint,
): void => {
  const node = runtime.placeControlNode('station', position);
  runtime.place({
    id: asId(entityId),
    kind: 'station',
    stationId,
    railNodeId: node.id,
    transform: { position, size: gridSize(2, 2), rotation: 0 },
    createdAt: 0n,
  });
};

export function createStatesFixture(): StatesFixture {
  const runtime = new WorldRuntime(
    generateWorld({
      ...defaultWorldGenerationConfig('world-states-v1'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    }),
  );
  const demo = createDemoBlueprint();
  const contract = compileBlueprint(demo);
  if (!isContract(contract)) throw new Error('States factory must compile');
  const footprint = serializeContract(contract).footprint;
  const fw = footprint.width;
  const fh = footprint.height;
  if (fw > 32 || fh > 12)
    throw new Error(
      `States fixture layout does not fit the spawn clearing: ${fw}x${fh}`,
    );
  const yA = 20;
  const yB = 22 + fh;
  const yM = 23 + 2 * fh;

  // The scenario only uses the spawn clearing; force it buildable and ore-free
  // up front so the fixture never depends on generated terrain or patches.
  for (let y = 20; y < 56; y++)
    for (let x = 20; x < 56; x++) forceCell(runtime, x, y, OreKind.NONE, 0);

  placeStation(
    runtime,
    asId<StationId>('states-station-a'),
    'states-station-a-entity',
    gridPoint(20, yA),
  );
  placeStation(
    runtime,
    asId<StationId>('states-station-b'),
    'states-station-b-entity',
    gridPoint(20, yB),
  );
  placeStation(
    runtime,
    asId<StationId>('states-station-mine'),
    'states-station-mine-entity',
    gridPoint(20, yM - 2),
  );
  placeStation(
    runtime,
    asId<StationId>('states-station-head'),
    'states-station-head-entity',
    gridPoint(31, yM + 1),
  );

  const waiting = runtime.createConstructionSite({
    targetKind: 'factory',
    transform: {
      position: gridPoint(22, yA),
      size: gridSize(fw, fh),
      rotation: 0,
    },
    stationId: asId<StationId>('states-station-a'),
    cost: [],
    factoryId: asId<FactoryId>('states-factory'),
    instanceId: asId<InstanceId>('states-factory-waiting'),
    contract: serializeContract(contract),
  });
  const blocked = runtime.createConstructionSite({
    targetKind: 'factory',
    transform: {
      position: gridPoint(22, yB),
      size: gridSize(fw, fh),
      rotation: 0,
    },
    stationId: asId<StationId>('states-station-b'),
    cost: [],
    factoryId: asId<FactoryId>('states-factory'),
    instanceId: asId<InstanceId>('states-factory-blocked'),
    contract: serializeContract(contract),
  });

  // Ore and placement tiles; the spawn clearing already guarantees buildable
  // ground, but each cell is forced so the fixture never depends on that.
  forceCell(runtime, 24, yM + 1, OreKind.IRON, 500); // active drill tile
  forceCell(runtime, 25, yM + 1, OreKind.IRON, 500); // chainSecond
  forceCell(runtime, 27, yM + 1, OreKind.IRON, 500); // disconnected
  forceCell(runtime, 24, yM + 2, OreKind.COPPER, 500); // wrongOre
  forceCell(runtime, 24, yM + 3, OreKind.IRON, 0); // exhaustedOre
  forceCell(runtime, 24, yM + 0, OreKind.IRON, 500); // chainFirst
  forceCell(runtime, 25, yM + 0, OreKind.IRON, 500); // chainSecond above tile
  forceCell(runtime, 33, yM + 1, OreKind.COPPER, 500); // mineHeadOre
  for (let y = yM; y <= yM + 3; y++)
    for (let x = 33; x <= 36; x++)
      if (!(x === 33 && y === yM + 1))
        forceCell(runtime, x, y, OreKind.NONE, 0); // mine-head footprint

  const mine = runtime.createConstructionSite({
    targetKind: 'mine',
    transform: {
      position: gridPoint(20, yM),
      size: gridSize(4, 4),
      rotation: 0,
    },
    stationId: asId<StationId>('states-station-mine'),
    cost: [],
    resourceId: asId<ResourceId>('ironOre'),
  });
  const mineId = mine.id;
  runtime.placeDrill(mineId, asId('states-drill'), gridPoint(24, yM + 1));

  // Drive the second factory into OUTPUT_BLOCKED by delivering real input
  // items into its station buffer until production fills the undeliverable
  // output and one more output unit of work is pending behind the full buffer.
  const blockedInstance = runtime.factoryInstances.get(blocked.id)!;
  const inputResource = [...blockedInstance.inputs.keys()][0]!;
  const inputBuffer = blockedInstance.inputs.get(inputResource)!;
  for (let guard = 0; guard < 500; guard++) {
    if (blockedInstance.state === 'OUTPUT_BLOCKED') break;
    while (inputBuffer.freeSpace > 0) inputBuffer.add(1);
    runtime.advanceTo(runtime.logicalTime + 1_000_000n);
  }
  if (blockedInstance.state !== 'OUTPUT_BLOCKED')
    throw new Error('States fixture failed to block the factory output');

  // Build the drill and let reported extraction fill the mine output until the
  // full buffer stops extraction while the drill stays ACTIVE.
  for (const cost of worldContent.drill.buildCost)
    runtime.traffic.stations
      .get(`drill-build:states-drill:${cost.resourceId}`)!
      .buffer!.add(cost.quantity);
  runtime.advanceTo(runtime.logicalTime + 1n);
  runtime.advanceTo(
    runtime.logicalTime + 150n * worldContent.drill.extractionIntervalTicks,
  );
  const mineRuntime = runtime.mines.get(mineId)!;
  if (mineRuntime.output.freeSpace !== 0)
    throw new Error('States fixture failed to fill the mine output');

  // Construction stages: a partially delivered storage site and a fully
  // buffered site the worker replaces only on its accepted advance. Both sit
  // below the mine-head tiles with their own hookup stations.
  const yC = yM + 5;
  placeStation(
    runtime,
    asId<StationId>('states-station-site'),
    'states-station-site-entity',
    gridPoint(38, yC),
  );
  placeStation(
    runtime,
    asId<StationId>('states-station-complete'),
    'states-station-complete-entity',
    gridPoint(44, yC),
  );
  const storageCost =
    worldContent.buildings.find((building) => building.kind === 'storage')
      ?.buildCost ?? [];
  const partialSite = runtime.createConstructionSite({
    targetKind: 'storage',
    transform: {
      position: gridPoint(40, yC),
      size: gridSize(4, 4),
      rotation: 0,
    },
    stationId: asId<StationId>('states-station-site'),
    cost: storageCost,
  });
  const completeSite = runtime.createConstructionSite({
    targetKind: 'storage',
    transform: {
      position: gridPoint(46, yC),
      size: gridSize(4, 4),
      rotation: 0,
    },
    stationId: asId<StationId>('states-station-complete'),
    cost: storageCost,
  });
  const deliverToSite = (
    siteId: string,
    resourceId: ResourceId,
    quantity: number,
  ): void => {
    const buffer = runtime.traffic.stations.get(
      `site:${siteId}:${resourceId}`,
    )?.buffer;
    if (buffer === undefined) return;
    buffer.add(Math.min(quantity, buffer.capacity) - buffer.quantity);
  };
  // Six iron plates (the largest cost row) sit at the partial site; one sync
  // publishes its per-resource delivered counts without completing it.
  const plates = [...storageCost].sort((a, b) => b.quantity - a.quantity)[0]!;
  deliverToSite(partialSite.id, plates.resourceId, 6);
  runtime.advanceTo(runtime.logicalTime + 1n);
  // The completion site ships unbuffered so unrelated advances never trigger
  // the accepted completion; the completion test arms it to the exact cap
  // before loading.
  const armCompleteSite = (): void => {
    for (const item of storageCost)
      deliverToSite(completeSite.id, item.resourceId, item.quantity);
  };

  // The seeded world presents as paused.
  runtime.setTimeControl(true, 1);

  runtime.takeGridChanges();
  runtime.takeDrillExtractionEvents();
  return {
    runtime,
    armCompleteSite,
    spawn: runtime.world.spawn,
    ids: {
      waitingFactory: waiting.id,
      blockedFactory: blocked.id,
      mine: mineId,
      drill: 'states-drill',
      drillBuildStation: 'drill-build:states-drill:ironPlate',
      mineHeadStation: 'states-station-head',
      constructionSite: partialSite.id,
      completeSite: completeSite.id,
    },
    positions: {
      waitingFactory: gridPoint(22, yA),
      blockedFactory: gridPoint(22, yB),
      mine: gridPoint(20, yM),
      drill: gridPoint(24, yM + 1),
      waitingStation: gridPoint(20, yA),
      mineStation: gridPoint(20, yM - 2),
      constructionSite: gridPoint(40, yC),
      completeSite: gridPoint(46, yC),
    },
    tiles: {
      chainFirst: gridPoint(24, yM),
      chainSecond: gridPoint(25, yM),
      disconnected: gridPoint(27, yM + 1),
      wrongOre: gridPoint(24, yM + 2),
      exhaustedOre: gridPoint(24, yM + 3),
      mineHeadOre: gridPoint(33, yM + 1),
      mineHeadPosition: gridPoint(33, yM),
      mineHeadStation: gridPoint(31, yM + 1),
    },
  };
}
