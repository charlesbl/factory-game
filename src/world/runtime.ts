import { PresentationRecorder } from './presentation';
import { asId, gridPoint, gridSize, resources, worldContent } from '../domain';
import type {
  ConstructionSiteId,
  FactoryId,
  GridPoint,
  InstanceId,
  PodId,
  RailEdgeId,
  RailNodeId,
  ResourceId,
  SimTime,
  StationId,
  WorldEntityId,
} from '../domain';
import {
  PodTrafficSystem,
  RailNetwork,
  type SerializedPodTrafficState,
  type SerializedTrafficStation,
  type Station,
  type TrafficMission,
} from '../logistics';
import {
  deserializeContract,
  serializeContract,
  type FactoryContract,
  type SerializedFactoryContract,
} from '../compiler';
import {
  FactoryRuntimeInstance,
  WorldBuffer,
  type InstanceSnapshot,
} from '../simulation';
import { generateWorld } from './generation';
import {
  MAX_OCCUPANCY_SLOT,
  OreKind,
  TerrainKind,
  gridIndex,
  type ConstructionSiteWorldEntity,
  type DepotWorldEntity,
  type FactoryWorldEntity,
  type GeneratedWorld,
  type MineWorldEntity,
  type StationWorldEntity,
  type StorageWorldEntity,
  type WorldInventory,
  type WorldBuildingSnapshot,
  type WorldDiagnostic,
  type WorldEntity,
  type WorldGenerationConfig,
  type WorldItemStack,
  type WorldRailEdge,
  type WorldRailNode,
  type WorldSnapshot,
  type StationRuleMode,
  type WorldTransform,
  type WorldValidationResult,
} from './model';
import {
  hookupCell,
  occupy,
  occupiedCells,
  release,
  validatePlacement,
  validateRailPath,
} from './placement';
import { WorldEventQueue, type SerializedWorldEventQueue } from './scheduler';
import { MineRuntime, SharedInventory, SharedInventoryBuffer } from './systems';

const WORLD_ENTITY_KINDS = new Set<WorldEntity['kind']>([
  'factory',
  'mine',
  'drill',
  'station',
  'storage',
  'depot',
  'construction-site',
]);
const validateEntityBase = (entity: WorldEntity): void => {
  if (
    typeof entity !== 'object' ||
    entity === null ||
    typeof entity.id !== 'string'
  )
    throw new Error('Invalid world entity');
  asId<WorldEntityId>(entity.id);
  if (!WORLD_ENTITY_KINDS.has(entity.kind))
    throw new Error('Invalid world entity kind');
  if (typeof entity.createdAt !== 'bigint' || entity.createdAt < 0n)
    throw new Error('Invalid world entity creation time');
};
const stacks = (items: readonly WorldItemStack[]): readonly WorldItemStack[] =>
  [...items]
    .filter((item) => item.quantity > 0)
    .sort((a, b) => a.resourceId.localeCompare(b.resourceId));
const DRILL_BUILD_PREFIX = 'drill-build:';
const DRILL_SALVAGE_PREFIX = 'drill-salvage:';
const DRILL_SALVAGE_FALLBACK_PREFIX = 'drill-salvage-fallback:';
const RESTORATION_RETURN_PREFIX = 'restoration-return:';
const serializeTrafficStation = (
  station: Station,
): SerializedTrafficStation => ({
  id: station.id,
  railNodeId: station.railNodeId,
  role: station.role,
  priority: station.priority,
  target: station.target,
  ...(station.stockMaximum === undefined
    ? {}
    : { stockMaximum: station.stockMaximum }),
  minBatch: station.minBatch,
  maxBatch: station.maxBatch,
  ...(station.requestCreatedAt === undefined
    ? {}
    : { requestCreatedAt: station.requestCreatedAt }),
  ...(station.storageId === undefined ? {} : { storageId: station.storageId }),
  ...(station.storageFreeSpace === undefined
    ? {}
    : { storageFreeSpace: station.storageFreeSpace }),
  ...(station.berthVehicleId === undefined
    ? {}
    : { berthVehicleId: station.berthVehicleId }),
  ...(station.depotCapacity === undefined
    ? {}
    : { depotCapacity: station.depotCapacity }),
  ...(station.reservedDepotSlots === undefined
    ? {}
    : { reservedDepotSlots: station.reservedDepotSlots }),
  ...(station.buffer === undefined
    ? {}
    : { buffer: station.buffer.snapshot() }),
});
const stationBelongsToEntity = (
  stationId: string,
  entityId: WorldEntityId,
): boolean =>
  stationId.includes(':' + entityId + ':') ||
  stationId.endsWith(':' + entityId);
const drillBuildStationId = (ownerId: string, resourceId: ResourceId): string =>
  `${DRILL_BUILD_PREFIX}${ownerId}:${resourceId}`;
const adjacentTo = (a: WorldTransform, b: WorldTransform): boolean =>
  occupiedCells(a).some((one) =>
    occupiedCells(b).some(
      (two) => Math.abs(one.x - two.x) + Math.abs(one.y - two.y) === 1,
    ),
  );

export interface ConstructionTargetRecord {
  readonly siteId: WorldEntityId;
  readonly targetKind: 'factory' | 'mine' | 'storage' | 'depot';
  readonly transform: WorldTransform;
  readonly stationId: StationId;
  readonly cost: readonly WorldItemStack[];
  readonly factoryId?: FactoryId;
  readonly instanceId?: InstanceId;
  readonly resourceId?: ResourceId;
  readonly contract?: SerializedFactoryContract;
  /** Original factory state preserved while a cancelled dismantle is rebuilt. */
  readonly factoryRestoration?: DismantlingFactoryRecord;
  /** Original building state preserved while a cancelled dismantle is rebuilt. */
  readonly buildingRestoration?: DismantlingBuildingRecord;
}
export interface SerializedMineRecord {
  readonly entityId: string;
  readonly resourceId: ResourceId;
  readonly oreKind: OreKind;
  readonly drills: readonly {
    readonly id: string;
    readonly position: GridPoint;
    readonly placedAt: string;
    readonly state: 'GHOST' | 'ACTIVE' | 'EXHAUSTED';
  }[];
  readonly output: {
    readonly resourceId: ResourceId;
    readonly capacity: number;
    readonly quantity: number;
  };
}
export interface SerializedStorageRecord {
  readonly entityId: string;
  readonly capacity: number;
  readonly items: readonly WorldItemStack[];
}
export interface PodProductionRecord {
  readonly id: string;
  readonly depotId: WorldEntityId;
  readonly sequence: number;
  readonly state: 'ACTIVE' | 'PENDING' | 'EVACUATING';
}

export interface DismantlingFactoryRecord {
  readonly entityId: WorldEntityId;
  readonly contract: SerializedFactoryContract;
  readonly instance: InstanceSnapshot;
  readonly stations: readonly SerializedTrafficStation[];
  readonly recovered: readonly WorldItemStack[];
  readonly salvageMissionFloor?: number;
  readonly returnedSalvageMissionIds?: readonly string[];
}

export interface DismantlingBuildingRecord {
  readonly entityId: WorldEntityId;
  readonly stationId: StationId;
  readonly entity: MineWorldEntity | StorageWorldEntity | DepotWorldEntity;
  readonly stations: readonly SerializedTrafficStation[];
  readonly recovered: readonly WorldItemStack[];
  readonly storage?: SerializedStorageRecord;
  readonly mine?: SerializedMineRecord;
  readonly mineConstruction?: WorldInventory;
  readonly mineSalvage?: WorldInventory;
  readonly salvageMissionFloor?: number;
  readonly returnedSalvageMissionIds?: readonly string[];
}

export interface WorldOperationFailure {
  readonly targetId: string;
  readonly message: string;
}

export class WorldRuntime {
  readonly entities = new Map<WorldEntityId, WorldEntity>();
  readonly rails = new RailNetwork();
  traffic: PodTrafficSystem;
  eventQueue = new WorldEventQueue();
  readonly railNodes = new Map<string, WorldRailNode>();
  readonly railEdges = new Map<string, WorldRailEdge>();
  readonly diagnostics: WorldDiagnostic[] = [];
  readonly constructionTargets = new Map<
    WorldEntityId,
    ConstructionTargetRecord
  >();
  readonly mines = new Map<WorldEntityId, MineRuntime>();
  readonly factoryInstances = new Map<WorldEntityId, FactoryRuntimeInstance>();
  readonly factoryContracts = new Map<string, FactoryContract>();
  readonly dismantlingFactories = new Map<
    WorldEntityId,
    DismantlingFactoryRecord
  >();
  readonly dismantlingBuildings = new Map<
    WorldEntityId,
    DismantlingBuildingRecord
  >();
  readonly storageInventories = new Map<WorldEntityId, SharedInventory>();
  readonly podProductions = new Map<string, PodProductionRecord>();
  revision = 0;
  logicalTime: SimTime = 0n;
  paused = true;
  timeScale: 1 | 5 | 20 = 1;
  #nextSlot = 1;
  #railSequence = 0;
  #nextPodSequence = 1;
  readonly #slots = new Map<WorldEntityId, number>();
  readonly #scheduledMines = new Set<WorldEntityId>();
  readonly #scheduledFactories = new Set<WorldEntityId>();
  readonly #drillExtractionEvents = new Set<WorldEntityId>();
  #batchingDismantle = false;
  #dismantleDispatchPending = false;
  readonly presentation = new PresentationRecorder();
  readonly #oreChanges = new Map<number, number>();
  readonly #occupancyChanges = new Map<number, number>();
  constructor(readonly world: GeneratedWorld) {
    this.traffic = new PodTrafficSystem(this.rails);
  }
  static generate(config: WorldGenerationConfig): WorldRuntime {
    const runtime = new WorldRuntime(generateWorld(config));
    runtime.createStarterHub();
    runtime.revision = 0;
    return runtime;
  }

  private createStarterHub(): void {
    const spawn = this.world.spawn;
    const storageId = asId<WorldEntityId>('world-starter-storage');
    const stationEntityId = asId<WorldEntityId>('world-starter-station');
    const depotId = asId<WorldEntityId>('world-starter-depot');
    const stationId = asId<StationId>('station-starter-storage');
    const stationNode = asId<RailNodeId>('rail-starter-storage');
    const depotNode = asId<RailNodeId>('rail-starter-depot');
    const storageTransform: WorldTransform = {
      position: gridPoint(spawn.x - 10, spawn.y - 2),
      size: gridSize(4, 4),
      rotation: 0,
    };
    const stationTransform: WorldTransform = {
      position: gridPoint(spawn.x - 6, spawn.y - 1),
      size: gridSize(2, 2),
      rotation: 0,
    };
    const depotTransform: WorldTransform = {
      position: gridPoint(spawn.x + 4, spawn.y - 2),
      size: gridSize(4, 4),
      rotation: 0,
    };
    this.addRailNode({
      id: stationNode,
      position: hookupCell(stationTransform),
      kind: 'station',
    });
    this.addRailNode({
      id: depotNode,
      position: hookupCell(depotTransform),
      kind: 'depot',
    });
    const hubItems = [
      { resourceId: asId<ResourceId>('ironPlate'), quantity: 200 },
      { resourceId: asId<ResourceId>('copperWire'), quantity: 100 },
      { resourceId: asId<ResourceId>('circuit'), quantity: 40 },
    ];
    const inventory = new SharedInventory(500, [], hubItems);
    this.storageInventories.set(storageId, inventory);
    this.place({
      id: storageId,
      kind: 'storage',
      stationId,
      inventory: { capacity: 500, items: hubItems },
      limits: [],
      transform: storageTransform,
      createdAt: 0n,
    });
    this.place({
      id: stationEntityId,
      kind: 'station',
      stationId,
      railNodeId: stationNode,
      linkedEntityId: storageId,
      transform: stationTransform,
      createdAt: 0n,
    });
    this.place({
      id: depotId,
      kind: 'depot',
      railNodeId: depotNode,
      podCapacity: 8,
      transform: depotTransform,
      createdAt: 0n,
    });
    for (const resource of resources)
      this.traffic.stations.set(`hub:${resource.id}`, {
        id: `hub:${resource.id}`,
        railNodeId: stationNode,
        role: 'provider',
        buffer: new SharedInventoryBuffer(inventory, resource.id),
        priority: 0,
        target: 0,
        minBatch: 1,
        maxBatch: 10,
        storageId,
        storageFreeSpace: inventory.freeSpace,
      });
    this.addTrafficStation({
      id: 'depot:starter',
      railNodeId: depotNode,
      role: 'depot',
      priority: 0,
      target: 0,
      minBatch: 0,
      maxBatch: 0,
      depotCapacity: 8,
      reservedDepotSlots: 2,
    });
    this.addPod('pod-starter-1', depotNode, 'depot:starter');
    this.addPod('pod-starter-2', depotNode, 'depot:starter');
    this.ensureStorageDestinations(storageId, inventory);
  }

  private ensureStorageDestinations(
    entityId: WorldEntityId,
    inventory: SharedInventory,
  ): void {
    const entity = this.entities.get(entityId);
    if (entity?.kind !== 'storage') return;
    const station = this.stationEntity(entity.stationId);
    if (station === undefined) return;
    const candidates = [...this.traffic.stations.values()].filter(
      (candidate) =>
        candidate.storageId === entityId ||
        candidate.id.startsWith(`rule:${entityId}:`),
    );
    for (const resource of resources) {
      const id = `rule:${entityId}:${resource.id}`;
      const matches = candidates.filter(
        (candidate) => candidate.buffer?.resourceId === resource.id,
      );
      if (
        matches.length === 1 &&
        matches[0]!.id === id &&
        matches[0]!.role === 'storage' &&
        matches[0]!.buffer instanceof SharedInventoryBuffer &&
        matches[0]!.buffer.inventory === inventory
      )
        continue;
      const configured =
        matches.find((candidate) => candidate.id === id) ??
        matches.find((candidate) => candidate.role === 'requester');
      if (
        inventory.amount(resource.id) === 0 &&
        configured === undefined &&
        !matches.some((candidate) => this.stationHasActiveMission(candidate.id))
      ) {
        for (const candidate of matches)
          this.traffic.stations.delete(candidate.id);
        continue;
      }
      const target = configured?.target ?? 0;
      this.traffic.stations.set(id, {
        ...(configured ?? {}),
        id,
        railNodeId: station.railNodeId,
        role: 'storage',
        buffer: new SharedInventoryBuffer(inventory, resource.id),
        priority: configured?.priority ?? 0,
        target,
        stockMaximum: configured?.stockMaximum ?? target,
        minBatch: 1,
        maxBatch: 10,
        storageId: entityId,
        storageFreeSpace: inventory.freeSpace,
      });
      const legacy = matches
        .filter((candidate) => candidate.id !== id)
        .map((candidate) => candidate.id);
      if (legacy.length) this.traffic.redirectMissions(legacy, id);
      for (const legacyId of legacy) this.traffic.stations.delete(legacyId);
    }
  }

