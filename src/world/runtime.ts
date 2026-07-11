import { asId, gridPoint, gridSize, worldContent } from '../domain';
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
  type Station,
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
  gridIndex,
  type ConstructionSiteWorldEntity,
  type FactoryWorldEntity,
  type GeneratedWorld,
  type WorldBuildingSnapshot,
  type WorldDiagnostic,
  type WorldEntity,
  type WorldGenerationConfig,
  type WorldItemStack,
  type WorldRailEdge,
  type WorldRailNode,
  type WorldSnapshot,
  type WorldTransform,
  type WorldValidationResult,
} from './model';
import { occupy, occupiedCells, release, validatePlacement } from './placement';
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
  readonly storageInventories = new Map<WorldEntityId, SharedInventory>();
  revision = 0;
  logicalTime: SimTime = 0n;
  paused = true;
  timeScale: 1 | 5 | 20 = 1;
  #nextSlot = 1;
  #railSequence = 0;
  readonly #slots = new Map<WorldEntityId, number>();
  readonly #scheduledMines = new Set<WorldEntityId>();
  readonly #scheduledFactories = new Set<WorldEntityId>();
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
      position: gridPoint(
        stationTransform.position.x,
        stationTransform.position.y,
      ),
      kind: 'station',
    });
    this.addRailNode({
      id: depotNode,
      position: gridPoint(
        depotTransform.position.x + 1,
        depotTransform.position.y + 1,
      ),
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
      podIds: [asId<PodId>('pod-starter-1'), asId<PodId>('pod-starter-2')],
      transform: depotTransform,
      createdAt: 0n,
    });
    for (const resourceId of ['ironPlate', 'copperWire', 'circuit'] as const)
      this.addTrafficStation({
        id: `hub:${resourceId}`,
        railNodeId: stationNode,
        role: 'provider',
        buffer: new SharedInventoryBuffer(
          inventory,
          asId<ResourceId>(resourceId),
        ),
        priority: 0,
        target: 0,
        minBatch: 1,
        maxBatch: 10,
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
    this.#slots.delete(entityId);
    this.entities.delete(entityId);
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
  restoreRailSequence(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('Invalid rail sequence');
    this.#railSequence = value;
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
  placeRailPath(points: readonly GridPoint[]): readonly RailEdgeId[] {
    if (points.length < 2)
      throw new Error('Rail path needs at least two points');
    const edgeIds: RailEdgeId[] = [];
    for (let index = 1; index < points.length; index += 1) {
      const fromPoint = points[index - 1]!;
      const toPoint = points[index]!;
      if (fromPoint.x !== toPoint.x && fromPoint.y !== toPoint.y)
        throw new Error('Rail segments must be cardinal');
      const from =
        this.nodeAt(fromPoint) ?? this.createRailNode(fromPoint, 'endpoint');
      const to =
        this.nodeAt(toPoint) ?? this.createRailNode(toPoint, 'endpoint');
      const id = asId<RailEdgeId>(`rail-${++this.#railSequence}`);
      const length =
        Math.abs(fromPoint.x - toPoint.x) + Math.abs(fromPoint.y - toPoint.y);
      this.addRailEdge({
        id,
        from: from.id,
        to: to.id,
        points: [fromPoint, toPoint],
        length,
      });
      edgeIds.push(id);
    }
    return edgeIds;
  }
  removeRailEdge(edgeId: RailEdgeId): void {
    const edge = this.railEdges.get(edgeId);
    if (edge === undefined) throw new Error('Unknown world rail edge');
    if (
      [...this.traffic.pods.values()].some((pod) =>
        pod.route?.edgeIds.includes(edgeId),
      )
    )
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
    this.changed();
  }
  placeControlNode(
    kind: 'junction' | 'station',
    position: GridPoint,
  ): WorldRailNode {
    const existing = this.nodeAt(position);
    if (existing !== undefined) {
      if (existing.kind !== 'endpoint' && existing.kind !== kind)
        throw new Error('Rail control point is occupied');
      const upgraded = { ...existing, kind };
      this.railNodes.set(existing.id, upgraded);
      this.changed();
      return upgraded;
    }
    return this.createRailNode(position, kind);
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

  validateGhost(
    targetKind: ConstructionTargetRecord['targetKind'],
    transform: WorldTransform,
    stationId?: StationId,
    resourceId?: ResourceId,
  ): WorldValidationResult {
    const placement = validatePlacement(this.world.grid, transform);
    if (!placement.valid) return placement;
    if (
      targetKind === 'mine' &&
      occupiedCells(transform).some(
        (point) =>
          this.world.grid.oreKinds[gridIndex(this.world.grid, point)] !==
          OreKind.NONE,
      )
    )
      return { valid: false, reason: 'ORE_MISMATCH' };
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
  createConstructionSite(
    target: Omit<ConstructionTargetRecord, 'siteId'>,
  ): ConstructionSiteWorldEntity {
    const validation = this.validateGhost(
      target.targetKind,
      target.transform,
      target.stationId,
      target.resourceId,
    );
    if (!validation.valid)
      throw new Error(`Invalid construction site: ${validation.reason}`);
    const id = asId<WorldEntityId>(
      `site-${this.revision + 1}-${this.entities.size + 1}`,
    );
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
    for (const item of target.cost) {
      const railNodeId = stationEntity?.railNodeId;
      if (railNodeId === undefined) continue;
      this.addTrafficStation({
        id: this.siteStationId(id, item.resourceId),
        railNodeId,
        role: 'requester',
        buffer: new WorldBuffer(item.resourceId, item.quantity),
        priority: 100,
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
    if (
      entity === undefined ||
      entity.kind === 'station' ||
      entity.kind === 'construction-site' ||
      entity.kind === 'drill'
    )
      throw new Error('Entity cannot be dismantled as a major building');
    const station = [...this.entities.values()].find(
      (candidate) =>
        candidate.kind === 'station' && candidate.linkedEntityId === entityId,
    ) as Extract<WorldEntity, { kind: 'station' }> | undefined;
    if (station === undefined)
      throw new Error('Dismantling requires the linked external station');
    const recovered = new Map<ResourceId, number>();
    const add = (resourceId: ResourceId, quantity: number) =>
      recovered.set(resourceId, (recovered.get(resourceId) ?? 0) + quantity);
    if (entity.kind === 'factory') {
      const instance = this.factoryInstances.get(entityId);
      if (instance === undefined) throw new Error('Factory runtime is missing');
      for (const buffer of [
        ...instance.inputs.values(),
        ...instance.outputs.values(),
      ])
        add(buffer.resourceId, buffer.quantity);
      for (const item of instance.contract.billOfMaterials ?? [])
        add(item.resourceId, item.quantity);
      this.factoryInstances.delete(entityId);
      this.factoryContracts.delete(instance.contract.blueprintHash);
      this.eventQueue.cancel('FACTORY', entityId);
    } else if (entity.kind === 'storage') {
      const inventory = this.storageInventories.get(entityId);
      for (const item of inventory?.snapshot() ?? [])
        add(item.resourceId, item.quantity);
      for (const item of worldContent.buildings.find(
        (building) => building.kind === 'storage',
      )!.buildCost)
        add(item.resourceId, item.quantity);
      this.storageInventories.delete(entityId);
    } else if (entity.kind === 'mine') {
      const mine = this.mines.get(entityId);
      if (mine !== undefined) add(mine.resourceId, mine.output.quantity);
      for (const item of worldContent.buildings.find(
        (building) => building.kind === 'mine',
      )!.buildCost)
        add(item.resourceId, item.quantity);
      this.mines.delete(entityId);
      this.eventQueue.cancel('MINE_EXTRACT', entityId);
    } else
      for (const item of worldContent.buildings.find(
        (building) => building.kind === 'depot',
      )!.buildCost)
        add(item.resourceId, item.quantity);
    for (const [id] of [...this.traffic.stations])
      if (id.includes(`:${entityId}:`) || id.endsWith(`:${entityId}`))
        this.traffic.stations.delete(id);
    for (const [resourceId, quantity] of recovered) {
      const buffer = new WorldBuffer(resourceId, quantity, quantity);
      this.addTrafficStation({
        id: `salvage:${entityId}:${resourceId}`,
        railNodeId: station.railNodeId,
        role: 'provider',
        buffer,
        priority: 1000,
        target: 0,
        minBatch: 1,
        maxBatch: 10,
      });
      const hub = this.storageInventories.get(
        asId<WorldEntityId>('world-starter-storage'),
      );
      const hubNode = this.railNodes.get('rail-starter-storage');
      if (
        hub !== undefined &&
        hubNode !== undefined &&
        hub.freeSpaceFor(resourceId) >= quantity
      )
        this.traffic.stations.set(
          `salvage-fallback:${entityId}:${resourceId}`,
          {
            id: `salvage-fallback:${entityId}:${resourceId}`,
            railNodeId: hubNode.id,
            role: 'requester',
            buffer: new SharedInventoryBuffer(hub, resourceId),
            priority: -100,
            target: hub.amount(resourceId) + quantity,
            minBatch: 1,
            maxBatch: 10,
            requestCreatedAt: this.logicalTime,
          },
        );
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
    this.remove(entityId);
    const { linkedEntityId, ...unlinked } = station;
    void linkedEntityId;
    this.entities.set(station.id, unlinked);
    this.dispatch();
    this.changed();
    return station.stationId;
  }
  replaceFactory(
    entityId: WorldEntityId,
    target: Omit<
      ConstructionTargetRecord,
      'siteId' | 'stationId' | 'targetKind'
    >,
  ): void {
    const stationId = this.dismantleEntity(entityId);
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
      const ready = target.cost.every(
        (item) =>
          delivered.find((entry) => entry.resourceId === item.resourceId)
            ?.quantity === item.quantity,
      );
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
    for (const item of target.cost)
      this.traffic.stations.delete(this.siteStationId(siteId, item.resourceId));
    this.remove(siteId);
    this.constructionTargets.delete(siteId);
    if (target.targetKind === 'storage') {
      const inventory = new SharedInventory(worldContent.storageCapacity);
      this.storageInventories.set(siteId, inventory);
      this.place({
        id: siteId,
        kind: 'storage',
        stationId: target.stationId,
        inventory: { capacity: worldContent.storageCapacity, items: [] },
        limits: [],
        transform: target.transform,
        createdAt: this.logicalTime,
      });
    } else if (target.targetKind === 'depot') {
      const node =
        this.stationEntity(target.stationId)?.railNodeId ??
        this.createRailNode(target.transform.position, 'depot').id;
      this.place({
        id: siteId,
        kind: 'depot',
        railNodeId: node,
        podCapacity: worldContent.depotCapacity,
        podIds: [],
        transform: target.transform,
        createdAt: this.logicalTime,
      });
      this.addTrafficStation({
        id: `depot:${siteId}`,
        railNodeId: node,
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
      const instance = new FactoryRuntimeInstance(target.instanceId!, contract);
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
      this.scheduleFactory(siteId);
    } else {
      const resourceId = target.resourceId!;
      this.place({
        id: siteId,
        kind: 'mine',
        stationId: target.stationId,
        resourceId,
        constructionBuffer: { capacity: 1000, items: [] },
        salvageBuffer: { capacity: 1000, items: [] },
        transform: target.transform,
        createdAt: this.logicalTime,
      });
      const oreKind =
        resourceId === asId<ResourceId>('ironOre')
          ? OreKind.IRON
          : OreKind.COPPER;
      const mine = new MineRuntime(
        this.world.grid,
        target.transform,
        resourceId,
        oreKind,
        worldContent.drill.buildCost,
        worldContent.drill.outputCapacity,
      );
      this.mines.set(siteId, mine);
      const station = this.stationEntity(target.stationId);
      if (station !== undefined)
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
    }
    const station = this.stationEntity(target.stationId);
    if (station !== undefined)
      this.entities.set(station.id, { ...station, linkedEntityId: siteId });
    this.changed();
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
              ?.buffer?.quantity ?? 0) === 0,
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
      }
    }
  }
  private syncSalvage(): void {
    for (const [entityId, entity] of [...this.entities]) {
      if (entity.kind !== 'factory' || entity.state !== 'DISMANTLING') continue;
      const salvageComplete = [...this.traffic.stations.values()]
        .filter((s) => s.id.startsWith(`salvage:${entityId}:`))
        .every((s) => (s.buffer?.quantity ?? 0) === 0);
      if (!salvageComplete) continue;
      for (const [id] of [...this.traffic.stations])
        if (
          id.startsWith(`salvage:${entityId}:`) ||
          id.startsWith(`salvage-fallback:${entityId}:`)
        )
          this.traffic.stations.delete(id);
      const station = [...this.entities.values()]
        .filter(
          (c): c is Extract<WorldEntity, { kind: 'station' }> =>
            c.kind === 'station',
        )
        .find((s) => s.linkedEntityId === entityId);
      this.remove(entityId);
      if (station !== undefined) {
        const { linkedEntityId, ...unlinked } = station;
        void linkedEntityId;
        this.entities.set(station.id, unlinked);
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
      const key = `drill-build:${mineId}:${cost.resourceId}`;
      const current = this.traffic.stations.get(key);
      if (current === undefined)
        this.addTrafficStation({
          id: key,
          railNodeId: station.railNodeId,
          role: 'requester',
          buffer: new WorldBuffer(cost.resourceId, 10_000),
          priority: 90,
          target: cost.quantity,
          minBatch: 1,
          maxBatch: 10,
          requestCreatedAt: this.logicalTime,
        });
      else
        this.traffic.stations.set(key, {
          ...current,
          target: current.target + cost.quantity,
        });
    }
    this.dispatch();
    this.changed();
  }
  private syncDrillConstruction(): void {
    for (const [mineId, mine] of [...this.mines].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      while (
        mine.nextGhost() !== undefined &&
        worldContent.drill.buildCost.every(
          (cost) =>
            (this.traffic.stations.get(
              `drill-build:${mineId}:${cost.resourceId}`,
            )?.buffer?.quantity ?? 0) >= cost.quantity,
        )
      ) {
        for (const cost of worldContent.drill.buildCost) {
          const key = `drill-build:${mineId}:${cost.resourceId}`;
          const station = this.traffic.stations.get(key)!;
          station.buffer!.remove(cost.quantity);
          mine.construction.add(cost.resourceId, cost.quantity);
          this.traffic.stations.set(key, {
            ...station,
            target: Math.max(0, station.target - cost.quantity),
          });
        }
        const drill = mine.buildNext();
        const entity =
          drill === undefined ? undefined : this.entities.get(drill.id);
        if (drill !== undefined && entity?.kind === 'drill')
          this.entities.set(drill.id, { ...entity, state: 'ACTIVE' });
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
  private processMine(mineId: WorldEntityId, time: SimTime): void {
    this.#scheduledMines.delete(mineId);
    const mine = this.mines.get(mineId);
    if (mine === undefined) return;
    mine.extract();
    for (const drill of mine.drills.values()) {
      const entity = this.entities.get(drill.id);
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
  dispatch(): void {
    if (this.traffic.dispatch(this.logicalTime).length > 0) this.changed();
  }
  wakeDestination(stationId: string): void {
    this.traffic.wakeDestination(stationId, this.logicalTime);
    this.changed();
  }
  configureStation(
    entityId: WorldEntityId,
    resourceId: ResourceId,
    mode: 'request' | 'provide',
    target: number,
    priority: number,
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
    const id = `rule:${entityId}:${resourceId}:${mode}`;
    const existing = this.traffic.stations.get(id);
    const quantity = existing?.buffer?.quantity ?? 0;
    const inventory =
      entity.kind === 'storage'
        ? this.storageInventories.get(entityId)
        : undefined;
    const buffer =
      existing?.buffer ??
      (inventory === undefined
        ? new WorldBuffer(resourceId, 100, quantity)
        : new SharedInventoryBuffer(inventory, resourceId));
    this.traffic.stations.set(id, {
      id,
      railNodeId: station.railNodeId,
      role: mode === 'request' ? 'requester' : 'provider',
      buffer,
      priority,
      target,
      minBatch: 1,
      maxBatch: 10,
      requestCreatedAt: this.logicalTime,
    });
    this.dispatch();
    this.changed();
  }
  restoreTraffic(state: SerializedPodTrafficState): void {
    this.traffic = PodTrafficSystem.restore(this.rails, state);
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
      if (trafficTime !== undefined && trafficTime === next)
        processed += this.traffic.advanceTo(next, maxEvents - processed);
      if (processed >= maxEvents) break;
      for (const event of this.eventQueue.popBatch(next)) {
        if (event.kind === 'MINE_EXTRACT')
          this.processMine(asId<WorldEntityId>(event.entityId), next);
        else if (event.kind === 'FACTORY')
          this.processFactory(asId<WorldEntityId>(event.entityId), next);
        processed += 1;
        if (processed >= maxEvents) break;
      }
      this.syncConstruction();
      this.syncEvacuation();
      this.syncDrillConstruction();
      this.syncFactories();
      this.syncSalvage();
      this.dispatch();
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
    this.syncConstruction();
    this.syncEvacuation();
    this.syncDrillConstruction();
    this.syncFactories();
    this.syncSalvage();
    this.changed();
    return { advancedTo: this.logicalTime, exhaustedBudget: stillPending };
  }
  continueAdvance(maxEvents = 100_000) {
    const target = this.eventQueue.pendingAdvanceTarget;
    if (target === undefined)
      return { advancedTo: this.logicalTime, exhaustedBudget: false };
    return this.advanceTo(target, maxEvents);
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
    for (const entity of [...this.entities.values()]
      .filter(
        (item): item is Extract<WorldEntity, { kind: 'depot' }> =>
          item.kind === 'depot',
      )
      .sort((a, b) => a.id.localeCompare(b.id)))
      buildings.push({
        entityId: entity.id,
        kind: 'depot',
        podCapacity: entity.podCapacity,
        podCount: [...this.traffic.pods.values()].filter(
          (pod) => pod.nodeId === entity.railNodeId,
        ).length,
      });
    return {
      schemaVersion: 1,
      worldId: this.world.id,
      revision: this.revision,
      logicalTime: this.logicalTime,
      grid: this.world.grid,
      entities: [...this.entities.values()].sort((a, b) =>
        a.id.localeCompare(b.id),
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
      pods: [...this.traffic.pods.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((pod) => {
          const from =
            pod.motion === undefined
              ? undefined
              : nodes.get(pod.motion.fromNodeId)?.position;
          const to =
            pod.motion === undefined
              ? undefined
              : nodes.get(pod.motion.toNodeId)?.position;
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
            pod.motion === undefined
              ? {}
              : {
                  motion: {
                    from,
                    to,
                    startsAt: pod.motion.startsAt,
                    endsAt: pod.motion.endsAt,
                  },
                }),
          };
        }),
      missions: [...this.traffic.missions.values()]
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
          id.startsWith('hub:');
        const ruleMatch = id.startsWith(`rule:${entityId}:`);
        if ((!hubMatch && !ruleMatch) || station.buffer === undefined) continue;
        this.traffic.stations.set(id, {
          ...station,
          buffer: new SharedInventoryBuffer(
            inventory,
            station.buffer.resourceId,
          ),
        });
      }
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
