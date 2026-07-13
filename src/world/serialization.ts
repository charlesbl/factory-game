import { asId, gridPoint, parseExact, stringifyExact } from '../domain';
import type {
  FactoryId,
  GridPoint,
  InstanceId,
  ResourceId,
  StationId,
  WorldEntityId,
  WorldId,
} from '../domain';
import type { SerializedPodTrafficState } from '../logistics';
import type { SerializedFactoryContract } from '../compiler';
import type { InstanceSnapshot } from '../simulation';
import type {
  GeneratedWorld,
  SerializedGeneratedWorld,
  WorldEntity,
  WorldRailEdge,
  WorldRailNode,
  WorldSnapshot,
} from './model';
import {
  deserializeGeneratedWorld,
  serializeGeneratedWorld,
} from './generation';
import {
  WorldRuntime,
  type ConstructionTargetRecord,
  type PodProductionRecord,
  type SerializedMineRecord,
  type SerializedStorageRecord,
} from './runtime';
import type { SerializedWorldEventQueue } from './scheduler';

interface SerializedConstructionTarget extends Omit<
  ConstructionTargetRecord,
  'siteId'
> {
  readonly siteId: string;
}
export interface SerializedWorldState {
  readonly schemaVersion: 2 | 3 | 4;
  readonly generated: SerializedGeneratedWorld;
  readonly revision: number;
  readonly logicalTime: string;
  readonly paused: boolean;
  readonly timeScale: 1 | 5 | 20;
  readonly entities: readonly WorldEntity[];
  readonly entitySlots: readonly {
    readonly entityId: string;
    readonly slot: number;
  }[];
  readonly nextEntitySlot: number;
  readonly railSequence: number;
  readonly railNodes: readonly WorldRailNode[];
  readonly railEdges: readonly WorldRailEdge[];
  readonly railBlocks: readonly {
    readonly id: string;
    readonly edgeId: string;
    readonly occupantId?: string;
    readonly reservedById?: string;
  }[];
  readonly traffic: SerializedPodTrafficState;
  readonly eventQueue: SerializedWorldEventQueue;
  readonly constructionTargets: readonly SerializedConstructionTarget[];
  readonly mines: readonly SerializedMineRecord[];
  readonly factories: readonly {
    readonly entityId: string;
    readonly contract: SerializedFactoryContract;
    readonly instance: InstanceSnapshot;
  }[];
  readonly storages: readonly SerializedStorageRecord[];
  readonly nextPodSequence?: number;
  readonly podProductions?: readonly PodProductionRecord[];
}