  place(entity: WorldEntity): void {
    validateEntityBase(entity);
    if (this.entities.has(entity.id)) throw new Error('Duplicate world entity');
    const result = validatePlacement(this.world.grid, entity.transform);
    if (!result.valid)
      throw new Error(`Invalid world placement: ${result.reason}`);
    if (this.#nextSlot > MAX_OCCUPANCY_SLOT)
      throw new RangeError('World entity occupancy slots are exhausted');
    const slot = this.#nextSlot++;
    occupy(this.world.grid, entity.transform, slot);
    for (const point of occupiedCells(entity.transform)) {
      const index = gridIndex(this.world.grid, point);
      this.#occupancyChanges.set(index, slot);
    }
    this.#slots.set(entity.id, slot);
    this.entities.set(entity.id, entity);
    this.changed();
  }
  remove(entityId: WorldEntityId): WorldEntity {
    const entity = this.entities.get(entityId);
    if (entity === undefined) throw new Error('Unknown world entity');
    const slot = this.#slots.get(entityId);
    if (slot === undefined)
      throw new Error('World entity is missing its occupancy slot');
    release(this.world.grid, entity.transform, slot);
    for (const point of occupiedCells(entity.transform)) {
      const index = gridIndex(this.world.grid, point);
      this.#occupancyChanges.set(index, 0);
    }
    this.#slots.delete(entityId);
    this.entities.delete(entityId);
    this.dismantlingFactories.delete(entityId);
    this.dismantlingBuildings.delete(entityId);
    if (entity.kind === 'station' || entity.kind === 'depot')
      this.releaseRailNode(entity);
    this.changed();
    return entity;
  }
  entitySlotRecords(): readonly {
    readonly entityId: WorldEntityId;
    readonly slot: number;
  }[] {
    return [...this.#slots]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([entityId, slot]) => ({ entityId, slot }));
  }
  get nextEntitySlot(): number {
    return this.#nextSlot;
  }
  get railSequence(): number {
    return this.#railSequence;
  }
  get nextPodSequence(): number {
    return this.#nextPodSequence;
  }
  restoreRailSequence(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('Invalid rail sequence');
    this.#railSequence = value;
  }
  restorePodProductions(
    records: readonly PodProductionRecord[],
    nextSequence: number,
  ): void {
    if (!Number.isSafeInteger(nextSequence) || nextSequence < 1)
      throw new Error('Invalid pod production sequence');
    this.#nextPodSequence = nextSequence;
    for (const record of records) {
      const depot = this.entities.get(record.depotId);
      if (depot?.kind !== 'depot')
        throw new Error('Serialized pod production depot is missing');
      this.podProductions.set(record.id, { ...record });
    }
  }
  restoreEntities(
    entities: readonly WorldEntity[],
    slots: readonly {
      readonly entityId: WorldEntityId;
      readonly slot: number;
    }[],
    nextSlot: number,
  ): void {
    if (this.entities.size !== 0 || this.#slots.size !== 0)
      throw new Error('World entities have already been initialised');
    if (
      !Number.isSafeInteger(nextSlot) ||
      nextSlot < 1 ||
      nextSlot > MAX_OCCUPANCY_SLOT + 1
    )
      throw new Error('Invalid next world entity slot');
    const byId = new Map<WorldEntityId, WorldEntity>();
    for (const entity of entities) {
      validateEntityBase(entity);
      if (byId.has(entity.id))
        throw new Error('Duplicate serialized world entity');
      byId.set(entity.id, entity);
    }
    const slotById = new Map<WorldEntityId, number>();
    const usedSlots = new Set<number>();
    for (const record of slots) {
      const entityId = asId<WorldEntityId>(record.entityId);
      if (
        !Number.isSafeInteger(record.slot) ||
        record.slot < 1 ||
        record.slot > MAX_OCCUPANCY_SLOT ||
        record.slot >= nextSlot ||
        slotById.has(entityId) ||
        usedSlots.has(record.slot)
      )
        throw new Error('Invalid serialized world entity slot');
      slotById.set(entityId, record.slot);
      usedSlots.add(record.slot);
    }
    if (
      slotById.size !== byId.size ||
      [...byId.keys()].some((id) => !slotById.has(id))
    )
      throw new Error('Serialized world entity slots do not match entities');
    const expected = new Int32Array(this.world.grid.occupancy.length);
    for (const [id, entity] of byId) {
      const slot = slotById.get(id)!;
      const result = validatePlacement(
        { ...this.world.grid, occupancy: expected },
        entity.transform,
      );
      if (!result.valid)
        throw new Error(`Invalid serialized world placement: ${result.reason}`);
      for (const point of occupiedCells(entity.transform))
        expected[gridIndex(this.world.grid, point)] = slot;
    }
    if (
      expected.some((slot, index) => slot !== this.world.grid.occupancy[index])
    )
      throw new Error('Serialized occupancy does not match world entities');
    for (const [id, entity] of byId) {
      this.entities.set(id, entity);
      this.#slots.set(id, slotById.get(id)!);
    }
    this.#nextSlot = nextSlot;
  }

  addRailNode(node: WorldRailNode): void {
    if (this.railNodes.has(node.id))
      throw new Error('Duplicate world rail node');
    this.rails.addNode({ id: node.id, position: node.position });
    this.railNodes.set(node.id, node);
    this.changed();
  }
  addRailEdge(edge: WorldRailEdge): void {
    if (
      edge.points.length < 2 ||
      edge.points.some(
        (point, index) =>
          index > 0 &&
          point.x !== edge.points[index - 1]!.x &&
          point.y !== edge.points[index - 1]!.y,
      )
    )
      throw new Error('World rail path must be orthogonal');
    this.rails.addEdge({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      length: edge.length,
      bidirectional: false,
    });
    this.railEdges.set(edge.id, edge);
    this.changed();
  }
  private pointOnRailSegment(
    point: GridPoint,
    a: GridPoint,
    b: GridPoint,
  ): boolean {
    return (
      (a.x === b.x &&
        point.x === a.x &&
        point.y >= Math.min(a.y, b.y) &&
        point.y <= Math.max(a.y, b.y)) ||
      (a.y === b.y &&
        point.y === a.y &&
        point.x >= Math.min(a.x, b.x) &&
        point.x <= Math.max(a.x, b.x))
    );
  }
  private railContainsInterior(edge: WorldRailEdge, point: GridPoint): boolean {
    const same = (other: GridPoint) =>
      other.x === point.x && other.y === point.y;
    return (
      !same(edge.points[0]!) &&
      !same(edge.points.at(-1)!) &&
      edge.points
        .slice(1)
        .some((end, i) => this.pointOnRailSegment(point, edge.points[i]!, end))
    );
  }
  private railEdgeInUse(edgeId: RailEdgeId): boolean {
    const block = this.rails.blocks.get('block:' + edgeId);
    return (
      block?.occupantId !== undefined ||
      block?.reservedById !== undefined ||
      [...this.traffic.pods.values()].some((pod) =>
        pod.route?.edgeIds.includes(edgeId),
      ) ||
      [...this.traffic.missions.values()].some(
        (mission) =>
          mission.status !== 'DELIVERED' &&
          (mission.approachRoute.edgeIds.includes(edgeId) ||
            mission.deliveryRoute.edgeIds.includes(edgeId)),
      )
    );
  }
  private assertRailConnectionsAvailable(points: readonly GridPoint[]): void {
    for (const edge of this.railEdges.values())
      if (
        points.some((point) => this.railContainsInterior(edge, point)) &&
        this.railEdgeInUse(edge.id)
      )
        throw new Error(
          'Cannot join this rail while a pod uses or has reserved its route. Connect at an existing endpoint or wait until the route is free.',
        );
  }
  private addDirectedRail(from: WorldRailNode, to: WorldRailNode): RailEdgeId {
    const duplicate = [...this.railEdges.values()].find(
      (edge) =>
        edge.from === from.id && edge.to === to.id && edge.points.length === 2,
    );
    if (duplicate) return duplicate.id;
    const id = asId<RailEdgeId>('rail-' + ++this.#railSequence);
    this.addRailEdge({
      id,
      from: from.id,
      to: to.id,
      points: [from.position, to.position],
      length:
        Math.abs(from.position.x - to.position.x) +
        Math.abs(from.position.y - to.position.y),
    });
    return id;
  }
  private connectRailsAt(position: GridPoint): WorldRailNode {
    const node =
      this.nodeAt(position) ?? this.createRailNode(position, 'endpoint');
    for (const edge of [...this.railEdges.values()]) {
      if (!this.railContainsInterior(edge, position)) continue;
      const points: GridPoint[] = [edge.points[0]!];
      for (let i = 1; i < edge.points.length; i++) {
        const previous = edge.points[i - 1]!,
          next = edge.points[i]!;
        if (
          this.pointOnRailSegment(position, previous, next) &&
          !(position.x === previous.x && position.y === previous.y) &&
          !(position.x === next.x && position.y === next.y)
        )
          points.push(position);
        points.push(next);
      }
      this.rails.removeEdge(edge.id);
      this.railEdges.delete(edge.id);
      for (let i = 1; i < points.length; i++) {
        const from =
          this.nodeAt(points[i - 1]!) ??
          this.createRailNode(points[i - 1]!, 'endpoint');
        const to =
          this.nodeAt(points[i]!) ??
          this.createRailNode(points[i]!, 'endpoint');
        if (from.id !== to.id) this.addDirectedRail(from, to);
      }
    }
    return node;
  }
  placeRailPath(points: readonly GridPoint[]): readonly RailEdgeId[] {
    const clearance = validateRailPath(this.world.grid, points);
    if (!clearance.valid) throw new Error(clearance.reason);
    const path = points.filter(
      (point, i) =>
        i === 0 || point.x !== points[i - 1]!.x || point.y !== points[i - 1]!.y,
    );
    if (path.length < 2)
      throw new Error('Rail path needs at least two distinct points');
    const connections = [
      ...path,
      ...[...this.railNodes.values()]
        .filter((node) =>
          path
            .slice(1)
            .some((end, i) =>
              this.pointOnRailSegment(node.position, path[i]!, end),
            ),
        )
        .map((node) => node.position),
    ];
    this.assertRailConnectionsAvailable(connections);
    for (const point of connections) this.connectRailsAt(point);
    const placed = new Set<RailEdgeId>();
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!,
        b = path[i]!;
      const dx = Math.sign(b.x - a.x),
        dy = Math.sign(b.y - a.y);
      const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      const nodes: WorldRailNode[] = [];
      for (let step = 0; step <= length; step++) {
        const point = gridPoint(a.x + dx * step, a.y + dy * step);
        nodes.push(
          this.nodeAt(point) ?? this.createRailNode(point, 'endpoint'),
        );
      }
      for (let j = 1; j < nodes.length; j++)
        placed.add(this.addDirectedRail(nodes[j - 1]!, nodes[j]!));
    }
    this.refreshAutomaticJunctions();
    return [...placed];
  }

  removeRailEdge(edgeId: RailEdgeId): void {
    const edge = this.railEdges.get(edgeId);
    if (edge === undefined) throw new Error('Unknown world rail edge');
    if (this.railEdgeInUse(edgeId))
      throw new Error('Rail edge is part of an active pod route');
    this.rails.removeEdge(edgeId);
    this.railEdges.delete(edgeId);
    for (const nodeId of [edge.from, edge.to]) {
      const node = this.railNodes.get(nodeId);
      const stillConnected = [...this.railEdges.values()].some(
        (candidate) => candidate.from === nodeId || candidate.to === nodeId,
      );
      if (node?.kind === 'endpoint' && !stillConnected) {
        this.rails.removeNode(nodeId);
        this.railNodes.delete(nodeId);
      }
    }
    this.refreshAutomaticJunctions();
    this.changed();
  }
  private refreshAutomaticJunctions(): void {
    for (const node of this.railNodes.values()) {
      if (node.kind === 'station' || node.kind === 'depot') continue;
      const neighbours = new Set<string>();
      for (const edge of this.railEdges.values()) {
        if (edge.from === node.id) neighbours.add(edge.to);
        if (edge.to === node.id) neighbours.add(edge.from);
      }
      const kind = neighbours.size >= 3 ? 'junction' : 'endpoint';
      if (node.kind !== kind) this.railNodes.set(node.id, { ...node, kind });
    }
  }
  placeControlNode(
    kind: 'junction' | 'station',
    position: GridPoint,
  ): WorldRailNode {
    // A station's rail control point is its hookup cell outside the building;
    // the building itself stays anchored at the command position.
    const transform: WorldTransform | undefined =
      kind === 'station'
        ? { position, size: worldContent.stationFootprint, rotation: 0 }
        : undefined;
    const target = transform === undefined ? position : hookupCell(transform);
    if (transform !== undefined) {
      const hookup = this.validateHookup(transform);
      if (!hookup.valid)
        throw new Error(`Invalid station hookup: ${hookup.reason}`);
    }
    const existing = this.nodeAt(target);
    if (existing && existing.kind !== 'endpoint' && existing.kind !== kind)
      throw new Error('Rail control point is occupied');
    this.assertRailConnectionsAvailable([target]);
    this.connectRailsAt(target);
    const connected = this.nodeAt(target)!;
    const upgraded = { ...connected, kind };
    this.railNodes.set(connected.id, upgraded);
    this.changed();
    return upgraded;
  }

  takeGridChanges(): {
    readonly oreChanges: readonly {
      readonly index: number;
      readonly remaining: number;
    }[];
    readonly occupancyChanges: readonly {
      readonly index: number;
      readonly slot: number;
    }[];
  } {
    const oreChanges = [...this.#oreChanges]
      .sort(([a], [b]) => a - b)
      .map(([index, remaining]) => ({ index, remaining }));
    const occupancyChanges = [...this.#occupancyChanges]
      .sort(([a], [b]) => a - b)
      .map(([index, slot]) => ({ index, slot }));
    this.#oreChanges.clear();
    this.#occupancyChanges.clear();
    return { oreChanges, occupancyChanges };
  }
  private createRailNode(
    position: GridPoint,
    kind: WorldRailNode['kind'],
  ): WorldRailNode {
    const node = {
      id: asId<RailNodeId>(`rail-node-${++this.#railSequence}`),
      position,
      kind,
    };
    this.addRailNode(node);
    return node;
  }
  private nodeAt(position: GridPoint): WorldRailNode | undefined {
    return [...this.railNodes.values()].find(
      (node) =>
        node.position.x === position.x && node.position.y === position.y,
    );
  }
  /** Removing a building releases its hookup node: deleted when nothing
   * references it, downgraded to a plain endpoint when rails or traffic still
   * do, so rebuilding on the same cell reclaims the node in place. */
  private releaseRailNode(entity: StationWorldEntity | DepotWorldEntity): void {
    const own = entity.kind === 'depot' ? `depot:${entity.id}` : undefined;
    const node = this.railNodes.get(entity.railNodeId);
    if (node === undefined) {
      if (own !== undefined) this.traffic.stations.delete(own);
      return;
    }
    const owned = [...this.entities.values()].some(
      (other) =>
        (other.kind === 'station' || other.kind === 'depot') &&
        other.railNodeId === node.id,
    );
    if (owned) return;
    const referenced =
      [...this.railEdges.values()].some(
        (edge) => edge.from === node.id || edge.to === node.id,
      ) ||
      [...this.traffic.stations].some(
        ([id, station]) => id !== own && station.railNodeId === node.id,
      );
    if (own !== undefined) this.traffic.stations.delete(own);
    if (referenced) this.railNodes.set(node.id, { ...node, kind: 'endpoint' });
    else this.railNodes.delete(node.id);
  }

  /** A station/depot hookup cell must be on the map, passable, free of other
   *  entities, and unclaimed by another station/depot rail node or by a pending
   *  depot construction site. */
  private validateHookup(transform: WorldTransform): WorldValidationResult {
    const cell = hookupCell(transform);
    const index = gridIndex(this.world.grid, cell);
    if (index < 0) return { valid: false, reason: 'HOOKUP_BLOCKED' };
    if (this.world.grid.terrain[index] === TerrainKind.OBSTACLE)
      return { valid: false, reason: 'HOOKUP_BLOCKED' };
    if (this.world.grid.occupancy[index] !== 0)
      return { valid: false, reason: 'HOOKUP_BLOCKED' };
    const node = this.nodeAt(cell);
    if (node !== undefined && node.kind !== 'endpoint')
      return { valid: false, reason: 'HOOKUP_BLOCKED' };
    for (const [id, target] of this.constructionTargets) {
      if (target.targetKind !== 'depot') continue;
      const site = this.entities.get(id);
      if (site?.kind !== 'construction-site' || site.state === 'EVACUATING')
        continue;
      const claimed = hookupCell(target.transform);
      if (claimed.x === cell.x && claimed.y === cell.y)
        return { valid: false, reason: 'HOOKUP_BLOCKED' };
    }
    return { valid: true };
  }

  validateGhost(
    targetKind: ConstructionTargetRecord['targetKind'],
    transform: WorldTransform,
    stationId?: StationId,
    resourceId?: ResourceId,
    restoringExistingMine = false,
  ): WorldValidationResult {
    const placement = validatePlacement(this.world.grid, transform);
    if (!placement.valid) return placement;
    if (targetKind === 'depot') {
      const hookup = this.validateHookup(transform);
      if (!hookup.valid) return hookup;
    }
    if (
      targetKind === 'mine' &&
      occupiedCells(transform).some(
        (point) =>
          this.world.grid.oreKinds[gridIndex(this.world.grid, point)] !==
          OreKind.NONE,
      )
    )
      return { valid: false, reason: 'ORE_MISMATCH' };
    if (
      targetKind === 'mine' &&
      resourceId !== undefined &&
      !restoringExistingMine
    ) {
      const oreKind =
        resourceId === asId<ResourceId>('ironOre')
          ? OreKind.IRON
          : OreKind.COPPER;
      const hasAccessibleOre = occupiedCells(transform).some((cell) =>
        [
          gridPoint(cell.x + 1, cell.y),
          gridPoint(cell.x - 1, cell.y),
          gridPoint(cell.x, cell.y + 1),
          gridPoint(cell.x, cell.y - 1),
        ].some((point) => {
          const index = gridIndex(this.world.grid, point);
          return (
            index >= 0 &&
            this.world.grid.oreKinds[index] === oreKind &&
            this.world.grid.oreRemaining[index] !== 0
          );
        }),
      );
      if (!hasAccessibleOre) return { valid: false, reason: 'ORE_MISMATCH' };
    }
    if (targetKind !== 'depot') {
      const station =
        stationId === undefined ? undefined : this.stationEntity(stationId);
      if (station === undefined || !adjacentTo(transform, station.transform))
        return { valid: false, reason: 'MISSING_STATION' };
      if (station.linkedEntityId !== undefined)
        return { valid: false, reason: 'STATION_IN_USE' };
    }
    if (targetKind === 'mine' && resourceId === undefined)
      return { valid: false, reason: 'ORE_MISMATCH' };
    return { valid: true };
  }
  validateInteraction(
    kind: 'drill' | 'station' | 'junction',
    position: GridPoint,
    mineId?: WorldEntityId,
  ): WorldValidationResult {
    const index = gridIndex(this.world.grid, position);
    if (index < 0) return { valid: false, reason: 'OUT_OF_BOUNDS' };
    if (kind !== 'junction') {
      const transform: WorldTransform = {
        position,
        size:
          kind === 'station'
            ? worldContent.stationFootprint
            : worldContent.drill.footprint,
        rotation: 0,
      };
      const placement = validatePlacement(this.world.grid, transform);
      if (!placement.valid) return placement;
      if (kind === 'station') {
        const hookup = this.validateHookup(transform);
        if (!hookup.valid) return hookup;
      }
    }
    if (kind === 'drill') {
      const mine = mineId ? this.mines.get(mineId) : undefined;
      if (!mine) return { valid: false, reason: 'NOT_CONNECTED' };
      if (
        this.world.grid.oreKinds[index] !== mine.oreKind ||
        this.world.grid.oreRemaining[index] === 0
      )
        return { valid: false, reason: 'ORE_MISMATCH' };
      try {
        mine.validateDrill(position);
      } catch {
        return { valid: false, reason: 'NOT_CONNECTED' };
      }
    } else {
      const node = this.nodeAt(position);
      if (node && node.kind !== 'endpoint' && node.kind !== kind)
        return { valid: false, reason: 'OCCUPIED' };
      if (
        [...this.railEdges.values()].some(
          (edge) =>
            this.railContainsInterior(edge, position) &&
            this.railEdgeInUse(edge.id),
        )
      )
        return { valid: false, reason: 'RAIL_IN_USE' };
    }
    return { valid: true };
  }
  createConstructionSite(
    target: Omit<ConstructionTargetRecord, 'siteId'>,
  ): ConstructionSiteWorldEntity {
    const id = asId<WorldEntityId>(
      `site-${this.revision + 1}-${this.entities.size + 1}`,
    );
    return this.createConstructionSiteAt(id, target);
  }
  private createConstructionSiteAt(
    id: WorldEntityId,
    target: Omit<ConstructionTargetRecord, 'siteId'>,
  ): ConstructionSiteWorldEntity {
    if (this.entities.has(id)) throw new Error('Construction site ID exists');
    const validation = this.validateGhost(
      target.targetKind,
      target.transform,
      target.stationId,
      target.resourceId,
      target.buildingRestoration?.mine !== undefined,
    );
    if (!validation.valid)
      throw new Error(`Invalid construction site: ${validation.reason}`);
    const siteId = asId<ConstructionSiteId>(`construction-${id}`);
    const entity: ConstructionSiteWorldEntity = {
      id,
      kind: 'construction-site',
      siteId,
      targetKind: target.targetKind,
      stationId: target.stationId,
      required: stacks(target.cost),
      delivered: [],
      state: target.cost.length === 0 ? 'READY' : 'WAITING',
      transform: target.transform,
      createdAt: this.logicalTime,
    };
    this.place(entity);
    this.constructionTargets.set(id, { ...target, siteId: id });
    const stationEntity = this.stationEntity(target.stationId);
    if (stationEntity !== undefined)
      this.entities.set(stationEntity.id, {
        ...stationEntity,
        linkedEntityId: id,
      });
    const deliveryNodeId =
      stationEntity?.railNodeId ??
      (target.targetKind === 'depot'
        ? (
            this.nodeAt(hookupCell(target.transform)) ??
            this.createRailNode(hookupCell(target.transform), 'endpoint')
          ).id
        : undefined);
    for (const item of target.cost) {
      const railNodeId = deliveryNodeId;
      if (railNodeId === undefined) continue;
      this.addTrafficStation({
        id: this.siteStationId(id, item.resourceId),
        railNodeId,
        role: 'requester',
        buffer: new WorldBuffer(item.resourceId, item.quantity),
        priority:
          target.factoryRestoration === undefined &&
          target.buildingRestoration === undefined
            ? 100
            : 1000,
        target: item.quantity,
        minBatch: 1,
        maxBatch: 10,
        requestCreatedAt: this.logicalTime,
      });
    }
    this.syncConstruction();
    this.dispatch();
    return this.entities.get(id) as ConstructionSiteWorldEntity;
  }
  cancelConstruction(siteId: WorldEntityId): void {
    const site = this.entities.get(siteId);
    if (site?.kind !== 'construction-site')
      throw new Error('Unknown construction site');
    for (const item of site.required) {
      const stationId = this.siteStationId(siteId, item.resourceId);
      const station = this.traffic.stations.get(stationId);
      if (station !== undefined)
        this.traffic.stations.set(stationId, {
          ...station,
          role: 'provider',
          target: 0,
          priority: 1000,
        });
    }
    this.entities.set(siteId, { ...site, state: 'EVACUATING' });
    this.changed();
    this.syncEvacuation();
  }
  dismantleEntity(entityId: WorldEntityId): StationId {
    const entity = this.entities.get(entityId);
    if (entity?.kind === 'station') {
      if (entity.linkedEntityId !== undefined)
        throw new Error('Dismantle or cancel the linked building first');
      if (
        [...this.traffic.stations.values()].some(
          (station) => station.railNodeId === entity.railNodeId,
        ) ||
        [...this.traffic.pods.values()].some(
          (pod) => pod.nodeId === entity.railNodeId,
        ) ||
        this.stationHasActiveMission(entity.stationId)
      )
        throw new Error(
          'This station is still used by logistics or a pod; let deliveries finish first',
        );
      this.remove(entityId);
      this.dispatch();
      this.changed();
      return entity.stationId;
    }
    if (entity?.kind === 'drill') {
      const mine = this.mines.get(entity.mineId);
      const mineEntity = this.entities.get(entity.mineId);
      if (mine === undefined || mineEntity?.kind !== 'mine')
        throw new Error('The drill’s mine is unavailable');
      if (mineEntity.dismantling === true)
        throw new Error('The mine is already being dismantled');
      const station = this.stationEntity(mineEntity.stationId);
      if (station === undefined)
        throw new Error('Dismantling a drill requires its mine station');
      const drill = mine.drills.get(entityId);
      if (drill === undefined) throw new Error('Unknown drill');
      const wasBuilt = drill.state !== 'GHOST';
      mine.dismantleDrill(entityId);
      if (wasBuilt)
        for (const item of worldContent.drill.buildCost) {
          mine.salvage.remove(item.resourceId, item.quantity);
          this.addDrillSalvage(
            entityId,
            station.railNodeId,
            item.resourceId,
            item.quantity,
          );
        }
      else {
        const hasDedicatedRequests = worldContent.drill.buildCost.every(
          (item) =>
            this.traffic.stations.has(
              drillBuildStationId(entityId, item.resourceId),
            ),
        );
        if (!hasDedicatedRequests)
          for (const item of worldContent.drill.buildCost) {
            const buildStation = this.traffic.stations.get(
              drillBuildStationId(mineEntity.id, item.resourceId),
            );
            if (buildStation !== undefined)
              this.traffic.stations.set(buildStation.id, {
                ...buildStation,
                target: Math.max(0, buildStation.target - item.quantity),
              });
          }
      }
      this.remove(entityId);
      this.#drillExtractionEvents.delete(entityId);
      if (
        ![...mine.drills.values()].some((drill) => drill.state === 'ACTIVE')
      ) {
        this.eventQueue.cancel('MINE_EXTRACT', mineEntity.id);
        this.#scheduledMines.delete(mineEntity.id);
      }
      this.syncDrillConstruction();
      this.syncCancelledDrillBuilds();
      this.syncDrillSalvage();
      this.dispatch();
      this.changed();
      return mineEntity.stationId;
    }
    if (entity === undefined || entity.kind === 'construction-site')
      throw new Error('Entity cannot be dismantled as a major building');
    if (entity.kind === 'factory' && entity.state === 'DISMANTLING')
      throw new Error('Factory is already being dismantled');
    if (
      (entity.kind === 'mine' ||
        entity.kind === 'storage' ||
        entity.kind === 'depot') &&
      entity.dismantling === true
    )
      throw new Error('Building is already being dismantled');
    if (entity.kind === 'depot') {
      if (
        [...this.podProductions.values()].some(
          (production) => production.depotId === entityId,
        )
      )
        throw new Error('Cancel this depot production queue first');
      if (
        this.globalPodCapacity() - entity.podCapacity <
        this.traffic.pods.size + this.reservedPodProductionCount()
      )
        throw new Error('Dismantling would exceed global pod capacity');
    }
    const station = [...this.entities.values()].find(
      (candidate) =>
        candidate.kind === 'station' && candidate.linkedEntityId === entityId,
    ) as Extract<WorldEntity, { kind: 'station' }> | undefined;
    if (station === undefined)
      throw new Error('Dismantling requires the linked external station');
    const recovered = new Map<ResourceId, number>();
    const salvageMissionFloor = this.latestMissionSequence();
    let relatedStations: Station[];
    const add = (resourceId: ResourceId, quantity: number) =>
      recovered.set(resourceId, (recovered.get(resourceId) ?? 0) + quantity);
    if (entity.kind === 'factory') {
      const instance = this.factoryInstances.get(entityId);
      if (instance === undefined) throw new Error('Factory runtime is missing');
      relatedStations = [...this.traffic.stations.values()].filter(
        (candidate) => stationBelongsToEntity(candidate.id, entityId),
      );
      instance.advanceTo(this.logicalTime);
      const instanceBuffers = [
        ...instance.inputs.values(),
        ...instance.outputs.values(),
      ];
      const countedBuffers = new Set(instanceBuffers);
      for (const buffer of instanceBuffers)
        add(buffer.resourceId, buffer.quantity);
      for (const item of instance.contract.billOfMaterials ?? [])
        add(item.resourceId, item.quantity);
      // Factory rules can hold additional stock beyond the runtime input and
      // output buffers. Include every distinct station buffer in the salvage
      // total so a cancelled dismantle can restore it without creating items.
      for (const candidate of relatedStations) {
        if (
          candidate.buffer === undefined ||
          countedBuffers.has(candidate.buffer)
        )
          continue;
        countedBuffers.add(candidate.buffer);
        add(candidate.buffer.resourceId, candidate.buffer.quantity);
      }
      this.dismantlingFactories.set(entityId, {
        entityId,
        contract: serializeContract(instance.contract),
        instance: instance.getSnapshot(),
        stations: relatedStations.map(serializeTrafficStation),
        recovered: [...recovered].map(([resourceId, quantity]) => ({
          resourceId,
          quantity,
        })),
        salvageMissionFloor,
      });
      this.factoryInstances.delete(entityId);
      if (
        ![...this.factoryInstances.values()].some(
          (other) =>
            other.contract.blueprintHash === instance.contract.blueprintHash,
        )
      )
        this.factoryContracts.delete(instance.contract.blueprintHash);
      this.eventQueue.cancel('FACTORY', entityId);
      this.#scheduledFactories.delete(entityId);
    } else {
      const storage =
        entity.kind === 'storage'
          ? this.storageInventories.get(entityId)
          : undefined;
      const mine =
        entity.kind === 'mine' ? this.mines.get(entityId) : undefined;
      if (entity.kind === 'storage' && storage === undefined)
        throw new Error('Storage inventory is missing');
      if (entity.kind === 'mine' && mine === undefined)
        throw new Error('Mine runtime is missing');

      const drillIds = mine === undefined ? [] : [...mine.drills.keys()];
      relatedStations = [...this.traffic.stations.values()].filter(
        (candidate) =>
          stationBelongsToEntity(candidate.id, entityId) ||
          candidate.storageId === entityId ||
          drillIds.some((drillId) =>
            stationBelongsToEntity(candidate.id, drillId),
          ),
      );
      const countedBuffers = new Set<WorldBuffer>();
      const countedInventories = new Set<SharedInventory>();
      if (storage !== undefined) {
        for (const item of storage.snapshot())
          add(item.resourceId, item.quantity);
        countedInventories.add(storage);
      }
      if (mine !== undefined) {
        add(mine.resourceId, mine.output.quantity);
        countedBuffers.add(mine.output);
        for (const item of mine.construction.snapshot())
          add(item.resourceId, item.quantity);
        for (const item of mine.salvage.snapshot())
          add(item.resourceId, item.quantity);
        for (const drill of mine.drills.values())
          if (drill.state !== 'GHOST')
            for (const item of worldContent.drill.buildCost)
              add(item.resourceId, item.quantity);
      }
      for (const item of worldContent.buildings.find(
        (building) => building.kind === entity.kind,
      )!.buildCost)
        add(item.resourceId, item.quantity);
      for (const candidate of relatedStations) {
        const buffer = candidate.buffer;
        if (buffer === undefined) continue;
        if (buffer instanceof SharedInventoryBuffer) {
          if (storage === buffer.inventory) continue;
          if (countedInventories.has(buffer.inventory)) continue;
          countedInventories.add(buffer.inventory);
          for (const item of buffer.inventory.snapshot())
            add(item.resourceId, item.quantity);
        } else if (!countedBuffers.has(buffer)) {
          countedBuffers.add(buffer);
          add(buffer.resourceId, buffer.quantity);
        }
      }

      const mineRecord =
        mine === undefined
          ? undefined
          : this.mineRecords().find((record) => record.entityId === entityId);
      const record: DismantlingBuildingRecord = {
        entityId,
        stationId: station.stationId,
        entity,
        stations: relatedStations.map(serializeTrafficStation),
        recovered: stacks(
          [...recovered].map(([resourceId, quantity]) => ({
            resourceId,
            quantity,
          })),
        ),
        salvageMissionFloor,
        ...(storage === undefined
          ? {}
          : {
              storage: {
                entityId,
                capacity: storage.capacity,
                items: storage.snapshot(),
              },
            }),
        ...(mineRecord === undefined ? {} : { mine: mineRecord }),
        ...(mine === undefined
          ? {}
          : {
              mineConstruction: {
                capacity: mine.construction.capacity,
                items: mine.construction.snapshot(),
              },
              mineSalvage: {
                capacity: mine.salvage.capacity,
                items: mine.salvage.snapshot(),
              },
            }),
      };
      this.dismantlingBuildings.set(entityId, record);

      if (storage !== undefined) {
        for (const item of storage.snapshot())
          storage.remove(item.resourceId, item.quantity);
        this.storageInventories.delete(entityId);
      }
      if (mine !== undefined) {
        this.mines.delete(entityId);
        this.eventQueue.cancel('MINE_EXTRACT', entityId);
        this.#scheduledMines.delete(entityId);
        for (const drillId of drillIds)
          this.#drillExtractionEvents.delete(drillId);
      }
    }
    const clearedBuffers = new Set<WorldBuffer>();
    for (const candidate of relatedStations) {
      const buffer = candidate.buffer;
      if (buffer === undefined || buffer instanceof SharedInventoryBuffer)
        continue;
      if (clearedBuffers.has(buffer)) continue;
      clearedBuffers.add(buffer);
      if (buffer.quantity > 0) buffer.remove(buffer.quantity);
    }
    for (const candidate of relatedStations) {
      const id = candidate.id;
      const current = this.traffic.stations.get(id);
      if (current === undefined) continue;
      if (!this.stationHasActiveMission(id)) {
        if (id === `depot:${entityId}`) continue;
        this.traffic.stations.delete(id);
      } else if (current.buffer !== undefined) {
        const { storageId, storageFreeSpace, ...withoutStorage } = current;
        void storageId;
        void storageFreeSpace;
        this.traffic.stations.set(id, {
          ...withoutStorage,
          role: 'active-provider',
          target: 0,
          priority: 1000,
        });
      }
    }
    if (entity.kind !== 'factory')
      this.entities.set(entityId, { ...entity, dismantling: true });
    for (const [resourceId, quantity] of recovered) {
      const buffer = new WorldBuffer(resourceId, quantity, quantity);
      this.addTrafficStation({
        id: `salvage:${entityId}:${resourceId}`,
        railNodeId: station.railNodeId,
        role: 'active-provider',
        buffer,
        priority: 1000,
        target: 0,
        minBatch: 1,
        maxBatch: 10,
      });
    }
    if (entity.kind === 'factory') {
      this.entities.set(entityId, {
        ...entity,
        state: 'DISMANTLING',
      } as FactoryWorldEntity);
      this.dispatch();
      this.changed();
      return station.stationId;
    }
    // Other building types keep their footprint and linked station until all
    // active salvage deliveries and recovered stock have cleared.
    this.dispatch();
    this.changed();
    return station.stationId;
  }
  private factoryDismantleCancelable(entityId: WorldEntityId): boolean {
    const entity = this.entities.get(entityId);
    return (
      entity?.kind === 'factory' &&
      entity.state === 'DISMANTLING' &&
      this.dismantlingFactories.has(entityId)
    );
  }
  private buildingDismantleCancelable(entityId: WorldEntityId): boolean {
    const entity = this.entities.get(entityId);
    return (
      (entity?.kind === 'mine' ||
        entity?.kind === 'storage' ||
        entity?.kind === 'depot') &&
      entity.dismantling === true &&
      this.dismantlingBuildings.has(entityId)
    );
  }
  cancelDismantle(entityId: WorldEntityId): void {
    const entity = this.entities.get(entityId);
    const record = this.dismantlingFactories.get(entityId);
    if (entity?.kind === 'factory' && entity.state === 'DISMANTLING') {
      if (record === undefined)
        throw new Error('This saved dismantling job cannot be cancelled');
      const station = this.stationEntity(entity.stationId);
      if (station === undefined)
        throw new Error('The factory station is no longer available');
      const { linkedEntityId, ...unlinkedStation } = station;
      void linkedEntityId;
      this.entities.set(station.id, unlinkedStation);
      // Keep the original entity ID and footprint. Salvage missions already in
      // flight keep their station addresses; the construction request pulls the
      // full recovered amount back through normal logistics without minting it.
      this.remove(entityId);
      this.createConstructionSiteAt(entityId, {
        targetKind: 'factory',
        transform: entity.transform,
        stationId: entity.stationId,
        cost: record.recovered,
        factoryId: entity.factoryId,
        instanceId: entity.instanceId,
        contract: record.contract,
        factoryRestoration: {
          ...record,
          returnedSalvageMissionIds: [],
        },
      });
      this.dispatch();
      this.changed();
      return;
    }

    const building = this.dismantlingBuildings.get(entityId);
    if (!this.buildingDismantleCancelable(entityId) || building === undefined)
      throw new Error('Building is not being dismantled');
    const station = this.stationEntity(building.stationId);
    if (station === undefined)
      throw new Error('The building station is no longer available');
    const { linkedEntityId, ...unlinkedStation } = station;
    void linkedEntityId;
    this.entities.set(station.id, unlinkedStation);
    this.remove(entityId);
    this.createConstructionSiteAt(entityId, {
      targetKind: building.entity.kind,
      transform: building.entity.transform,
      stationId: building.stationId,
      cost: building.recovered,
      ...(building.entity.kind === 'mine'
        ? { resourceId: building.entity.resourceId }
        : {}),
      buildingRestoration: {
        ...building,
        returnedSalvageMissionIds: [],
      },
    });
    this.dispatch();
    this.changed();
  }
  destroyDismantledEntity(entityId: WorldEntityId): void {
    const entity = this.entities.get(entityId);
    // Older saves retain the dismantling state and salvage stations without
    // restoration records. Permanent destruction does not need those records.
    if (
      !(entity?.kind === 'factory' && entity.state === 'DISMANTLING') &&
      !this.buildingDismantleCancelable(entityId)
    )
      throw new Error('Building is not being dismantled');

    const building = this.dismantlingBuildings.get(entityId);
    const factory = this.dismantlingFactories.get(entityId);
    const stationIds = new Set<string>([
      ...(building?.stations.map((station) => station.id) ?? []),
      ...(factory?.stations.map((station) => station.id) ?? []),
    ]);
    for (const id of this.traffic.stations.keys())
      if (
        stationBelongsToEntity(id, entityId) ||
        id.startsWith(`salvage:${entityId}:`) ||
        id.startsWith(`salvage-fallback:${entityId}:`)
      )
        stationIds.add(id);

    this.traffic.abandonMissionsForStations([...stationIds], this.logicalTime);
    for (const id of stationIds) this.traffic.stations.delete(id);

    if (building?.entity.kind === 'mine') {
      this.eventQueue.cancel('MINE_EXTRACT', entityId);
      this.#scheduledMines.delete(entityId);
      this.mines.delete(entityId);
      for (const drill of building.mine?.drills ?? []) {
        const drillId = asId<WorldEntityId>(drill.id);
        if (this.entities.has(drillId)) this.remove(drillId);
        this.#drillExtractionEvents.delete(drillId);
      }
    }
    if (building?.entity.kind === 'storage')
      this.storageInventories.delete(entityId);
    const linkedStation = [...this.entities.values()].find(
      (candidate) =>
        candidate.kind === 'station' && candidate.linkedEntityId === entityId,
    );
    this.remove(entityId);
    if (linkedStation?.kind === 'station') {
      const { linkedEntityId, ...unlinked } = linkedStation;
      void linkedEntityId;
      this.entities.set(linkedStation.id, unlinked);
    }
    this.syncCancelledDrillBuilds();
    this.syncDrillSalvage();
    this.dispatch();
    this.changed();
  }
  dismantleSelection(
    entityIds: readonly WorldEntityId[],
    railEdgeIds: readonly RailEdgeId[],
  ): readonly WorldOperationFailure[] {
    const failures: WorldOperationFailure[] = [];
    const uniqueEntityIds = [...new Set(entityIds)];
    uniqueEntityIds.sort((a, b) => {
      const priority = (id: WorldEntityId) => {
        const entity = this.entities.get(id);
        return entity?.kind === 'drill'
          ? 0
          : entity?.kind === 'station'
            ? 2
            : 1;
      };
      return priority(a) - priority(b) || a.localeCompare(b);
    });
    this.#batchingDismantle = true;
    try {
      for (const entityId of uniqueEntityIds) {
        if (!this.entities.has(entityId)) continue;
        try {
          this.dismantleEntity(entityId);
        } catch (error) {
          failures.push({
            targetId: entityId,
            message:
              error instanceof Error ? error.message : 'Dismantling failed',
          });
        }
      }
    } finally {
      this.#batchingDismantle = false;
      if (this.#dismantleDispatchPending) {
        this.#dismantleDispatchPending = false;
        this.dispatch();
      }
    }
    for (const edgeId of new Set(railEdgeIds)) {
      if (!this.railEdges.has(edgeId)) continue;
      try {
        this.removeRailEdge(edgeId);
      } catch (error) {
        failures.push({
          targetId: edgeId,
          message:
            error instanceof Error ? error.message : 'Rail removal failed',
        });
      }
    }
    return failures;
  }
  replaceFactory(
    entityId: WorldEntityId,
    target: Omit<
      ConstructionTargetRecord,
      'siteId' | 'stationId' | 'targetKind'
    >,
  ): void {
    if (this.entities.get(entityId)?.kind !== 'factory')
      throw new Error('Replacement requires a factory');
    const stationId = this.dismantleEntity(entityId);
    // Recovery remains at the external station; replacement needs the old
    // footprint released before authoritative construction validation.
    this.remove(entityId);
    const station = this.stationEntity(stationId)!;
    const { linkedEntityId, ...unlinked } = station;
    void linkedEntityId;
    this.entities.set(station.id, unlinked);
    this.createConstructionSite({
      ...target,
      targetKind: 'factory',
      stationId,
    });
  }
  private syncConstruction(): void {
    for (const [id, target] of [...this.constructionTargets].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const site = this.entities.get(id);
      if (site?.kind !== 'construction-site' || site.state === 'EVACUATING')
        continue;
      const delivered = target.cost.map((item) => ({
        resourceId: item.resourceId,
        quantity:
          this.traffic.stations.get(this.siteStationId(id, item.resourceId))
            ?.buffer?.quantity ?? 0,
      }));
      const ready =
        target.cost.every(
          (item) =>
            delivered.find((entry) => entry.resourceId === item.resourceId)
              ?.quantity === item.quantity,
        ) && this.restorationMissionsClear(target);
      this.entities.set(id, {
        ...site,
        delivered,
        state: ready ? 'READY' : 'WAITING',
      });
      if (ready) this.completeConstruction(id);
    }
  }
  private completeConstruction(siteId: WorldEntityId): void {
    const target = this.constructionTargets.get(siteId);
    const site = this.entities.get(siteId);
    if (target === undefined || site?.kind !== 'construction-site') return;
    const restoration = target.factoryRestoration;
    const buildingRestoration = target.buildingRestoration;
    if (!this.restorationMissionsClear(target)) return;
    const constructionBuffers = new Map<ResourceId, WorldBuffer>();
    for (const item of target.cost) {
      const station = this.traffic.stations.get(
        this.siteStationId(siteId, item.resourceId),
      );
      if (station?.buffer !== undefined)
        constructionBuffers.set(item.resourceId, station.buffer);
    }
    for (const item of target.cost)
      this.traffic.stations.delete(this.siteStationId(siteId, item.resourceId));
    const consumeRestoration = (resourceId: ResourceId, quantity: number) => {
      if (quantity <= 0) return;
      const buffer = constructionBuffers.get(resourceId);
      if (buffer === undefined || buffer.quantity < quantity)
        throw new Error('Building restoration is missing delivered materials');
      buffer.remove(quantity);
    };
    this.remove(siteId);
    this.constructionTargets.delete(siteId);
    if (target.targetKind === 'storage') {
      const savedStorage = buildingRestoration?.storage;
      const inventory = new SharedInventory(
        savedStorage?.capacity ?? worldContent.storageCapacity,
        [],
        savedStorage?.items ?? [],
      );
      if (buildingRestoration !== undefined && savedStorage !== undefined) {
        for (const item of worldContent.buildings.find(
          (building) => building.kind === 'storage',
        )!.buildCost)
          consumeRestoration(item.resourceId, item.quantity);
        for (const item of savedStorage.items)
          consumeRestoration(item.resourceId, item.quantity);
        for (const saved of buildingRestoration.stations) {
          if (
            saved.buffer === undefined ||
            saved.storageId === siteId ||
            saved.id.startsWith(`storage:${siteId}:`) ||
            saved.id.startsWith('hub:')
          )
            continue;
          consumeRestoration(saved.buffer.resourceId, saved.buffer.quantity);
        }
        const extraInventory = new Map<ResourceId, number>();
        for (const saved of buildingRestoration.stations) {
          if (saved.storageId !== siteId || saved.buffer === undefined)
            continue;
          const incoming =
            this.traffic.stations.get(saved.id)?.buffer?.quantity ?? 0;
          extraInventory.set(
            saved.buffer.resourceId,
            Math.max(
              extraInventory.get(saved.buffer.resourceId) ?? 0,
              incoming,
            ),
          );
        }
        for (const [resourceId, quantity] of extraInventory)
          if (quantity > 0) inventory.add(resourceId, quantity);
      }
      this.storageInventories.set(siteId, inventory);
      this.place({
        id: siteId,
        kind: 'storage',
        stationId: target.stationId,
        inventory: {
          capacity: inventory.capacity,
          items: inventory.snapshot(),
        },
        limits:
          buildingRestoration?.entity.kind === 'storage'
            ? buildingRestoration.entity.limits
            : [],
        transform: target.transform,
        createdAt: buildingRestoration?.entity.createdAt ?? this.logicalTime,
      });
      if (buildingRestoration !== undefined)
        this.restoreBuildingStations(buildingRestoration, inventory);
      this.ensureStorageDestinations(siteId, inventory);
    } else if (target.targetKind === 'depot') {
      // A depot owns its rail node at its hookup cell outside its footprint;
      // paid construction delivery still runs through its station.
      const cell = hookupCell(target.transform);
      const connected = this.nodeAt(cell) ?? this.createRailNode(cell, 'depot');
      const own =
        connected.kind === 'endpoint'
          ? { ...connected, kind: 'depot' as const }
          : connected;
      this.railNodes.set(own.id, own);
      this.place({
        id: siteId,
        kind: 'depot',
        railNodeId: own.id,
        podCapacity:
          buildingRestoration?.entity.kind === 'depot'
            ? buildingRestoration.entity.podCapacity
            : worldContent.depotCapacity,
        transform: target.transform,
        createdAt: buildingRestoration?.entity.createdAt ?? this.logicalTime,
      });
      if (buildingRestoration !== undefined) {
        for (const item of worldContent.buildings.find(
          (building) => building.kind === 'depot',
        )!.buildCost)
          consumeRestoration(item.resourceId, item.quantity);
        for (const saved of buildingRestoration.stations)
          if (saved.buffer !== undefined)
            consumeRestoration(saved.buffer.resourceId, saved.buffer.quantity);
        for (const saved of buildingRestoration.stations) {
          const { buffer: _buffer, ...trafficStation } = saved;
          void _buffer;
          this.traffic.stations.set(saved.id, {
            ...trafficStation,
            railNodeId: own.id,
          });
        }
      } else
        this.addTrafficStation({
          id: `depot:${siteId}`,
          railNodeId: own.id,
          role: 'depot',
          priority: 0,
          target: 0,
          minBatch: 0,
          maxBatch: 0,
          depotCapacity: worldContent.depotCapacity,
        });
    } else if (target.targetKind === 'factory') {
      if (target.contract === undefined)
        throw new Error(
          'Factory construction is missing its immutable contract',
        );
      const contract = deserializeContract(target.contract);
      const shiftedSnapshot = restoration?.instance;
      const elapsed =
        shiftedSnapshot === undefined
          ? 0n
          : this.logicalTime - BigInt(shiftedSnapshot.lastAdvanced);
      const instance =
        restoration === undefined
          ? new FactoryRuntimeInstance(target.instanceId!, contract)
          : FactoryRuntimeInstance.restore(
              {
                ...restoration.instance,
                lastAdvanced: this.logicalTime.toString(),
                ...(restoration.instance.nextEvent === undefined
                  ? {}
                  : {
                      nextEvent: {
                        ...restoration.instance.nextEvent,
                        time: (
                          BigInt(restoration.instance.nextEvent.time) + elapsed
                        ).toString(),
                      },
                    }),
              },
              contract,
            );
      if (restoration !== undefined) {
        const consume = (resourceId: ResourceId, quantity: number) => {
          if (quantity <= 0) return;
          const buffer = constructionBuffers.get(resourceId);
          if (buffer === undefined || buffer.quantity < quantity)
            throw new Error(
              'Factory restoration is missing delivered materials',
            );
          buffer.remove(quantity);
        };
        for (const item of contract.billOfMaterials ?? [])
          consume(item.resourceId, item.quantity);
        for (const buffer of [
          ...restoration.instance.inputs,
          ...restoration.instance.outputs,
        ])
          consume(buffer.resourceId, buffer.quantity);
        for (const saved of restoration.stations) {
          const buffer = saved.buffer;
          if (
            buffer === undefined ||
            saved.id.startsWith(`factory-input:${siteId}:`) ||
            saved.id.startsWith(`factory-output:${siteId}:`)
          )
            continue;
          consume(buffer.resourceId, buffer.quantity);
        }
      }
      this.factoryContracts.set(contract.blueprintHash, contract);
      this.factoryInstances.set(siteId, instance);
      this.place({
        id: siteId,
        kind: 'factory',
        factoryId: target.factoryId!,
        instanceId: target.instanceId!,
        stationId: target.stationId,
        state: 'ACTIVE',
        transform: target.transform,
        createdAt: this.logicalTime,
      });
      const linked = this.stationEntity(target.stationId)!;
      if (restoration !== undefined) {
        for (const saved of restoration.stations) {
          const { buffer: snapshot, ...station } = saved;
          const current = this.traffic.stations.get(saved.id);
          const incoming = current?.buffer?.quantity ?? 0;
          const stationBuffer =
            snapshot === undefined
              ? undefined
              : saved.id.startsWith(`factory-input:${siteId}:`)
                ? instance.inputs.get(snapshot.resourceId)
                : saved.id.startsWith(`factory-output:${siteId}:`)
                  ? instance.outputs.get(snapshot.resourceId)
                  : new WorldBuffer(
                      snapshot.resourceId,
                      snapshot.capacity,
                      snapshot.quantity + incoming,
                    );
          if (
            stationBuffer !== undefined &&
            (saved.id.startsWith(`factory-input:${siteId}:`) ||
              saved.id.startsWith(`factory-output:${siteId}:`)) &&
            incoming > 0
          )
            stationBuffer.add(incoming);
          this.traffic.stations.set(saved.id, {
            ...station,
            ...(stationBuffer === undefined ? {} : { buffer: stationBuffer }),
          });
        }
      } else {
        for (const [resourceId, buffer] of instance.inputs)
          this.addTrafficStation({
            id: `factory-input:${siteId}:${resourceId}`,
            railNodeId: linked.railNodeId,
            role: 'requester',
            buffer,
            priority: 0,
            target: buffer.capacity,
            minBatch: 1,
            maxBatch: 10,
            requestCreatedAt: this.logicalTime,
          });
        for (const [resourceId, buffer] of instance.outputs)
          this.addTrafficStation({
            id: `factory-output:${siteId}:${resourceId}`,
            railNodeId: linked.railNodeId,
            role: 'provider',
            buffer,
            priority: 0,
            target: 0,
            minBatch: 1,
            maxBatch: 10,
          });
      }
      this.scheduleFactory(siteId);
    } else {
      const resourceId = target.resourceId!;
      const mineRestoration =
        buildingRestoration?.entity.kind === 'mine'
          ? buildingRestoration
          : undefined;
      const savedMine = mineRestoration?.mine;
      if (mineRestoration !== undefined) {
        if (savedMine === undefined)
          throw new Error('Mine restoration is missing its saved runtime');
        for (const item of worldContent.buildings.find(
          (building) => building.kind === 'mine',
        )!.buildCost)
          consumeRestoration(item.resourceId, item.quantity);
        for (const item of [
          ...(mineRestoration.mineConstruction?.items ?? []),
          ...(mineRestoration.mineSalvage?.items ?? []),
          savedMine.output,
        ])
          consumeRestoration(item.resourceId, item.quantity);
        for (const drill of savedMine.drills)
          if (drill.state !== 'GHOST')
            for (const item of worldContent.drill.buildCost)
              consumeRestoration(item.resourceId, item.quantity);
        for (const saved of mineRestoration.stations) {
          if (
            saved.buffer === undefined ||
            saved.id === `mine-output:${siteId}`
          )
            continue;
          consumeRestoration(saved.buffer.resourceId, saved.buffer.quantity);
        }
      }
      this.place({
        id: siteId,
        kind: 'mine',
        stationId: target.stationId,
        resourceId,
        constructionBuffer: mineRestoration?.mineConstruction ?? {
          capacity: 1000,
          items: [],
        },
        salvageBuffer: mineRestoration?.mineSalvage ?? {
          capacity: 1000,
          items: [],
        },
        transform: target.transform,
        createdAt: mineRestoration?.entity.createdAt ?? this.logicalTime,
      });
      const oreKind =
        savedMine?.oreKind ??
        (resourceId === asId<ResourceId>('ironOre')
          ? OreKind.IRON
          : OreKind.COPPER);
      const mine = new MineRuntime(
        this.world.grid,
        target.transform,
        resourceId,
        oreKind,
        worldContent.drill.buildCost,
        savedMine?.output.capacity ?? worldContent.drill.outputCapacity,
      );
      if (mineRestoration !== undefined && savedMine !== undefined) {
        if (savedMine.output.quantity > 0)
          mine.output.add(savedMine.output.quantity);
        for (const item of mineRestoration.mineConstruction?.items ?? [])
          mine.construction.add(item.resourceId, item.quantity);
        for (const item of mineRestoration.mineSalvage?.items ?? [])
          mine.salvage.add(item.resourceId, item.quantity);
        for (const drill of savedMine.drills) {
          const drillId = asId<WorldEntityId>(drill.id);
          mine.drills.set(drillId, {
            id: drillId,
            position: gridPoint(drill.position.x, drill.position.y),
            placedAt: BigInt(drill.placedAt),
            state: drill.state,
          });
          const existingDrill = this.entities.get(drillId);
          if (existingDrill?.kind === 'drill')
            this.entities.set(drillId, {
              ...existingDrill,
              state: drill.state,
            });
        }
      }
      this.mines.set(siteId, mine);
      const station = this.stationEntity(target.stationId);
      if (station !== undefined && mineRestoration === undefined)
        this.addTrafficStation({
          id: `mine-output:${siteId}`,
          railNodeId: station.railNodeId,
          role: 'provider',
          buffer: mine.output,
          priority: 0,
          target: 0,
          minBatch: 1,
          maxBatch: 10,
        });
      if (mineRestoration !== undefined)
        this.restoreBuildingStations(mineRestoration, undefined, mine);
    }
    const station = this.stationEntity(target.stationId);
    if (station !== undefined)
      this.entities.set(station.id, { ...station, linkedEntityId: siteId });
    this.normalizeStationRulesForEntity(siteId);
    this.changed();
  }
  private stationHasActiveMission(stationId: string): boolean {
    return this.traffic.hasActiveMission(stationId);
  }
  private latestMissionSequence(): number {
    return this.traffic.missionSequence;
  }
  private pruneDeliveredMissions(): void {
    this.traffic.pruneDeliveredMissions((mission) => {
      if (!mission.providerId.startsWith('salvage:')) return false;
      const entityId = asId<WorldEntityId>(
        mission.providerId.slice(
          'salvage:'.length,
          mission.providerId.lastIndexOf(':'),
        ),
      );
      const target = this.constructionTargets.get(entityId);
      return (
        this.dismantlingFactories.has(entityId) ||
        this.dismantlingBuildings.has(entityId) ||
        target?.factoryRestoration !== undefined ||
        target?.buildingRestoration !== undefined
      );
    });
  }
  private consolidateStationRule(
    entityId: WorldEntityId,
    resourceId: ResourceId,
    configured?: {
      readonly mode: StationRuleMode;
      readonly target: number;
      readonly priority: number;
    },
  ): Station | undefined {
    const entity = this.entities.get(entityId);
    if (
      entity?.kind !== 'storage' &&
      entity?.kind !== 'factory' &&
      entity?.kind !== 'mine'
    )
      return undefined;
    const canonicalId = `rule:${entityId}:${resourceId}`;
    const rulePrefix = `${canonicalId}:`;
    const matches = [...this.traffic.stations.values()].filter(
      (station) =>
        station.id === canonicalId || station.id.startsWith(rulePrefix),
    );
    if (matches.length === 0) return undefined;

    const linkedStation = this.stationEntity(entity.stationId);
    const inventory =
      entity.kind === 'storage'
        ? this.storageInventories.get(entityId)
        : undefined;
    const candidates = [...matches].sort((left, right) => {
      const leftTime = left.requestCreatedAt ?? -1n;
      const rightTime = right.requestCreatedAt ?? -1n;
      if (leftTime !== rightTime) return leftTime > rightTime ? -1 : 1;
      if (left.id === canonicalId) return -1;
      if (right.id === canonicalId) return 1;
      return right.id.localeCompare(left.id);
    });
    const selected = candidates[0]!;
    const buffers = new Set(
      matches.flatMap((station) =>
        station.buffer === undefined ? [] : [station.buffer],
      ),
    );
    const quantity =
      inventory === undefined
        ? [...buffers].reduce((total, buffer) => total + buffer.quantity, 0)
        : inventory.amount(resourceId);
    const capacity = Math.max(
      1,
      quantity,
      selected.target,
      ...[...buffers].map((buffer) => buffer.capacity),
    );
    const buffer =
      inventory === undefined
        ? new WorldBuffer(resourceId, capacity, quantity)
        : new SharedInventoryBuffer(inventory, resourceId);
    const {
      buffer: _oldBuffer,
      storageId: _oldStorageId,
      storageFreeSpace: _oldStorageFreeSpace,
      ...selectedRule
    } = selected;
    void _oldBuffer;
    void _oldStorageId;
    void _oldStorageFreeSpace;
    const role =
      configured?.mode === 'request'
        ? 'requester'
        : configured?.mode === 'active-provider'
          ? 'active-provider'
          : configured?.mode === 'passive-provider'
            ? 'provider'
            : selected.role;
    const target =
      configured === undefined
        ? selected.target
        : configured.mode === 'request'
          ? configured.target
          : 0;
    const merged: Station = {
      ...selectedRule,
      id: canonicalId,
      railNodeId: linkedStation?.railNodeId ?? selected.railNodeId,
      role,
      buffer,
      priority: configured?.priority ?? selected.priority,
      target,
      ...(configured === undefined
        ? {}
        : { requestCreatedAt: this.logicalTime }),
      ...(inventory === undefined
        ? {}
        : {
            storageId: entityId,
            storageFreeSpace: inventory.freeSpace,
          }),
    };
    this.traffic.stations.set(canonicalId, merged);
    const legacyIds = matches
      .map((station) => station.id)
      .filter((id) => id !== canonicalId);
    if (legacyIds.length > 0)
      this.traffic.redirectMissions(legacyIds, canonicalId);
    for (const id of legacyIds) this.traffic.stations.delete(id);
    return merged;
  }
  private normalizeStationRulesForEntity(entityId: WorldEntityId): void {
    const entity = this.entities.get(entityId);
    if (
      (entity?.kind !== 'storage' &&
        entity?.kind !== 'factory' &&
        entity?.kind !== 'mine') ||
      (entity.kind === 'factory' && entity.state === 'DISMANTLING') ||
      ((entity.kind === 'storage' || entity.kind === 'mine') &&
        entity.dismantling === true)
    )
      return;
    const resourcesForRules = new Set<ResourceId>();
    for (const station of this.traffic.stations.values())
      if (
        station.id.startsWith(`rule:${entityId}:`) &&
        station.buffer !== undefined
      )
        resourcesForRules.add(station.buffer.resourceId);
    for (const resourceId of resourcesForRules)
      this.consolidateStationRule(entityId, resourceId);
  }
  private restorationMissionsClear(target: ConstructionTargetRecord): boolean {
    return [
      ...(target.factoryRestoration?.stations ?? []),
      ...(target.buildingRestoration?.stations ?? []),
    ].every((station) => !this.stationHasActiveMission(station.id));
  }
  private restoreBuildingStations(
    restoration: DismantlingBuildingRecord,
    inventory?: SharedInventory,
    mine?: MineRuntime,
  ): void {
    for (const saved of restoration.stations) {
      const current = this.traffic.stations.get(saved.id);
      const incoming = current?.buffer?.quantity ?? 0;
      const snapshot = saved.buffer;
      let buffer: WorldBuffer | SharedInventoryBuffer | undefined;
      if (snapshot !== undefined) {
        if (saved.id === `mine-output:${restoration.entityId}` && mine) {
          if (incoming > 0 && mine.output.freeSpace >= incoming)
            mine.output.add(incoming);
          buffer = mine.output;
        } else if (
          inventory !== undefined &&
          saved.storageId === restoration.entityId
        ) {
          buffer = new SharedInventoryBuffer(inventory, snapshot.resourceId);
        } else {
          buffer = new WorldBuffer(
            snapshot.resourceId,
            snapshot.capacity,
            snapshot.quantity + incoming,
          );
        }
      }
      const { buffer: _savedBuffer, ...station } = saved;
      void _savedBuffer;
      this.traffic.stations.set(saved.id, {
        ...station,
        ...(buffer === undefined ? {} : { buffer }),
        ...(inventory === undefined || saved.storageId !== restoration.entityId
          ? {}
          : { storageFreeSpace: inventory.freeSpace }),
      });
    }
  }
  private syncEvacuation(): void {
    for (const [id, target] of [...this.constructionTargets]) {
      const site = this.entities.get(id);
      if (site?.kind !== 'construction-site' || site.state !== 'EVACUATING')
        continue;
      if (
        target.cost.every(
          (item) =>
            (this.traffic.stations.get(this.siteStationId(id, item.resourceId))
              ?.buffer?.quantity ?? 0) === 0 &&
            !this.stationHasActiveMission(
              this.siteStationId(id, item.resourceId),
            ),
        )
      ) {
        for (const item of target.cost)
          this.traffic.stations.delete(this.siteStationId(id, item.resourceId));
        const station = this.stationEntity(target.stationId);
        if (station !== undefined) {
          const { linkedEntityId, ...unlinked } = station;
          void linkedEntityId;
          this.entities.set(station.id, unlinked);
        }
        this.remove(id);
        this.constructionTargets.delete(id);
      } else {
        this.entities.set(id, {
          ...site,
          delivered: stacks(
            target.cost.map((item) => ({
              resourceId: item.resourceId,
              quantity:
                this.traffic.stations.get(
                  this.siteStationId(id, item.resourceId),
                )?.buffer?.quantity ?? 0,
            })),
          ),
        });
      }
    }
  }
  private syncSalvage(): void {
    const owners = new Set<WorldEntityId>();
    const restorationOwners = new Set<WorldEntityId>();
    const sourcesByOwner = new Map<WorldEntityId, Station[]>();
    const deliveredSalvageByOwner = new Map<WorldEntityId, TrafficMission[]>();
    for (const [id, entity] of this.entities)
      if (entity.kind === 'factory' && entity.state === 'DISMANTLING')
        owners.add(id);
    for (const id of this.dismantlingBuildings.keys()) owners.add(id);
    for (const [id, target] of this.constructionTargets)
      if (
        target.factoryRestoration !== undefined ||
        target.buildingRestoration !== undefined
      ) {
        owners.add(id);
        restorationOwners.add(id);
      }
    for (const station of this.traffic.stations.values()) {
      const { id } = station;
      const prefix = id.startsWith('salvage:')
        ? 'salvage:'
        : id.startsWith('salvage-fallback:')
          ? 'salvage-fallback:'
          : id.startsWith(RESTORATION_RETURN_PREFIX)
            ? RESTORATION_RETURN_PREFIX
            : undefined;
      if (prefix === undefined) continue;
      const entityId = asId<WorldEntityId>(
        id.slice(prefix.length, id.lastIndexOf(':')),
      );
      owners.add(entityId);
      const ownerSources = sourcesByOwner.get(entityId);
      if (ownerSources === undefined) sourcesByOwner.set(entityId, [station]);
      else ownerSources.push(station);
    }
    if (restorationOwners.size > 0)
      for (const mission of this.traffic.missions.values()) {
        const prefix = 'salvage:';
        if (
          mission.status !== 'DELIVERED' ||
          !mission.providerId.startsWith(prefix)
        )
          continue;
        const entityId = asId<WorldEntityId>(
          mission.providerId.slice(
            prefix.length,
            mission.providerId.lastIndexOf(':'),
          ),
        );
        if (!restorationOwners.has(entityId)) continue;
        const ownedMissions = deliveredSalvageByOwner.get(entityId);
        if (ownedMissions === undefined)
          deliveredSalvageByOwner.set(entityId, [mission]);
        else ownedMissions.push(mission);
      }
    for (const entityId of owners) {
      const entity = this.entities.get(entityId);
      const target = this.constructionTargets.get(entityId);
      const restoring =
        target?.factoryRestoration ?? target?.buildingRestoration;
      const factoryRecord = this.dismantlingFactories.get(entityId);
      const buildingRecord = this.dismantlingBuildings.get(entityId);
      const dismantling =
        (entity?.kind === 'factory' && entity.state === 'DISMANTLING') ||
        this.buildingDismantleCancelable(entityId);
      const sources = sourcesByOwner.get(entityId) ?? [];
      if (restoring !== undefined) {
        const originalStations = restoring.stations;
        const returnedSalvageMissions = new Set(
          restoring.returnedSalvageMissionIds ?? [],
        );
        let hasNewReturnedSalvageMission = false;
        for (const mission of deliveredSalvageByOwner.get(entityId) ?? []) {
          if (returnedSalvageMissions.has(mission.id)) continue;
          const sequence = mission.id.startsWith('mission-')
            ? Number(mission.id.slice('mission-'.length))
            : undefined;
          if (
            restoring.salvageMissionFloor !== undefined &&
            sequence !== undefined &&
            sequence <= restoring.salvageMissionFloor
          ) {
            returnedSalvageMissions.add(mission.id);
            hasNewReturnedSalvageMission = true;
            continue;
          }
          returnedSalvageMissions.add(mission.id);
          hasNewReturnedSalvageMission = true;
          // Deliveries into the restoration site already returned the salvage
          // to this building; only reclaim cargo that escaped to another
          // requester's buffer before cancellation.
          if (mission.requesterId.startsWith(`site:${entityId}:`)) continue;
          const destination = this.traffic.stations.get(mission.requesterId);
          const destinationBuffer = destination?.buffer;
          if (
            destination === undefined ||
            destinationBuffer === undefined ||
            destinationBuffer.resourceId !== mission.resourceId
          )
            continue;
          const returnId = `${RESTORATION_RETURN_PREFIX}${entityId}:${mission.id}`;
          if (this.traffic.stations.has(returnId)) continue;
          const quantity = Math.min(
            mission.quantity,
            destinationBuffer.quantity,
          );
          if (quantity <= 0) continue;
          destinationBuffer.remove(quantity);
          this.traffic.stations.set(returnId, {
            id: returnId,
            railNodeId: destination.railNodeId,
            role: 'active-provider',
            buffer: new WorldBuffer(mission.resourceId, quantity, quantity),
            priority: 1000,
            target: 0,
            minBatch: 1,
            maxBatch: 10,
          });
        }
        if (hasNewReturnedSalvageMission && target !== undefined) {
          const returnedIds = [...returnedSalvageMissions].sort();
          this.constructionTargets.set(
            entityId,
            target.factoryRestoration !== undefined
              ? {
                  ...target,
                  factoryRestoration: {
                    ...target.factoryRestoration,
                    returnedSalvageMissionIds: returnedIds,
                  },
                }
              : target.buildingRestoration !== undefined
                ? {
                    ...target,
                    buildingRestoration: {
                      ...target.buildingRestoration,
                      returnedSalvageMissionIds: returnedIds,
                    },
                  }
                : target,
          );
        }
        const clear =
          originalStations.every(
            (station) => !this.stationHasActiveMission(station.id),
          ) &&
          sources.every(
            (station) =>
              (station.id.startsWith('salvage-fallback:') ||
                (station.buffer?.quantity ?? 0) === 0) &&
              !this.stationHasActiveMission(station.id),
          );
        if (clear)
          for (const station of sources)
            this.traffic.stations.delete(station.id);
        continue;
      }

      if (!dismantling && entity !== undefined) {
        const clear = sources.every(
          (station) =>
            (station.id.startsWith('salvage-fallback:') ||
              (station.buffer?.quantity ?? 0) === 0) &&
            !this.stationHasActiveMission(station.id),
        );
        if (clear)
          for (const station of sources)
            this.traffic.stations.delete(station.id);
        continue;
      }

      const originalStations =
        factoryRecord?.stations ??
        buildingRecord?.stations ??
        [...this.traffic.stations.values()]
          .filter((station) => stationBelongsToEntity(station.id, entityId))
          .map(serializeTrafficStation);
      const complete =
        sources.every(
          (station) =>
            (station.id.startsWith('salvage-fallback:') ||
              (station.buffer?.quantity ?? 0) === 0) &&
            !this.stationHasActiveMission(station.id),
        ) &&
        originalStations.every((saved) => {
          const station = this.traffic.stations.get(saved.id);
          return (
            (station?.buffer?.quantity ?? 0) === 0 &&
            !this.stationHasActiveMission(saved.id)
          );
        });
      if (!complete) continue;
      for (const station of sources) this.traffic.stations.delete(station.id);
      for (const saved of originalStations)
        this.traffic.stations.delete(saved.id);
      if (dismantling) {
        const externalStation = [...this.entities.values()].find(
          (candidate) =>
            candidate.kind === 'station' &&
            candidate.linkedEntityId === entityId,
        );
        if (buildingRecord?.entity.kind === 'mine')
          for (const drill of buildingRecord.mine?.drills ?? []) {
            const drillId = asId<WorldEntityId>(drill.id);
            if (this.entities.has(drillId)) this.remove(drillId);
          }
        this.remove(entityId);
        if (externalStation?.kind === 'station') {
          const { linkedEntityId, ...unlinked } = externalStation;
          void linkedEntityId;
          this.entities.set(externalStation.id, unlinked);
        }
      }
      this.changed();
    }
  }
  private siteStationId(siteId: WorldEntityId, resourceId: ResourceId): string {
    return `site:${siteId}:${resourceId}`;
  }
  private stationEntity(stationId: StationId) {
    return [...this.entities.values()].find(
      (entity) => entity.kind === 'station' && entity.stationId === stationId,
    ) as Extract<WorldEntity, { kind: 'station' }> | undefined;
  }

  placeDrill(
    mineId: WorldEntityId,
    id: WorldEntityId,
    position: GridPoint,
  ): void {
    const mine = this.mines.get(mineId);
    const mineEntity = this.entities.get(mineId);
    if (mine === undefined || mineEntity?.kind !== 'mine')
      throw new Error('Unknown mine');
    mine.placeDrill(id, position, this.logicalTime);
    this.place({
      id,
      kind: 'drill',
      mineId,
      resourceId: mineEntity.resourceId,
      state: 'GHOST',
      placedAt: this.logicalTime,
      transform: { position, size: worldContent.drill.footprint, rotation: 0 },
      createdAt: this.logicalTime,
    });
    const station = this.stationEntity(mineEntity.stationId)!;
    for (const cost of worldContent.drill.buildCost) {
      const key = drillBuildStationId(id, cost.resourceId);
      this.addTrafficStation({
        id: key,
        railNodeId: station.railNodeId,
        role: 'requester',
        buffer: new WorldBuffer(cost.resourceId, cost.quantity),
        priority: 90,
        target: cost.quantity,
        minBatch: 1,
        maxBatch: 10,
        requestCreatedAt: this.logicalTime,
      });
    }
    this.dispatch();
    this.changed();
  }
  private syncDrillConstruction(): void {
    for (const [mineId, mine] of [...this.mines].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      while (true) {
        const drill = mine.nextGhost();
        if (drill === undefined) break;
        const drillStations = worldContent.drill.buildCost.map((cost) =>
          this.traffic.stations.get(
            drillBuildStationId(drill.id, cost.resourceId),
          ),
        );
        const hasDrillStations = drillStations.every(
          (station) => station !== undefined,
        );
        const buildStations = hasDrillStations
          ? drillStations
          : worldContent.drill.buildCost.map((cost) =>
              this.traffic.stations.get(
                drillBuildStationId(mineId, cost.resourceId),
              ),
            );
        if (
          buildStations.some(
            (station, index) =>
              station === undefined ||
              station.role !== 'requester' ||
              station.buffer === undefined ||
              station.buffer.quantity <
                worldContent.drill.buildCost[index]!.quantity,
          )
        )
          break;
        for (const [index, cost] of worldContent.drill.buildCost.entries()) {
          const station = buildStations[index]!;
          station.buffer!.remove(cost.quantity);
          mine.construction.add(cost.resourceId, cost.quantity);
          if (hasDrillStations) this.traffic.stations.delete(station.id);
          else
            this.traffic.stations.set(station.id, {
              ...station,
              target: Math.max(0, station.target - cost.quantity),
            });
        }
        const built = mine.buildNext();
        const entity =
          built === undefined ? undefined : this.entities.get(built.id);
        if (built !== undefined && entity?.kind === 'drill')
          this.entities.set(built.id, { ...entity, state: 'ACTIVE' });
      }
      if (
        [...mine.drills.values()].some((drill) => drill.state === 'ACTIVE') &&
        mine.output.freeSpace > 0 &&
        !this.#scheduledMines.has(mineId)
      ) {
        this.eventQueue.schedule(
          this.logicalTime + worldContent.drill.extractionIntervalTicks,
          'MINE_EXTRACT',
          mineId,
        );
        this.#scheduledMines.add(mineId);
      }
    }
  }
  private syncCancelledDrillBuilds(): void {
    for (const [id, station] of [...this.traffic.stations]) {
      if (!id.startsWith(DRILL_BUILD_PREFIX)) continue;
      const ownerId = asId<WorldEntityId>(
        id.slice(DRILL_BUILD_PREFIX.length, id.lastIndexOf(':')),
      );
      const owner = this.entities.get(ownerId);
      if (owner?.kind === 'drill') continue;
      if (
        owner?.kind === 'mine' &&
        this.mines.get(ownerId)?.nextGhost() !== undefined
      )
        continue;
      if (station.role === 'requester')
        this.traffic.stations.set(id, { ...station, target: 0 });
      if (this.stationHasActiveMission(id)) continue;
      const quantity = station.buffer?.quantity ?? 0;
      if (station.buffer !== undefined && quantity > 0) {
        const resourceId = station.buffer.resourceId;
        station.buffer.remove(quantity);
        this.addDrillSalvage(ownerId, station.railNodeId, resourceId, quantity);
      }
      this.traffic.stations.delete(id);
    }
  }
  private addDrillSalvage(
    ownerId: WorldEntityId,
    railNodeId: string,
    resourceId: ResourceId,
    quantity: number,
  ): void {
    if (quantity <= 0) return;
    const id = `${DRILL_SALVAGE_PREFIX}${ownerId}:${resourceId}`;
    const existing = this.traffic.stations.get(id);
    const previous = existing?.buffer;
    if (previous !== undefined && previous.resourceId !== resourceId)
      throw new Error('Drill salvage resource does not match its station');
    const buffer = new WorldBuffer(
      resourceId,
      (previous?.capacity ?? 0) + quantity,
      (previous?.quantity ?? 0) + quantity,
    );
    this.traffic.stations.set(id, {
      ...(existing ?? {}),
      id,
      railNodeId,
      role: 'active-provider',
      buffer,
      priority: 1000,
      target: 0,
      minBatch: 1,
      maxBatch: 10,
    });
  }
  private syncDrillSalvage(): void {
    const owners = new Set<WorldEntityId>();
    const sourcesByOwner = new Map<WorldEntityId, Station[]>();
    const fallbacksByOwner = new Map<WorldEntityId, Station[]>();
    for (const station of this.traffic.stations.values()) {
      const prefix = station.id.startsWith(DRILL_SALVAGE_PREFIX)
        ? DRILL_SALVAGE_PREFIX
        : station.id.startsWith(DRILL_SALVAGE_FALLBACK_PREFIX)
          ? DRILL_SALVAGE_FALLBACK_PREFIX
          : undefined;
      if (prefix === undefined) continue;
      const ownerId = asId<WorldEntityId>(
        station.id.slice(prefix.length, station.id.lastIndexOf(':')),
      );
      owners.add(ownerId);
      const index =
        prefix === DRILL_SALVAGE_PREFIX ? sourcesByOwner : fallbacksByOwner;
      const ownedStations = index.get(ownerId);
      if (ownedStations === undefined) index.set(ownerId, [station]);
      else ownedStations.push(station);
    }
    for (const ownerId of owners) {
      const sources = sourcesByOwner.get(ownerId) ?? [];
      const fallbacks = fallbacksByOwner.get(ownerId) ?? [];
      const complete =
        sources.every(
          (station) =>
            (station.buffer?.quantity ?? 0) === 0 &&
            !this.stationHasActiveMission(station.id),
        ) &&
        fallbacks.every((station) => !this.stationHasActiveMission(station.id));
      if (!complete) continue;
      for (const station of [...sources, ...fallbacks])
        this.traffic.stations.delete(station.id);
    }
  }
  private processMine(mineId: WorldEntityId, time: SimTime): void {
    this.#scheduledMines.delete(mineId);
    const mine = this.mines.get(mineId);
    if (mine === undefined) return;
    const oreBefore = new Map(
      [...mine.drills.values()]
        .filter((drill) => drill.state === 'ACTIVE')
        .map((drill) => [
          drill.id,
          this.world.grid.oreRemaining[
            gridIndex(this.world.grid, drill.position)
          ],
        ]),
    );
    mine.extract();
    for (const drill of mine.drills.values()) {
      const entity = this.entities.get(drill.id);
      const index = gridIndex(this.world.grid, drill.position);
      if (
        entity?.kind === 'drill' &&
        (oreBefore.get(drill.id) ?? 0) >
          (this.world.grid.oreRemaining[index] ?? 0)
      ) {
        this.#drillExtractionEvents.add(drill.id);
        this.#oreChanges.set(index, this.world.grid.oreRemaining[index]!);
      }
      if (entity?.kind === 'drill' && entity.state !== drill.state)
        this.entities.set(drill.id, { ...entity, state: drill.state });
    }
    if (
      [...mine.drills.values()].some((drill) => drill.state === 'ACTIVE') &&
      mine.output.freeSpace > 0
    ) {
      this.eventQueue.schedule(
        time + worldContent.drill.extractionIntervalTicks,
        'MINE_EXTRACT',
        mineId,
      );
      this.#scheduledMines.add(mineId);
    }
  }
  takeDrillExtractionEvents(): readonly WorldEntityId[] {
    const events = [...this.#drillExtractionEvents].sort((a, b) =>
      a.localeCompare(b),
    );
    this.#drillExtractionEvents.clear();
    return events;
  }
  private scheduleFactory(entityId: WorldEntityId): void {
    const instance = this.factoryInstances.get(entityId);
    if (instance?.nextEvent === undefined) return;
    this.eventQueue.cancel('FACTORY', entityId);
    this.eventQueue.schedule(instance.nextEvent.time, 'FACTORY', entityId);
    this.#scheduledFactories.add(entityId);
  }
  private processFactory(entityId: WorldEntityId, time: SimTime): void {
    this.#scheduledFactories.delete(entityId);
    const instance = this.factoryInstances.get(entityId);
    if (instance === undefined) return;
    instance.transition(time);
    this.scheduleFactory(entityId);
  }
  private syncFactories(): void {
    for (const [entityId, instance] of [...this.factoryInstances].sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      if (
        instance.state === 'WAITING_INPUT' ||
        instance.state === 'OUTPUT_BLOCKED'
      )
        instance.transition(this.logicalTime);
      if (
        instance.nextEvent !== undefined &&
        !this.#scheduledFactories.has(entityId)
      )
        this.scheduleFactory(entityId);
    }
  }

  addTrafficStation(station: Station): void {
    this.traffic.addStation(station);
    this.changed();
  }
  addPod(id: string, nodeId: string, stationId: string): void {
    this.traffic.addPod({ id, nodeId, stationId });
    this.changed();
  }
  private productionStationId(
    productionId: string,
    resourceId: ResourceId,
  ): string {
    return `pod-production:${productionId}:${resourceId}`;
  }
  private productionFallbackId(
    productionId: string,
    resourceId: ResourceId,
  ): string {
    return `pod-production-fallback:${productionId}:${resourceId}`;
  }
  private ensureProductionFallback(
    productionId: string,
    resourceId: ResourceId,
    quantity: number,
  ): void {
    if (quantity <= 0) return;
    const hub = this.storageInventories.get(
      asId<WorldEntityId>('world-starter-storage'),
    );
    const hubNode = this.railNodes.get('rail-starter-storage');
    if (
      hub === undefined ||
      hubNode === undefined ||
      hub.freeSpaceFor(resourceId) < quantity
    )
      return;
    const id = this.productionFallbackId(productionId, resourceId);
    const existing = this.traffic.stations.get(id);
    this.traffic.stations.set(id, {
      id,
      railNodeId: hubNode.id,
      role: 'requester',
      buffer: new SharedInventoryBuffer(hub, resourceId),
      priority: -100,
      target: Math.max(
        existing?.target ?? 0,
        hub.amount(resourceId) + quantity,
      ),
      minBatch: 1,
      maxBatch: 10,
      requestCreatedAt: existing?.requestCreatedAt ?? this.logicalTime,
    });
  }
  private globalPodCapacity(): number {
    return [...this.entities.values()]
      .filter(
        (entity): entity is Extract<WorldEntity, { kind: 'depot' }> =>
          entity.kind === 'depot',
      )
      .reduce((total, depot) => total + depot.podCapacity, 0);
  }
  private reservedPodProductionCount(): number {
    return [...this.podProductions.values()].filter(
      (production) => production.state !== 'EVACUATING',
    ).length;
  }
  private activateNextPodProduction(depotId: WorldEntityId): void {
    const blocked = [...this.podProductions.values()].some(
      (production) =>
        production.depotId === depotId && production.state !== 'PENDING',
    );
    if (blocked) return;
    const next = [...this.podProductions.values()]
      .filter(
        (production) =>
          production.depotId === depotId && production.state === 'PENDING',
      )
      .sort((a, b) => a.sequence - b.sequence)[0];
    if (next === undefined) return;
    const depot = this.entities.get(depotId);
    if (depot?.kind !== 'depot') return;
    this.podProductions.set(next.id, { ...next, state: 'ACTIVE' });
    for (const item of worldContent.pod.buildCost)
      this.addTrafficStation({
        id: this.productionStationId(next.id, item.resourceId),
        railNodeId: depot.railNodeId,
        role: 'requester',
        buffer: new WorldBuffer(item.resourceId, item.quantity),
        priority: 100,
        target: item.quantity,
        minBatch: 1,
        maxBatch: 10,
        requestCreatedAt: this.logicalTime,
      });
  }
  queuePodProduction(depotId: WorldEntityId): void {
    const depot = this.entities.get(depotId);
    if (depot?.kind !== 'depot') throw new Error('Unknown pod depot');
    if (
      this.traffic.pods.size + this.reservedPodProductionCount() >=
      this.globalPodCapacity()
    )
      throw new Error('Global pod capacity is full');
    const sequence = this.#nextPodSequence++;
    const id = `pod-production-${sequence}`;
    this.podProductions.set(id, {
      id,
      depotId,
      sequence,
      state: 'PENDING',
    });
    this.activateNextPodProduction(depotId);
    this.dispatch();
    this.changed();
  }
  cancelPodProduction(depotId: WorldEntityId): void {
    const depot = this.entities.get(depotId);
    if (depot?.kind !== 'depot') throw new Error('Unknown pod depot');
    const latest = [...this.podProductions.values()]
      .filter(
        (production) =>
          production.depotId === depotId && production.state !== 'EVACUATING',
      )
      .sort((a, b) => b.sequence - a.sequence)[0];
    if (latest === undefined) throw new Error('Pod production queue is empty');
    if (latest.state === 'PENDING') {
      this.podProductions.delete(latest.id);
    } else {
      this.podProductions.set(latest.id, {
        ...latest,
        state: 'EVACUATING',
      });
      for (const item of worldContent.pod.buildCost) {
        const stationId = this.productionStationId(latest.id, item.resourceId);
        const station = this.traffic.stations.get(stationId);
        if (station === undefined) continue;
        this.traffic.stations.set(stationId, {
          ...station,
          role: 'provider',
          target: 0,
          priority: 1000,
        });
        this.ensureProductionFallback(
          latest.id,
          item.resourceId,
          station.buffer?.quantity ?? 0,
        );
      }
    }
    this.syncPodProductions();
    this.dispatch();
    this.changed();
  }
  private syncPodProductions(): void {
    for (const production of [...this.podProductions.values()].sort(
      (a, b) => a.sequence - b.sequence,
    )) {
      if (production.state === 'PENDING') continue;
      const quantities = worldContent.pod.buildCost.map((item) => ({
        ...item,
        delivered:
          this.traffic.stations.get(
            this.productionStationId(production.id, item.resourceId),
          )?.buffer?.quantity ?? 0,
      }));
      if (production.state === 'EVACUATING') {
        for (const item of quantities)
          this.ensureProductionFallback(
            production.id,
            item.resourceId,
            item.delivered,
          );
        const hasRelatedMission = [...this.traffic.missions.values()].some(
          (mission) =>
            mission.status !== 'DELIVERED' &&
            worldContent.pod.buildCost.some((item) => {
              const stationId = this.productionStationId(
                production.id,
                item.resourceId,
              );
              return (
                mission.requesterId === stationId ||
                mission.providerId === stationId
              );
            }),
        );
        if (hasRelatedMission || quantities.some((item) => item.delivered > 0))
          continue;
        for (const item of worldContent.pod.buildCost) {
          this.traffic.stations.delete(
            this.productionStationId(production.id, item.resourceId),
          );
          this.traffic.stations.delete(
            this.productionFallbackId(production.id, item.resourceId),
          );
        }
        this.podProductions.delete(production.id);
        this.activateNextPodProduction(production.depotId);
        continue;
      }
      if (quantities.some((item) => item.delivered !== item.quantity)) continue;
      const depot = this.entities.get(production.depotId);
      if (depot?.kind !== 'depot') continue;
      for (const item of worldContent.pod.buildCost)
        this.traffic.stations.delete(
          this.productionStationId(production.id, item.resourceId),
        );
      const depotStation = [...this.traffic.stations.values()]
        .filter(
          (station) =>
            station.role === 'depot' && station.railNodeId === depot.railNodeId,
        )
        .sort((a, b) => a.id.localeCompare(b.id))[0];
      if (depotStation === undefined)
        throw new Error('Pod depot traffic station is missing');
      const podId = `pod-built-${production.sequence}`;
      this.traffic.addPod({
        id: podId,
        nodeId: depot.railNodeId,
        stationId: depotStation.id,
      });
      depotStation.reservedDepotSlots =
        (depotStation.reservedDepotSlots ?? 0) + 1;
      this.podProductions.delete(production.id);
      this.activateNextPodProduction(production.depotId);
    }
  }
  dispatch(): void {
    if (this.#batchingDismantle) {
      this.#dismantleDispatchPending = true;
      return;
    }
    for (const [entityId, inventory] of this.storageInventories) {
      const entity = this.entities.get(entityId);
      if (entity?.kind === 'storage' && !entity.dismantling)
        this.ensureStorageDestinations(entityId, inventory);
    }
    if (this.traffic.dispatch(this.logicalTime).length > 0) this.changed();
  }
  wakeDestination(stationId: string): void {
    this.traffic.wakeDestination(stationId, this.logicalTime);
    this.changed();
  }
  removeStationRule(entityId: WorldEntityId, resourceId: ResourceId): void {
    const station = this.traffic.stations.get(`rule:${entityId}:${resourceId}`);
    if (station === undefined) return;
    if (this.entities.get(entityId)?.kind === 'storage')
      throw new Error(
        'Storage rules cannot be deleted; set thresholds to zero instead',
      );
    if (this.stationHasActiveMission(station.id))
      this.traffic.stations.set(station.id, {
        ...station,
        role: 'provider',
        target: 0,
      });
    else this.traffic.stations.delete(station.id);
    this.changed();
  }
  configureStation(
    entityId: WorldEntityId,
    resourceId: ResourceId,
    mode: StationRuleMode,
    target: number,
    priority: number,
    maximum?: number,
  ): void {
    const entity = this.entities.get(entityId);
    if (
      entity?.kind !== 'storage' &&
      entity?.kind !== 'factory' &&
      entity?.kind !== 'mine'
    )
      throw new Error('Entity cannot expose station rules');
    const station = this.stationEntity(entity.stationId);
    if (station === undefined) throw new Error('Linked station is missing');
    const id = `rule:${entityId}:${resourceId}`;
    const inventory =
      entity.kind === 'storage'
        ? this.storageInventories.get(entityId)
        : undefined;
    if (entity.kind === 'storage' && inventory !== undefined) {
      const minimum = mode === 'stock' || mode === 'request' ? target : 0;
      const upper = maximum ?? minimum;
      if (
        !Number.isSafeInteger(minimum) ||
        !Number.isSafeInteger(upper) ||
        minimum < 0 ||
        upper < minimum ||
        upper > inventory.capacity
      )
        throw new Error(
          'Stock thresholds must satisfy 0 ≤ minimum ≤ maximum ≤ capacity',
        );
      this.ensureStorageDestinations(entityId, inventory);
      const previous = this.traffic.stations.get(id);
      this.traffic.stations.set(id, {
        ...(previous ?? {}),
        id,
        railNodeId: station.railNodeId,
        role: 'storage',
        buffer: new SharedInventoryBuffer(inventory, resourceId),
        target: minimum,
        stockMaximum: upper,
        priority,
        minBatch: 1,
        maxBatch: 10,
        storageId: entityId,
        storageFreeSpace: inventory.freeSpace,
        requestCreatedAt: this.logicalTime,
      });
      this.dispatch();
      this.changed();
      return;
    }
    const existing = this.consolidateStationRule(entityId, resourceId, {
      mode,
      target,
      priority,
    });
    if (existing === undefined) {
      this.traffic.stations.set(id, {
        id,
        railNodeId: station.railNodeId,
        role:
          mode === 'request'
            ? 'requester'
            : mode === 'active-provider'
              ? 'active-provider'
              : 'provider',
        buffer:
          inventory === undefined
            ? new WorldBuffer(resourceId, 100)
            : new SharedInventoryBuffer(inventory, resourceId),
        priority,
        target: mode === 'request' ? target : 0,
        minBatch: 1,
        maxBatch: 10,
        requestCreatedAt: this.logicalTime,
        ...(inventory === undefined
          ? {}
          : { storageId: entityId, storageFreeSpace: inventory.freeSpace }),
      });
    }
    this.dispatch();
    this.changed();
  }
  restoreTraffic(state: SerializedPodTrafficState): void {
    this.traffic = PodTrafficSystem.restore(this.rails, state);
    // Legacy saves had one artificial requester per dismantled resource. Stop
    // creating new requests from those records; an already-loaded pod may
    // still finish its original delivery safely.
    for (const [id, station] of [...this.traffic.stations]) {
      if (
        !id.startsWith('salvage-fallback:') &&
        !id.startsWith(DRILL_SALVAGE_FALLBACK_PREFIX)
      )
        continue;
      if (this.stationHasActiveMission(id))
        this.traffic.stations.set(id, {
          ...station,
          role: 'provider',
          target: 0,
        });
      else this.traffic.stations.delete(id);
    }
  }
  restoreEventQueue(state: SerializedWorldEventQueue): void {
    this.eventQueue = WorldEventQueue.restore(state);
    this.#scheduledMines.clear();
    this.#scheduledFactories.clear();
    for (const event of state.events) {
      if (event.kind === 'MINE_EXTRACT')
        this.#scheduledMines.add(asId<WorldEntityId>(event.entityId));
      else if (event.kind === 'FACTORY')
        this.#scheduledFactories.add(asId<WorldEntityId>(event.entityId));
    }
  }
  setTimeControl(paused: boolean, timeScale: 1 | 5 | 20): void {
    this.paused = paused;
    this.timeScale = timeScale;
    this.changed();
  }
  advanceTo(
    target: SimTime,
    maxEvents = 100_000,
  ): { readonly advancedTo: SimTime; readonly exhaustedBudget: boolean } {
    if (target < this.logicalTime)
      throw new RangeError('World time cannot move backwards');
    this.pruneDeliveredMissions();
    this.eventQueue.pendingAdvanceTarget = target;
    this.dispatch();
    let processed = 0;
    while (processed < maxEvents) {
      const worldTime = this.eventQueue.nextTime;
      const trafficTime = this.traffic.nextEventTime;
      const next =
        worldTime === undefined
          ? trafficTime
          : trafficTime === undefined || worldTime <= trafficTime
            ? worldTime
            : trafficTime;
      if (next === undefined || next > target) break;
      this.logicalTime = next;
      const processedTrafficEvents =
        trafficTime !== undefined && trafficTime === next
          ? this.traffic.advanceTo(next, maxEvents - processed, false)
          : 0;
      processed += processedTrafficEvents;
      const worldEvents = this.eventQueue.popBatch(next);
      for (const event of worldEvents) {
        if (event.kind === 'MINE_EXTRACT')
          this.processMine(asId<WorldEntityId>(event.entityId), next);
        else if (event.kind === 'FACTORY')
          this.processFactory(asId<WorldEntityId>(event.entityId), next);
        processed += 1;
      }
      if (processedTrafficEvents > 0) {
        this.syncConstruction();
        this.syncEvacuation();
        this.syncDrillConstruction();
        this.syncCancelledDrillBuilds();
        this.syncDrillSalvage();
        this.syncFactories();
        this.syncSalvage();
        this.syncPodProductions();
        this.pruneDeliveredMissions();
      }
      if (processedTrafficEvents > 0 || worldEvents.length > 0) this.dispatch();
      this.capturePresentation();
    }
    const stillPending =
      (this.eventQueue.nextTime !== undefined &&
        this.eventQueue.nextTime <= target) ||
      (this.traffic.nextEventTime !== undefined &&
        this.traffic.nextEventTime <= target);
    if (!stillPending) {
      this.logicalTime = target;
      delete this.eventQueue.pendingAdvanceTarget;
    }
    if (processed === 0) {
      this.syncConstruction();
      this.syncEvacuation();
      this.syncDrillConstruction();
      this.syncCancelledDrillBuilds();
      this.syncDrillSalvage();
      this.syncFactories();
      this.syncSalvage();
      this.syncPodProductions();
      this.pruneDeliveredMissions();
      this.dispatch();
    }
    this.changed();
    return { advancedTo: this.logicalTime, exhaustedBudget: stillPending };
  }
  continueAdvance(maxEvents = 100_000) {
    const target = this.eventQueue.pendingAdvanceTarget;
    if (target === undefined)
      return { advancedTo: this.logicalTime, exhaustedBudget: false };
    return this.advanceTo(target, maxEvents);
  }

  beginPresentation(enabled = true) {
    this.presentation.begin(this.logicalTime, enabled);
    this.capturePresentation();
  }
  capturePresentation() {
    if (!this.presentation.recording) return;
    this.presentation.capture(
      this.logicalTime,
      this.presentationPods(),
      (pod) => this.railNodes.get(pod.nodeId)?.position,
      (pod) =>
        pod.motion ? this.railEdges.get(pod.motion.edgeId)?.points : undefined,
      this.timeScale,
    );
  }
  private presentationPods(): WorldSnapshot['pods'] {
    return [...this.traffic.pods.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((pod) => {
        const from =
          pod.motion === undefined
            ? undefined
            : this.railNodes.get(pod.motion.fromNodeId)?.position;
        const to =
          pod.motion === undefined
            ? undefined
            : this.railNodes.get(pod.motion.toNodeId)?.position;
        const edgeId = pod.currentEdgeId;
        return {
          id: asId<PodId>(pod.id),
          capacity: 10 as const,
          state: pod.state,
          nodeId: asId<RailNodeId>(pod.nodeId),
          ...(pod.resourceId === undefined || pod.cargo === 0
            ? {}
            : { cargo: { resourceId: pod.resourceId, quantity: pod.cargo } }),
          ...(pod.missionId === undefined
            ? {}
            : { missionId: asId(pod.missionId) }),
          ...(from === undefined ||
          to === undefined ||
          pod.motion === undefined ||
          edgeId === undefined
            ? {}
            : {
                motion: {
                  edgeId: asId<RailEdgeId>(edgeId),
                  from,
                  to,
                  startsAt: pod.motion.startsAt,
                  endsAt: pod.motion.endsAt,
                },
              }),
        };
      });
  }

  snapshot(): WorldSnapshot {
    const trafficDiagnostics: WorldDiagnostic[] = this.traffic.diagnostics.map(
      (item) => ({
        code: 'GRIDLOCK',
        entityIds: item.podIds,
        message: `Pods ${item.podIds.join(', ')} form a circular wait with no scheduled release.`,
      }),
    );
    const nodes = new Map(this.railNodes);
    const buildings: WorldBuildingSnapshot[] = [];
    for (const [entityId, instance] of [...this.factoryInstances].sort(
      ([a], [b]) => a.localeCompare(b),
    ))
      buildings.push({
        entityId,
        kind: 'factory',
        contract: serializeContract(instance.contract),
        state: instance.state,
        inputs: [...instance.inputs.values()].map((buffer) => ({
          ...buffer.snapshot(),
          wipPercent: instance.progress(buffer.resourceId, 'input'),
        })),
        outputs: [...instance.outputs.values()].map((buffer) => ({
          ...buffer.snapshot(),
          wipPercent: instance.progress(buffer.resourceId, 'output'),
        })),
        ...(instance.nextEvent === undefined
          ? {}
          : { nextEventAt: instance.nextEvent.time }),
      });
    for (const [entityId, inventory] of [...this.storageInventories].sort(
      ([a], [b]) => a.localeCompare(b),
    ))
      buildings.push({
        entityId,
        kind: 'storage',
        inventory: {
          capacity: inventory.capacity,
          items: inventory.snapshot(),
        },
      });
    for (const [entityId, mine] of [...this.mines].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const drills = { ghost: 0, active: 0, exhausted: 0 };
      for (const drill of mine.drills.values())
        drills[drill.state.toLowerCase() as keyof typeof drills] += 1;
      buildings.push({
        entityId,
        kind: 'mine',
        output: mine.output.snapshot(),
        construction: {
          capacity: mine.construction.capacity,
          items: mine.construction.snapshot(),
        },
        salvage: {
          capacity: mine.salvage.capacity,
          items: mine.salvage.snapshot(),
        },
        drills,
      });
    }
    const globalPodCapacity = this.globalPodCapacity();
    const podCount = this.traffic.pods.size;
    const queuedPodCount = this.reservedPodProductionCount();
    const productionsByDepot = new Map<WorldEntityId, PodProductionRecord[]>();
    for (const production of this.podProductions.values()) {
      const productions = productionsByDepot.get(production.depotId);
      if (productions === undefined)
        productionsByDepot.set(production.depotId, [production]);
      else productions.push(production);
    }
    for (const productions of productionsByDepot.values())
      productions.sort((a, b) => a.sequence - b.sequence);
    for (const entity of [...this.entities.values()]
      .filter(
        (item): item is Extract<WorldEntity, { kind: 'depot' }> =>
          item.kind === 'depot',
      )
      .sort((a, b) => a.id.localeCompare(b.id))) {
      const productions = productionsByDepot.get(entity.id) ?? [];
      const active = productions.find(
        (production) => production.state !== 'PENDING',
      );
      buildings.push({
        entityId: entity.id,
        kind: 'depot',
        podCapacity: entity.podCapacity,
        podCount,
        globalPodCapacity,
        queuedPodCount,
        productionQueueLength: productions.filter(
          (production) => production.state !== 'EVACUATING',
        ).length,
        ...(active === undefined
          ? {}
          : {
              activeProduction: {
                state: active.state === 'EVACUATING' ? 'EVACUATING' : 'ACTIVE',
                required: stacks(worldContent.pod.buildCost),
                delivered: stacks(
                  worldContent.pod.buildCost.map((item) => ({
                    resourceId: item.resourceId,
                    quantity:
                      this.traffic.stations.get(
                        this.productionStationId(active.id, item.resourceId),
                      )?.buffer?.quantity ?? 0,
                  })),
                ),
              },
            }),
      });
    }
    return {
      schemaVersion: 1,
      worldId: this.world.id,
      generation: {
        config: this.world.config,
        spawn: this.world.spawn,
      },
      revision: this.revision,
      logicalTime: this.logicalTime,
      grid: this.world.grid,
      presentationOreChanges: [],
      drillExtractionIds: [],
      entities: [...this.entities.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((entity) =>
          entity.kind === 'factory' && entity.state === 'DISMANTLING'
            ? {
                ...entity,
                canCancelDismantle: this.factoryDismantleCancelable(entity.id),
              }
            : (entity.kind === 'mine' ||
                  entity.kind === 'storage' ||
                  entity.kind === 'depot') &&
                entity.dismantling === true
              ? {
                  ...entity,
                  dismantling: true,
                  canCancelDismantle: this.buildingDismantleCancelable(
                    entity.id,
                  ),
                }
              : entity,
        ),
      railNodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
      railEdges: [...this.railEdges.values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
      railBlocks: [...this.rails.blocks.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((block) => ({
          id: asId(block.id),
          edgeId: asId<RailEdgeId>(block.edgeId),
          ...(block.occupantId === undefined
            ? {}
            : { occupantId: asId<PodId>(block.occupantId) }),
          ...(block.reservedById === undefined
            ? {}
            : { reservedById: asId<PodId>(block.reservedById) }),
        })),
      pods: this.presentationPods(),
      presentation: this.presentation.snapshot(this.logicalTime),
      missions: [...this.traffic.missions.values()]
        .filter((mission) => mission.status !== 'DELIVERED')
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((mission) => ({
          id: asId(mission.id),
          providerId: asId<StationId>(mission.providerId),
          requesterId: asId<StationId>(mission.requesterId),
          podId: asId<PodId>(mission.podId),
          resourceId: mission.resourceId,
          quantity: mission.quantity,
          routeEdgeIds: mission.deliveryRoute.edgeIds.map((edgeId) =>
            asId<RailEdgeId>(edgeId),
          ),
          createdAt: mission.createdAt,
        })),
      stations: [...this.traffic.stations.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((station) => ({
          id: station.id,
          railNodeId: asId<RailNodeId>(station.railNodeId),
          role: station.role,
          ...(station.buffer === undefined
            ? {}
            : {
                resourceId: station.buffer.resourceId,
                quantity: station.buffer.quantity,
                capacity: station.buffer.capacity,
              }),
          target: station.target,
          ...(station.stockMaximum === undefined
            ? {}
            : { stockMaximum: station.stockMaximum }),
          priority: station.priority,
          ...(station.berthVehicleId === undefined
            ? {}
            : { berthPodId: asId<PodId>(station.berthVehicleId) }),
        })),
      buildings,
      diagnostics: [...this.diagnostics, ...trafficDiagnostics],
      paused: this.paused,
      timeScale: this.timeScale,
      scheduledEvents:
        this.eventQueue.size +
        (this.traffic.nextEventTime === undefined ? 0 : 1),
      ...(this.eventQueue.pendingAdvanceTarget === undefined
        ? {}
        : { pendingAdvanceTarget: this.eventQueue.pendingAdvanceTarget }),
    };
  }
  mineRecords(): readonly SerializedMineRecord[] {
    return [...this.mines]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([entityId, mine]) => ({
        entityId,
        resourceId: mine.resourceId,
        oreKind: mine.oreKind,
        drills: [...mine.drills.values()]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((drill) => ({ ...drill, placedAt: drill.placedAt.toString() })),
        output: mine.output.snapshot(),
      }));
  }
  restoreMines(records: readonly SerializedMineRecord[]): void {
    for (const record of records) {
      const entityId = asId<WorldEntityId>(record.entityId);
      const entity = this.entities.get(entityId);
      if (entity?.kind !== 'mine')
        throw new Error('Serialized mine entity is missing');
      const mine = new MineRuntime(
        this.world.grid,
        entity.transform,
        record.resourceId,
        record.oreKind,
        worldContent.drill.buildCost,
        record.output.capacity,
      );
      mine.output.add(record.output.quantity);
      for (const drill of record.drills)
        mine.drills.set(asId<WorldEntityId>(drill.id), {
          id: asId<WorldEntityId>(drill.id),
          position: gridPoint(drill.position.x, drill.position.y),
          placedAt: BigInt(drill.placedAt),
          state: drill.state,
        });
      this.mines.set(entityId, mine);
      const outputStation = this.traffic.stations.get(
        `mine-output:${entityId}`,
      );
      if (outputStation !== undefined)
        this.traffic.stations.set(outputStation.id, {
          ...outputStation,
          buffer: mine.output,
        });
    }
  }
  storageRecords(): readonly SerializedStorageRecord[] {
    return [...this.storageInventories]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([entityId, inventory]) => ({
        entityId,
        capacity: inventory.capacity,
        items: inventory.snapshot(),
      }));
  }
  restoreStorages(records: readonly SerializedStorageRecord[]): void {
    for (const record of records) {
      const entityId = asId<WorldEntityId>(record.entityId);
      if (this.entities.get(entityId)?.kind !== 'storage')
        throw new Error('Serialized storage entity is missing');
      const inventory = new SharedInventory(record.capacity, [], record.items);
      this.storageInventories.set(entityId, inventory);
      for (const [id, station] of this.traffic.stations) {
        const hubMatch =
          entityId === asId<WorldEntityId>('world-starter-storage') &&
          (id.startsWith('hub:') ||
            id.startsWith('salvage-fallback:') ||
            id.startsWith(DRILL_SALVAGE_FALLBACK_PREFIX));
        const storageMatch = id.startsWith(`storage:${entityId}:`);
        const ruleMatch = id.startsWith(`rule:${entityId}:`);
        const podFallbackMatch =
          entityId === asId<WorldEntityId>('world-starter-storage') &&
          id.startsWith('pod-production-fallback:');
        if (
          (!hubMatch && !storageMatch && !ruleMatch && !podFallbackMatch) ||
          station.buffer === undefined
        )
          continue;
        this.traffic.stations.set(id, {
          ...station,
          buffer: new SharedInventoryBuffer(
            inventory,
            station.buffer.resourceId,
          ),
          ...(station.storageId === entityId
            ? { storageFreeSpace: inventory.freeSpace }
            : {}),
        });
      }
      this.ensureStorageDestinations(entityId, inventory);
    }
  }
  factoryRecords(): readonly {
    readonly entityId: string;
    readonly contract: SerializedFactoryContract;
    readonly instance: InstanceSnapshot;
  }[] {
    return [...this.factoryInstances]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([entityId, instance]) => ({
        entityId,
        contract: serializeContract(instance.contract),
        instance: instance.getSnapshot(),
      }));
  }
  dismantlingFactoryRecords(): readonly DismantlingFactoryRecord[] {
    return [...this.dismantlingFactories.values()].sort((a, b) =>
      a.entityId.localeCompare(b.entityId),
    );
  }
  dismantlingBuildingRecords(): readonly DismantlingBuildingRecord[] {
    return [...this.dismantlingBuildings.values()].sort((a, b) =>
      a.entityId.localeCompare(b.entityId),
    );
  }
  restoreDismantlingBuildings(
    records: readonly DismantlingBuildingRecord[],
  ): void {
    const seen = new Set<WorldEntityId>();
    for (const record of records) {
      const entityId = asId<WorldEntityId>(record.entityId);
      const entity = this.entities.get(entityId);
      if (
        seen.has(entityId) ||
        entity?.id !== entityId ||
        (entity.kind !== 'mine' &&
          entity.kind !== 'storage' &&
          entity.kind !== 'depot') ||
        entity.dismantling !== true ||
        record.entity.id !== entityId ||
        record.entity.kind !== entity.kind ||
        !Array.isArray(record.stations) ||
        !Array.isArray(record.recovered)
      )
        throw new Error('Invalid saved building dismantling state');
      if (
        record.entity.kind === 'storage' &&
        (record.storage === undefined || !Array.isArray(record.storage.items))
      )
        throw new Error('Saved dismantling storage inventory is missing');
      if (record.entity.kind === 'mine' && record.mine === undefined)
        throw new Error('Saved dismantling mine runtime is missing');
      for (const item of record.recovered)
        if (!Number.isSafeInteger(item.quantity) || item.quantity < 0)
          throw new Error('Invalid saved building recovery quantity');
      for (const station of record.stations)
        if (typeof station.id !== 'string' || station.id.length === 0)
          throw new Error('Invalid saved dismantling traffic station');
      seen.add(entityId);
      this.dismantlingBuildings.set(entityId, {
        ...record,
        entityId,
        stationId: asId<StationId>(record.stationId),
      });
    }
    for (const entity of this.entities.values())
      if (
        entity.kind === 'storage' ||
        entity.kind === 'factory' ||
        entity.kind === 'mine'
      )
        this.normalizeStationRulesForEntity(entity.id);
  }
  restoreDismantlingFactories(
    records: readonly DismantlingFactoryRecord[],
  ): void {
    const seen = new Set<WorldEntityId>();
    for (const record of records) {
      const entityId = asId<WorldEntityId>(record.entityId);
      const entity = this.entities.get(entityId);
      if (
        seen.has(entityId) ||
        entity?.kind !== 'factory' ||
        entity.state !== 'DISMANTLING' ||
        !Array.isArray(record.stations) ||
        !Array.isArray(record.recovered)
      )
        throw new Error('Invalid saved factory dismantling state');
      const contract = deserializeContract(record.contract);
      if (record.instance.contractHash !== contract.blueprintHash)
        throw new Error('Saved dismantling factory contract does not match');
      FactoryRuntimeInstance.restore(record.instance, contract);
      for (const item of record.recovered)
        if (!Number.isSafeInteger(item.quantity) || item.quantity < 0)
          throw new Error('Invalid saved dismantling recovery quantity');
      seen.add(entityId);
      this.dismantlingFactories.set(entityId, { ...record, entityId });
    }
  }
  restoreFactories(
    records: readonly {
      readonly entityId: string;
      readonly contract: SerializedFactoryContract;
      readonly instance: InstanceSnapshot;
    }[],
  ): void {
    for (const record of records) {
      const entityId = asId<WorldEntityId>(record.entityId);
      if (this.entities.get(entityId)?.kind !== 'factory')
        throw new Error('Serialized factory entity is missing');
      const contract = deserializeContract(record.contract);
      const instance = FactoryRuntimeInstance.restore(
        record.instance,
        contract,
      );
      this.factoryContracts.set(contract.blueprintHash, contract);
      this.factoryInstances.set(entityId, instance);
      for (const [resourceId, buffer] of instance.inputs) {
        const id = `factory-input:${entityId}:${resourceId}`;
        const station = this.traffic.stations.get(id);
        if (station !== undefined)
          this.traffic.stations.set(id, { ...station, buffer });
      }
      for (const [resourceId, buffer] of instance.outputs) {
        const id = `factory-output:${entityId}:${resourceId}`;
        const station = this.traffic.stations.get(id);
        if (station !== undefined)
          this.traffic.stations.set(id, { ...station, buffer });
      }
    }
  }
  private changed(): void {
    this.revision += 1;
  }
}