export const serializeWorldRuntime = (
  runtime: WorldRuntime,
): SerializedWorldState => ({
  schemaVersion: 4,
  generated: serializeGeneratedWorld(runtime.world),
  revision: runtime.revision,
  logicalTime: runtime.logicalTime.toString(),
  paused: runtime.paused,
  timeScale: runtime.timeScale,
  entities: [...runtime.entities.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  ),
  entitySlots: runtime.entitySlotRecords(),
  nextEntitySlot: runtime.nextEntitySlot,
  railSequence: runtime.railSequence,
  railNodes: [...runtime.railNodes.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  ),
  railEdges: [...runtime.railEdges.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  ),
  railBlocks: [...runtime.rails.blocks.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((block) => ({ ...block })),
  traffic: runtime.traffic.serialize(),
  eventQueue: runtime.eventQueue.serialize(),
  constructionTargets: [...runtime.constructionTargets.values()]
    .sort((a, b) => a.siteId.localeCompare(b.siteId))
    .map((target) => ({ ...target, siteId: target.siteId })),
  mines: runtime.mineRecords(),
  factories: runtime.factoryRecords(),
  storages: runtime.storageRecords(),
  nextPodSequence: runtime.nextPodSequence,
  podProductions: [...runtime.podProductions.values()].sort(
    (a, b) => a.sequence - b.sequence,
  ),
});

export const deserializeWorldRuntime = (
  state: SerializedWorldState,
): WorldRuntime => {
  if (
    typeof state !== 'object' ||
    state === null ||
    (state.schemaVersion !== 2 &&
      state.schemaVersion !== 3 &&
      state.schemaVersion !== 4) ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    typeof state.logicalTime !== 'string' ||
    !/^\d+$/.test(state.logicalTime) ||
    typeof state.paused !== 'boolean' ||
    ![1, 5, 20].includes(state.timeScale) ||
    !Array.isArray(state.entities) ||
    !Array.isArray(state.entitySlots) ||
    !Number.isSafeInteger(state.nextEntitySlot) ||
    !Number.isSafeInteger(state.railSequence) ||
    !Array.isArray(state.railNodes) ||
    !Array.isArray(state.railEdges) ||
    !Array.isArray(state.railBlocks) ||
    state.traffic === undefined ||
    state.eventQueue === undefined ||
    !Array.isArray(state.constructionTargets) ||
    !Array.isArray(state.mines) ||
    !Array.isArray(state.factories) ||
    !Array.isArray(state.storages) ||
    (state.schemaVersion === 4 &&
      (!Number.isSafeInteger(state.nextPodSequence) ||
        !Array.isArray(state.podProductions)))
  )
    throw new Error(
      'Unsupported or corrupt world state: expected schema 2, 3, or 4',
    );
  const runtime = new WorldRuntime(deserializeGeneratedWorld(state.generated));
  runtime.restoreRailSequence(state.railSequence);
  for (const node of state.railNodes)
    runtime.addRailNode({
      ...node,
      id: asId(node.id),
      position: gridPoint(node.position.x, node.position.y),
    });
  const migratedEdges = new Map<string, readonly string[]>();
  for (const edge of state.railEdges) {
    const points = edge.points.map((point: GridPoint) =>
      gridPoint(point.x, point.y),
    );
    if (edge.length === 1) {
      runtime.addRailEdge({
        ...edge,
        id: asId(edge.id),
        from: asId(edge.from),
        to: asId(edge.to),
        points,
      });
      migratedEdges.set(edge.id, [edge.id]);
    } else {
      const ids = runtime.placeRailPath([points[0]!, points.at(-1)!]);
      migratedEdges.set(edge.id, ids);
    }
  }
  for (const saved of state.railBlocks) {
    const migrated = migratedEdges.get(saved.edgeId);
    const edgeId =
      saved.occupantId === undefined ? migrated?.[0] : migrated?.at(-1);
    const block =
      edgeId === undefined
        ? undefined
        : runtime.rails.blocks.get(`block:${edgeId}`);
    if (block === undefined)
      throw new Error('Saved rail block does not match topology');
    if (saved.occupantId !== undefined) block.occupantId = saved.occupantId;
    if (saved.reservedById !== undefined)
      block.reservedById = saved.reservedById;
  }
  runtime.restoreEntities(
    state.entities.map((entity) => {
      if (entity.kind === 'depot') {
        const { podIds, ...depot } = entity as typeof entity & {
          readonly podIds?: readonly string[];
        };
        void podIds;
        return {
          ...depot,
          id: asId<WorldEntityId>(entity.id),
        } as WorldEntity;
      }
      return { ...entity, id: asId<WorldEntityId>(entity.id) } as WorldEntity;
    }),
    state.entitySlots.map((record) => ({
      entityId: asId<WorldEntityId>(record.entityId),
      slot: record.slot,
    })),
    state.nextEntitySlot,
  );
  const expandRoute = <
    T extends {
      readonly edgeIds: readonly string[];
      readonly nodeIds: readonly string[];
      readonly distance: number;
    },
  >(
    route: T,
  ): T => {
    const edgeIds = route.edgeIds.flatMap(
      (id) => migratedEdges.get(id) ?? [id],
    );
    const firstNode = route.nodeIds[0];
    const nodeIds =
      firstNode === undefined
        ? []
        : edgeIds.reduce<string[]>(
            (ids, id) => {
              const edge = runtime.rails.edges.get(id);
              return edge === undefined ? ids : [...ids, edge.to];
            },
            [firstNode],
          );
    return { ...route, edgeIds, nodeIds };
  };
  const traffic = {
    ...state.traffic,
    pods: state.traffic.pods.map((pod) => {
      if (pod.route === undefined) return pod;
      const priorEdges = pod.route.edgeIds.slice(0, pod.routeIndex);
      let routeIndex = priorEdges.reduce(
        (total, id) => total + (migratedEdges.get(id)?.length ?? 1),
        0,
      );
      if (pod.currentEdgeId !== undefined)
        routeIndex += (migratedEdges.get(pod.currentEdgeId)?.length ?? 1) - 1;
      const route = expandRoute(pod.route);
      const currentEdgeId =
        pod.currentEdgeId === undefined
          ? undefined
          : (migratedEdges.get(pod.currentEdgeId)?.at(-1) ?? pod.currentEdgeId);
      return {
        ...pod,
        route,
        routeIndex,
        ...(currentEdgeId === undefined ? {} : { currentEdgeId }),
      };
    }),
    missions: state.traffic.missions.map((mission) => ({
      ...mission,
      approachRoute: expandRoute(mission.approachRoute),
      deliveryRoute: expandRoute(mission.deliveryRoute),
    })),
  };
  runtime.restoreTraffic(traffic);
  runtime.restoreMines(state.mines);
  runtime.restoreStorages(state.storages);
  runtime.restoreFactories(state.factories);
  runtime.restoreEventQueue(state.eventQueue);
  runtime.restorePodProductions(
    (state.podProductions ?? []).map((production) => ({
      ...production,
      depotId: asId<WorldEntityId>(production.depotId),
    })),
    state.nextPodSequence ?? 1,
  );
  for (const target of state.constructionTargets)
    runtime.constructionTargets.set(asId<WorldEntityId>(target.siteId), {
      ...target,
      siteId: asId<WorldEntityId>(target.siteId),
      stationId: asId<StationId>(target.stationId),
      ...(target.factoryId === undefined
        ? {}
        : { factoryId: asId<FactoryId>(target.factoryId) }),
      ...(target.instanceId === undefined
        ? {}
        : { instanceId: asId<InstanceId>(target.instanceId) }),
      ...(target.resourceId === undefined
        ? {}
        : { resourceId: asId<ResourceId>(target.resourceId) }),
    });
  runtime.logicalTime = BigInt(state.logicalTime);
  runtime.paused = state.paused;
  runtime.timeScale = state.timeScale;
  runtime.revision = state.revision;
  return runtime;
};

export const stringifyWorldRuntime = (runtime: WorldRuntime): string =>
  stringifyExact(serializeWorldRuntime(runtime));
export const parseWorldRuntime = (raw: string): WorldRuntime =>
  deserializeWorldRuntime(parseExact<SerializedWorldState>(raw));
export const generatedFromSnapshot = (
  snapshot: WorldSnapshot,
  source: GeneratedWorld,
): GeneratedWorld => ({
  ...source,
  id: asId<WorldId>(snapshot.worldId),
  grid: snapshot.grid,
});
