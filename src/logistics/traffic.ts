import { TIME_TICKS_PER_SECOND, ceilingDivide } from '../domain';
import type { ResourceId, SimTime } from '../domain';
import { WorldBuffer } from '../simulation';
import type { Station } from './dispatcher';
import type { RailNetwork, RailRoute } from './rail';

export const POD_CAPACITY = 10 as const;
export const POD_SPEED = 10n;
export const STATION_HANDLING_TIME = TIME_TICKS_PER_SECOND;

export type TrafficPodState =
  | 'IDLE'
  | 'TO_PROVIDER'
  | 'LOADING'
  | 'TO_REQUESTER'
  | 'UNLOADING'
  | 'DESTINATION_BLOCKED'
  | 'TO_DEPOT'
  | 'WAITING_BLOCK'
  | 'WAITING_BERTH';
export interface TrafficPod {
  readonly id: string;
  readonly capacity: 10;
  readonly speed: bigint;
  state: TrafficPodState;
  nodeId: string;
  stationId: string;
  cargo: number;
  resourceId?: ResourceId;
  missionId?: string;
  route?: RailRoute;
  routeIndex: number;
  currentEdgeId?: string;
  motion?: {
    readonly fromNodeId: string;
    readonly toNodeId: string;
    readonly startsAt: SimTime;
    readonly endsAt: SimTime;
  };
  reservedDepotId?: string;
  resumeState?: Exclude<TrafficPodState, 'WAITING_BLOCK' | 'WAITING_BERTH'>;
}
export interface TrafficMission {
  readonly id: string;
  readonly providerId: string;
  readonly requesterId: string;
  readonly podId: string;
  readonly resourceId: ResourceId;
  readonly quantity: number;
  readonly createdAt: SimTime;
  readonly deliveryRoute: RailRoute;
  readonly approachRoute: RailRoute;
  status:
    | 'TO_PROVIDER'
    | 'LOADING'
    | 'TO_REQUESTER'
    | 'UNLOADING'
    | 'BLOCKED'
    | 'DELIVERED';
}
export interface TrafficEvent {
  readonly time: SimTime;
  readonly sequence: number;
  readonly podId: string;
  readonly type: 'EDGE_ARRIVAL' | 'LOAD_COMPLETE' | 'UNLOAD_COMPLETE';
}
export interface SerializedTrafficStation {
  readonly id: string;
  readonly railNodeId: string;
  readonly role: Station['role'];
  readonly priority: number;
  readonly target: number;
  readonly minBatch: number;
  readonly maxBatch: number;
  readonly requestCreatedAt?: SimTime;
  readonly storageId?: string;
  readonly storageFreeSpace?: number;
  readonly stockMaximum?: number;
  readonly berthVehicleId?: string;
  readonly depotCapacity?: number;
  readonly reservedDepotSlots?: number;
  readonly buffer?: {
    readonly resourceId: ResourceId;
    readonly capacity: number;
    readonly quantity: number;
  };
}
export interface SerializedPodTrafficState {
  readonly sequence: number;
  readonly missionSequence: number;
  readonly stations: readonly SerializedTrafficStation[];
  readonly pods: readonly TrafficPod[];
  readonly missions: readonly TrafficMission[];
  readonly events: readonly TrafficEvent[];
}

const compareTime = (a: SimTime, b: SimTime): number =>
  a < b ? -1 : a > b ? 1 : 0;

interface TrafficReservations {
  readonly byRequester: Map<string, number>;
  readonly byStorage: Map<string, number>;
  readonly byStorageResource: Map<string, Map<ResourceId, number>>;
  readonly byBuffer: Map<WorldBuffer, number>;
}

interface PodRouteChoice {
  readonly pod: TrafficPod;
  readonly route: RailRoute;
}

interface PodRouteCursor {
  readonly choices: readonly PodRouteChoice[];
  index: number;
}

const increment = <K>(map: Map<K, number>, key: K, quantity: number): void => {
  map.set(key, (map.get(key) ?? 0) + quantity);
};

const incrementStorageResource = (
  map: Map<string, Map<ResourceId, number>>,
  storageId: string,
  resourceId: ResourceId,
  quantity: number,
): void => {
  let byResource = map.get(storageId);
  if (byResource === undefined) {
    byResource = new Map();
    map.set(storageId, byResource);
  }
  increment(byResource, resourceId, quantity);
};

export class PodTrafficSystem {
  readonly stations = new Map<string, Station>();
  readonly pods = new Map<string, TrafficPod>();
  readonly missions = new Map<string, TrafficMission>();
  readonly #activeMissionIdsByStation = new Map<string, Set<string>>();
  readonly diagnostics: { code: 'GRIDLOCK'; podIds: readonly string[] }[] = [];
  readonly #events: TrafficEvent[] = [];
  readonly #deferredDepotPods = new Set<string>();
  #sequence = 0;
  #missionSequence = 0;
  #deferAutomaticDispatch = false;
  constructor(readonly rails: RailNetwork) {}
  get nextEventTime(): SimTime | undefined {
    return this.#events[0]?.time;
  }
  get missionSequence(): number {
    return this.#missionSequence;
  }

  /** Keep delivery receipts only while their owner may need to reclaim salvage. */
  pruneDeliveredMissions(retain: (mission: TrafficMission) => boolean): void {
    for (const mission of this.missions.values())
      if (mission.status === 'DELIVERED' && !retain(mission))
        this.removeMission(mission.id);
  }

  serialize(): SerializedPodTrafficState {
    return {
      sequence: this.#sequence,
      missionSequence: this.#missionSequence,
      stations: [...this.stations.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((station) => ({
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
          ...(station.storageId === undefined
            ? {}
            : { storageId: station.storageId }),
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
        })),
      pods: [...this.pods.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((pod) => ({
          ...pod,
          ...(pod.route === undefined
            ? {}
            : {
                route: {
                  ...pod.route,
                  nodeIds: [...pod.route.nodeIds],
                  edgeIds: [...pod.route.edgeIds],
                },
              }),
        })),
      missions: [...this.missions.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((mission) => ({
          ...mission,
          approachRoute: {
            ...mission.approachRoute,
            nodeIds: [...mission.approachRoute.nodeIds],
            edgeIds: [...mission.approachRoute.edgeIds],
          },
          deliveryRoute: {
            ...mission.deliveryRoute,
            nodeIds: [...mission.deliveryRoute.nodeIds],
            edgeIds: [...mission.deliveryRoute.edgeIds],
          },
        })),
      events: [...this.#events].sort(
        (a, b) => compareTime(a.time, b.time) || a.sequence - b.sequence,
      ),
    };
  }
  static restore(
    rails: RailNetwork,
    state: SerializedPodTrafficState,
  ): PodTrafficSystem {
    if (
      !Number.isSafeInteger(state.sequence) ||
      !Number.isSafeInteger(state.missionSequence) ||
      !Array.isArray(state.stations) ||
      !Array.isArray(state.pods) ||
      !Array.isArray(state.missions) ||
      !Array.isArray(state.events)
    )
      throw new Error('Invalid pod traffic state');
    const system = new PodTrafficSystem(rails);
    system.#sequence = state.sequence;
    system.#missionSequence = state.missionSequence;
    for (const station of state.stations)
      system.addStation({
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
        ...(station.storageId === undefined
          ? {}
          : { storageId: station.storageId }),
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
          : {
              buffer: new WorldBuffer(
                station.buffer.resourceId,
                station.buffer.capacity,
                station.buffer.quantity,
              ),
            }),
      });
    for (const pod of state.pods) system.pods.set(pod.id, { ...pod });
    for (const mission of state.missions) system.addMission({ ...mission });
    system.#events.push(...state.events.map((event) => ({ ...event })));
    system.#heapifyEvents();
    return system;
  }

  addStation(station: Station): void {
    if (this.stations.has(station.id))
      throw new Error('Duplicate traffic station');
    this.stations.set(station.id, station);
  }
  /** O(1) lookup for whether a station participates in outstanding missions. */
  hasActiveMission(stationId: string): boolean {
    return (this.#activeMissionIdsByStation.get(stationId)?.size ?? 0) > 0;
  }
  /** Redirects active mission endpoints while preserving routes and pod state. */
  redirectMissions(
    oldStationIds: readonly string[],
    newStationId: string,
  ): number {
    const oldIds = new Set(oldStationIds);
    oldIds.delete(newStationId);
    if (oldIds.size === 0) return 0;
    let redirected = 0;
    for (const mission of this.missions.values()) {
      if (
        mission.status === 'DELIVERED' ||
        (!oldIds.has(mission.providerId) && !oldIds.has(mission.requesterId))
      )
        continue;
      const next = {
        ...mission,
        providerId: oldIds.has(mission.providerId)
          ? newStationId
          : mission.providerId,
        requesterId: oldIds.has(mission.requesterId)
          ? newStationId
          : mission.requesterId,
      };
      this.unindexActiveMission(mission);
      this.missions.set(mission.id, next);
      this.indexActiveMission(next);
      redirected += 1;
    }
    return redirected;
  }
  addPod(
    pod: Omit<
      TrafficPod,
      'capacity' | 'speed' | 'state' | 'cargo' | 'routeIndex'
    > &
      Partial<Pick<TrafficPod, 'state' | 'cargo' | 'routeIndex'>>,
  ): void {
    if (this.pods.has(pod.id)) throw new Error('Duplicate pod');
    this.pods.set(pod.id, {
      ...pod,
      capacity: POD_CAPACITY,
      speed: POD_SPEED,
      state: pod.state ?? 'IDLE',
      cargo: pod.cargo ?? 0,
      routeIndex: pod.routeIndex ?? 0,
    });
  }

  /**
   * Permanently discards outstanding missions whose source or destination is
   * one of the supplied stations. Carried cargo is discarded with the mission.
   * The returned IDs are the missions removed. Completed missions are kept.
   * Call before deleting those stations, then dispatch again after station
   * removal so newly available pods and storage capacity can be reassigned.
   */
  abandonMissionsForStations(
    stationIds: readonly string[],
    time: SimTime,
  ): readonly string[] {
    const selectedStations = new Set(stationIds);
    if (selectedStations.size === 0) return [];

    const abandoned = [...this.missions.values()].filter(
      (mission) =>
        mission.status !== 'DELIVERED' &&
        (selectedStations.has(mission.providerId) ||
          selectedStations.has(mission.requesterId)),
    );
    if (abandoned.length === 0) return [];
    const abandonedIds = new Set(abandoned.map((mission) => mission.id));
    const podIds = new Set(abandoned.map((mission) => mission.podId));

    for (const mission of abandoned) this.removeMission(mission.id);

    // A valid traffic state assigns only one active mission to a pod. Keep a
    // pod untouched if corrupt/legacy state also assigns it to an unrelated
    // active mission.
    const podsWithRetainedMissions = new Set(
      [...this.missions.values()]
        .filter((mission) => mission.status !== 'DELIVERED')
        .map((mission) => mission.podId),
    );
    const releasedPodIds = new Set(
      [...podIds].filter((podId) => {
        const missionId = this.pods.get(podId)?.missionId;
        return (
          !podsWithRetainedMissions.has(podId) &&
          (missionId === undefined || abandonedIds.has(missionId))
        );
      }),
    );

    for (const podId of releasedPodIds) {
      for (const block of this.rails.blocks.values()) {
        if (block.occupantId === podId) this.rails.leave(block.edgeId, podId);
        this.rails.releaseReservation(block.edgeId, podId);
      }
      for (const station of this.stations.values())
        if (station.berthVehicleId === podId) delete station.berthVehicleId;

      const pod = this.pods.get(podId);
      if (pod === undefined) continue;
      if (pod.reservedDepotId !== undefined) {
        const depot = this.stations.get(pod.reservedDepotId);
        if (depot !== undefined)
          depot.reservedDepotSlots = Math.max(
            0,
            (depot.reservedDepotSlots ?? 1) - 1,
          );
      }
      pod.state = 'IDLE';
      pod.cargo = 0;
      delete pod.resourceId;
      delete pod.missionId;
      delete pod.route;
      delete pod.currentEdgeId;
      delete pod.motion;
      delete pod.resumeState;
      delete pod.reservedDepotId;

      const nextStation = [...this.stations.values()]
        .filter((station) => !selectedStations.has(station.id))
        .flatMap((station) => {
          const route = this.rails.route(pod.nodeId, station.railNodeId);
          return route === undefined
            ? []
            : [{ station, distance: route.distance }];
        })
        .sort(
          (a, b) =>
            a.distance - b.distance || a.station.id.localeCompare(b.station.id),
        )[0]?.station;
      if (nextStation !== undefined) pod.stationId = nextStation.id;
    }

    let retainedEvents = 0;
    for (let index = 0; index < this.#events.length; index += 1) {
      const event = this.#events[index]!;
      if (releasedPodIds.has(event.podId)) continue;
      this.#events[retainedEvents] = event;
      retainedEvents += 1;
    }
    if (retainedEvents < this.#events.length) {
      this.#events.length = retainedEvents;
      this.#heapifyEvents();
    }

    this.wakeWaiting(time);
    this.detectGridlock();
    return [...abandonedIds].sort();
  }

  dispatch(time: SimTime): readonly TrafficMission[] {
    const created: TrafficMission[] = [];
    let remainingIdlePods = [...this.pods.values()].filter(
      (pod) => pod.state === 'IDLE',
    ).length;
    if (remainingIdlePods === 0) {
      if (!this.#deferAutomaticDispatch) this.routeDeferredDepotPods(time);
      return created;
    }
    const reservations = this.createReservations();
    const podRouteCursors = new Map<string, PodRouteCursor>();
    const nextIdlePodRoute = (
      provider: Station,
      minBatch: number,
    ): PodRouteChoice | undefined => {
      if (POD_CAPACITY < minBatch) return undefined;
      let cursor = podRouteCursors.get(provider.id);
      if (cursor === undefined) {
        const choices = [...this.pods.values()]
          .filter((pod) => pod.state === 'IDLE')
          .flatMap((pod) => {
            const route = this.rails.route(pod.nodeId, provider.railNodeId);
            return route === undefined ? [] : [{ pod, route }];
          })
          .sort(
            (a, b) =>
              a.route.distance - b.route.distance ||
              a.pod.id.localeCompare(b.pod.id),
          );
        cursor = { choices, index: 0 };
        podRouteCursors.set(provider.id, cursor);
      }
      while (cursor.index < cursor.choices.length) {
        const choice = cursor.choices[cursor.index]!;
        cursor.index += 1;
        if (choice.pod.state === 'IDLE') return choice;
      }
      return undefined;
    };
    const providersByResource = new Map<ResourceId, Station[]>();
    for (const station of this.stations.values()) {
      if (
        (station.role !== 'provider' &&
          station.role !== 'active-provider' &&
          station.role !== 'storage') ||
        station.buffer === undefined
      )
        continue;
      const sameResource = providersByResource.get(station.buffer.resourceId);
      if (sameResource === undefined)
        providersByResource.set(station.buffer.resourceId, [station]);
      else sameResource.push(station);
    }
    const requesters = [...this.stations.values()]
      .filter(
        (station) =>
          (station.role === 'requester' || station.role === 'storage') &&
          station.buffer !== undefined &&
          station.buffer.quantity < station.target,
      )
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          compareTime(a.requestCreatedAt ?? time, b.requestCreatedAt ?? time) ||
          a.id.localeCompare(b.id),
      );
    for (const requester of requesters) {
      if (remainingIdlePods === 0) break;
      const target = requester.buffer!;
      const inbound = reservations.byRequester.get(requester.id) ?? 0;
      let wanted = requester.target - target.quantity - inbound;
      const providerCandidates = (
        providersByResource.get(target.resourceId) ?? []
      )
        .filter(
          (station) =>
            (station.storageId === undefined ||
              station.storageId !== requester.storageId) &&
            !(
              station.role === 'storage' &&
              requester.role === 'storage' &&
              station.buffer!.quantity <= station.target
            ) &&
            station.buffer !== target &&
            station.buffer !== undefined &&
            station.buffer.quantity >= requester.minBatch,
        )
        .flatMap((station) => {
          const route = this.rails.route(
            station.railNodeId,
            requester.railNodeId,
          );
          return route === undefined ? [] : [{ station, route }];
        })
        .sort(
          (a, b) =>
            b.station.priority - a.station.priority ||
            a.route.distance - b.route.distance ||
            a.station.id.localeCompare(b.station.id),
        );
      let providerIndex = 0;
      while (wanted >= requester.minBatch && remainingIdlePods > 0) {
        const destinationCapacity = this.destinationCapacity(
          requester,
          reservations,
        );
        if (
          Math.min(wanted, requester.maxBatch, destinationCapacity) <
          requester.minBatch
        )
          break;
        let selection:
          | {
              provider: Station;
              deliveryRoute: RailRoute;
              pod: TrafficPod;
              approachRoute: RailRoute;
            }
          | undefined;
        while (providerIndex < providerCandidates.length) {
          const candidate = providerCandidates[providerIndex]!;
          if (
            candidate.station.buffer === undefined ||
            candidate.station.buffer.quantity < requester.minBatch
          ) {
            providerIndex += 1;
            continue;
          }
          const podCandidate = nextIdlePodRoute(
            candidate.station,
            requester.minBatch,
          );
          if (podCandidate === undefined) {
            providerIndex += 1;
            continue;
          }
          selection = {
            provider: candidate.station,
            deliveryRoute: candidate.route,
            pod: podCandidate.pod,
            approachRoute: podCandidate.route,
          };
          break;
        }
        if (selection === undefined || selection.provider.buffer === undefined)
          break;
        const quantity = Math.min(
          wanted,
          requester.maxBatch,
          requester.role === 'storage' && selection.provider.role === 'storage'
            ? Math.max(
                0,
                selection.provider.buffer.quantity - selection.provider.target,
              )
            : selection.provider.buffer.quantity,
          selection.pod.capacity,
          destinationCapacity,
        );
        if (quantity < requester.minBatch) break;
        selection.provider.buffer.remove(quantity);
        const mission: TrafficMission = {
          id: `mission-${++this.#missionSequence}`,
          providerId: selection.provider.id,
          requesterId: requester.id,
          podId: selection.pod.id,
          resourceId: target.resourceId,
          quantity,
          createdAt: time,
          approachRoute: selection.approachRoute,
          deliveryRoute: selection.deliveryRoute,
          status: 'TO_PROVIDER',
        };
        this.addMission(mission);
        this.reserveDestination(
          reservations,
          requester,
          target.resourceId,
          quantity,
        );
        created.push(mission);
        const pod = selection.pod;
        pod.missionId = mission.id;
        pod.resourceId = target.resourceId;
        pod.cargo = quantity;
        this.beginRoute(pod, selection.approachRoute, 'TO_PROVIDER', time);
        remainingIdlePods -= 1;
        wanted -= quantity;
      }
    }

    // Fill explicit requests first. Once those jobs have claimed idle pods,
    // active providers offload their remaining stock to any marked storage.
    const storageStationsByResource = new Map<ResourceId, Station[]>();
    for (const station of this.stations.values()) {
      if (
        station.storageId === undefined ||
        station.role === 'depot' ||
        station.buffer === undefined
      )
        continue;
      const sameResource = storageStationsByResource.get(
        station.buffer.resourceId,
      );
      if (sameResource === undefined)
        storageStationsByResource.set(station.buffer.resourceId, [station]);
      else sameResource.push(station);
    }
    const storageRouteCache = new Map<
      string,
      { readonly station: Station; readonly route: RailRoute }[]
    >();
    const activeProviders = [...this.stations.values()]
      .filter(
        (station) =>
          (station.role === 'active-provider' || station.role === 'storage') &&
          station.buffer !== undefined &&
          station.buffer.quantity >= station.minBatch,
      )
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    for (const provider of activeProviders) {
      if (remainingIdlePods === 0) break;
      const source = provider.buffer;
      if (source === undefined || source.quantity < provider.minBatch) continue;
      const routeCacheKey = `${provider.railNodeId}\u0000${source.resourceId}\u0000${provider.storageId ?? ''}`;
      let destinations = storageRouteCache.get(routeCacheKey);
      if (destinations === undefined) {
        destinations = (storageStationsByResource.get(source.resourceId) ?? [])
          .filter(
            (station) =>
              station.railNodeId !== provider.railNodeId &&
              station.storageId !== provider.storageId &&
              station.buffer !== source,
          )
          .flatMap((station) => {
            const route = this.rails.route(
              provider.railNodeId,
              station.railNodeId,
            );
            return route === undefined ? [] : [{ station, route }];
          })
          .sort(
            (a, b) =>
              a.route.distance - b.route.distance ||
              a.station.id.localeCompare(b.station.id),
          );
        storageRouteCache.set(routeCacheKey, destinations);
      }
      for (const destination of destinations) {
        while (source.quantity >= provider.minBatch && remainingIdlePods > 0) {
          const destinationCapacity = this.destinationCapacity(
            destination.station,
            reservations,
          );
          const available = Math.min(
            Math.max(0, source.quantity - (provider.stockMaximum ?? 0)),
            provider.maxBatch,
            destination.station.maxBatch,
            destinationCapacity,
          );
          if (available < provider.minBatch) break;
          const podCandidate = nextIdlePodRoute(provider, provider.minBatch);
          if (podCandidate === undefined) break;
          const quantity = Math.min(available, podCandidate.pod.capacity);
          if (quantity < provider.minBatch) break;
          source.remove(quantity);
          const mission: TrafficMission = {
            id: `mission-${++this.#missionSequence}`,
            providerId: provider.id,
            requesterId: destination.station.id,
            podId: podCandidate.pod.id,
            resourceId: source.resourceId,
            quantity,
            createdAt: time,
            approachRoute: podCandidate.route,
            deliveryRoute: destination.route,
            status: 'TO_PROVIDER',
          };
          this.addMission(mission);
          this.reserveDestination(
            reservations,
            destination.station,
            source.resourceId,
            quantity,
          );
          created.push(mission);
          const pod = podCandidate.pod;
          pod.missionId = mission.id;
          pod.resourceId = source.resourceId;
          pod.cargo = quantity;
          this.beginRoute(pod, podCandidate.route, 'TO_PROVIDER', time);
          remainingIdlePods -= 1;
        }
      }
    }
    if (!this.#deferAutomaticDispatch) this.routeDeferredDepotPods(time);
    return created;
  }

  /**
   * When `dispatchAfterEvents` is false, defer every dispatch triggered by
   * these events until the caller has synchronized world state and calls
   * `dispatch` once. The default preserves the standalone behavior.
   */
  advanceTo(
    target: SimTime,
    maxEvents = Number.MAX_SAFE_INTEGER,
    dispatchAfterEvents = true,
  ): number {
    let processed = 0;
    const previousDefer = this.#deferAutomaticDispatch;
    this.#deferAutomaticDispatch = previousDefer || !dispatchAfterEvents;
    try {
      while (true) {
        const event = this.#events[0];
        if (
          event === undefined ||
          event.time > target ||
          processed >= maxEvents
        )
          break;
        const batchTime = event.time;
        const batch: TrafficEvent[] = [];
        while (this.#events[0]?.time === batchTime)
          batch.push(this.#popEvent()!);
        for (const item of batch) this.process(item);
        if (!this.#deferAutomaticDispatch) this.dispatch(batchTime);
        processed += batch.length;
      }
    } finally {
      this.#deferAutomaticDispatch = previousDefer;
    }
    this.detectGridlock();
    return processed;
  }

  wakeDestination(stationId: string, time: SimTime): void {
    for (const pod of [...this.pods.values()]
      .filter(
        (item) =>
          item.state === 'DESTINATION_BLOCKED' &&
          this.missions.get(item.missionId ?? '')?.requesterId === stationId,
      )
      .sort((a, b) => a.id.localeCompare(b.id)))
      this.tryUnload(pod, time);
  }

  private process(event: TrafficEvent): void {
    const pod = this.pods.get(event.podId);
    if (pod === undefined) return;
    if (event.type === 'EDGE_ARRIVAL') {
      const edgeId = pod.currentEdgeId;
      if (edgeId === undefined) return;
      delete pod.motion;
      const route = pod.route;
      if (route === undefined) return;
      pod.routeIndex += 1;
      pod.nodeId = route.nodeIds[pod.routeIndex]!;
      if (pod.routeIndex < route.edgeIds.length)
        this.tryNextEdge(pod, event.time);
      else {
        this.rails.leave(edgeId, pod.id);
        delete pod.currentEdgeId;
        this.finishRoute(pod, event.time);
      }
      this.wakeWaiting(event.time);
    } else if (event.type === 'LOAD_COMPLETE')
      this.finishLoading(pod, event.time);
    else this.tryUnload(pod, event.time);
  }

  private beginRoute(
    pod: TrafficPod,
    route: RailRoute,
    state: 'TO_PROVIDER' | 'TO_REQUESTER' | 'TO_DEPOT',
    time: SimTime,
  ): void {
    pod.route = route;
    pod.routeIndex = 0;
    pod.state = state;
    delete pod.resumeState;
    if (route.edgeIds.length === 0) this.finishRoute(pod, time);
    else this.tryNextEdge(pod, time);
  }

  private tryNextEdge(pod: TrafficPod, time: SimTime): void {
    const route = pod.route;
    const edgeId = route?.edgeIds[pod.routeIndex];
    if (route === undefined || edgeId === undefined) return;
    const travellingState =
      pod.state === 'WAITING_BLOCK' ? (pod.resumeState ?? 'IDLE') : pod.state;
    if (!this.rails.reserve(edgeId, pod.id)) {
      if (pod.state !== 'WAITING_BLOCK')
        pod.resumeState = travellingState as Exclude<
          TrafficPodState,
          'WAITING_BLOCK' | 'WAITING_BERTH'
        >;
      pod.state = 'WAITING_BLOCK';
      return;
    }
    const previous = pod.currentEdgeId;
    if (previous !== undefined && previous !== edgeId)
      this.rails.leave(previous, pod.id);
    this.rails.enter(edgeId, pod.id);
    pod.currentEdgeId = edgeId;
    pod.state = travellingState as TrafficPodState;
    const edge = this.rails.edges.get(edgeId)!;
    const endsAt =
      time +
      ceilingDivide(BigInt(edge.length) * TIME_TICKS_PER_SECOND, pod.speed);
    pod.motion = {
      fromNodeId: edge.from,
      toNodeId: edge.to,
      startsAt: time,
      endsAt,
    };
    this.schedule(endsAt, pod.id, 'EDGE_ARRIVAL');
  }

  private finishRoute(pod: TrafficPod, time: SimTime): void {
    if (pod.state === 'TO_PROVIDER') this.beginLoading(pod, time);
    else if (pod.state === 'TO_REQUESTER') this.beginUnloading(pod, time);
    else {
      const depot = this.stations.get(pod.reservedDepotId ?? '');
      if (depot !== undefined)
        depot.reservedDepotSlots = Math.max(
          0,
          (depot.reservedDepotSlots ?? 1) - 1,
        );
      delete pod.reservedDepotId;
      pod.state = 'IDLE';
      pod.stationId = this.stationAt(pod.nodeId)?.id ?? pod.stationId;
      delete pod.route;
      if (!this.#deferAutomaticDispatch) this.dispatch(time);
    }
  }

  private beginLoading(pod: TrafficPod, time: SimTime): void {
    const mission = this.missions.get(pod.missionId ?? '');
    const provider = this.stations.get(mission?.providerId ?? '');
    if (mission === undefined || provider === undefined) return;
    if (
      provider.berthVehicleId !== undefined &&
      provider.berthVehicleId !== pod.id
    ) {
      pod.state = 'WAITING_BERTH';
      pod.resumeState = 'LOADING';
      return;
    }
    provider.berthVehicleId = pod.id;
    pod.stationId = provider.id;
    pod.state = 'LOADING';
    mission.status = 'LOADING';
    this.schedule(time + STATION_HANDLING_TIME, pod.id, 'LOAD_COMPLETE');
  }

  private finishLoading(pod: TrafficPod, time: SimTime): void {
    const mission = this.missions.get(pod.missionId ?? '');
    if (mission === undefined) return;
    const provider = this.stations.get(mission.providerId);
    if (provider?.berthVehicleId === pod.id) delete provider.berthVehicleId;
    mission.status = 'TO_REQUESTER';
    this.beginRoute(pod, mission.deliveryRoute, 'TO_REQUESTER', time);
    this.wakeWaiting(time);
  }

  private beginUnloading(pod: TrafficPod, time: SimTime): void {
    const mission = this.missions.get(pod.missionId ?? '');
    const requester = this.stations.get(mission?.requesterId ?? '');
    if (mission === undefined || requester === undefined) return;
    if (
      requester.berthVehicleId !== undefined &&
      requester.berthVehicleId !== pod.id
    ) {
      pod.state = 'WAITING_BERTH';
      pod.resumeState = 'UNLOADING';
      return;
    }
    requester.berthVehicleId = pod.id;
    pod.stationId = requester.id;
    pod.state = 'UNLOADING';
    mission.status = 'UNLOADING';
    this.schedule(time + STATION_HANDLING_TIME, pod.id, 'UNLOAD_COMPLETE');
  }

  private tryUnload(pod: TrafficPod, time: SimTime): void {
    const mission = this.missions.get(pod.missionId ?? '');
    const requester = this.stations.get(mission?.requesterId ?? '');
    if (mission === undefined || requester?.buffer === undefined) return;
    if (requester.buffer.freeSpace < pod.cargo) {
      pod.state = 'DESTINATION_BLOCKED';
      mission.status = 'BLOCKED';
      return;
    }
    requester.buffer.add(pod.cargo);
    pod.cargo = 0;
    delete pod.resourceId;
    mission.status = 'DELIVERED';
    this.unindexActiveMission(mission);
    if (requester.berthVehicleId === pod.id) delete requester.berthVehicleId;
    delete pod.missionId;
    delete pod.route;
    pod.state = 'IDLE';
    if (this.#deferAutomaticDispatch) this.#deferredDepotPods.add(pod.id);
    else {
      const assigned = this.dispatch(time).length > 0 && pod.state !== 'IDLE';
      if (!assigned) this.sendToDepot(pod, time);
    }
    this.wakeWaiting(time);
  }

  private sendToDepot(pod: TrafficPod, time: SimTime): void {
    const depot = [...this.stations.values()]
      .filter(
        (station) =>
          station.role === 'depot' &&
          (station.reservedDepotSlots ?? 0) <
            (station.depotCapacity ?? Number.MAX_SAFE_INTEGER),
      )
      .flatMap((station) => {
        const route = this.rails.route(pod.nodeId, station.railNodeId);
        return route === undefined ? [] : [{ station, route }];
      })
      .sort(
        (a, b) =>
          a.route.distance - b.route.distance ||
          a.station.id.localeCompare(b.station.id),
      )[0];
    if (depot === undefined) return;
    depot.station.reservedDepotSlots =
      (depot.station.reservedDepotSlots ?? 0) + 1;
    pod.reservedDepotId = depot.station.id;
    this.beginRoute(pod, depot.route, 'TO_DEPOT', time);
  }

  private routeDeferredDepotPods(time: SimTime): void {
    const pending = [...this.#deferredDepotPods];
    this.#deferredDepotPods.clear();
    for (const podId of pending) {
      const pod = this.pods.get(podId);
      if (pod?.state === 'IDLE' && pod.missionId === undefined)
        this.sendToDepot(pod, time);
    }
  }

  private wakeWaiting(time: SimTime): void {
    for (const pod of [...this.pods.values()]
      .filter((item) => item.state === 'WAITING_BLOCK')
      .sort((a, b) => a.id.localeCompare(b.id)))
      this.tryNextEdge(pod, time);
    for (const pod of [...this.pods.values()]
      .filter((item) => item.state === 'WAITING_BERTH')
      .sort((a, b) => a.id.localeCompare(b.id))) {
      if (pod.resumeState === 'LOADING') this.beginLoading(pod, time);
      else if (pod.resumeState === 'UNLOADING') this.beginUnloading(pod, time);
    }
  }

  private detectGridlock(): void {
    this.diagnostics.length = 0;
    const dependencies = new Map<string, string>();
    for (const pod of this.pods.values())
      if (pod.state === 'WAITING_BLOCK') {
        const edgeId = pod.route?.edgeIds[pod.routeIndex];
        const block =
          edgeId === undefined
            ? undefined
            : this.rails.blocks.get(`block:${edgeId}`);
        const blocker = block?.occupantId ?? block?.reservedById;
        if (blocker !== undefined && blocker !== pod.id)
          dependencies.set(pod.id, blocker);
      }
    const reported = new Set<string>();
    for (const start of [...dependencies.keys()].sort()) {
      const path: string[] = [];
      const positions = new Map<string, number>();
      let current: string | undefined = start;
      while (
        current !== undefined &&
        !positions.has(current) &&
        !reported.has(current)
      ) {
        positions.set(current, path.length);
        path.push(current);
        current = dependencies.get(current);
      }
      if (current === undefined || !positions.has(current)) continue;
      const cycle = path.slice(positions.get(current)).sort();
      const key = cycle.join('|');
      if (reported.has(key)) continue;
      cycle.forEach((id) => reported.add(id));
      reported.add(key);
      this.diagnostics.push({ code: 'GRIDLOCK', podIds: cycle });
    }
  }
  private stationAt(nodeId: string): Station | undefined {
    return [...this.stations.values()].find(
      (station) => station.railNodeId === nodeId,
    );
  }
  private schedule(
    time: SimTime,
    podId: string,
    type: TrafficEvent['type'],
  ): void {
    this.#pushEvent({ time, podId, type, sequence: ++this.#sequence });
  }
  #pushEvent(event: TrafficEvent): void {
    this.#events.push(event);
    let index = this.#events.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.#compareEvents(this.#events[parent]!, event) <= 0) break;
      this.#events[index] = this.#events[parent]!;
      index = parent;
    }
    this.#events[index] = event;
  }
  #popEvent(): TrafficEvent | undefined {
    const first = this.#events[0];
    const last = this.#events.pop();
    if (first === undefined || last === undefined) return first;
    if (this.#events.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.#events.length) break;
      const right = left + 1;
      const child =
        right < this.#events.length &&
        this.#compareEvents(this.#events[right]!, this.#events[left]!) < 0
          ? right
          : left;
      if (this.#compareEvents(last, this.#events[child]!) <= 0) break;
      this.#events[index] = this.#events[child]!;
      index = child;
    }
    this.#events[index] = last;
    return first;
  }
  #heapifyEvents(): void {
    for (
      let index = Math.floor(this.#events.length / 2) - 1;
      index >= 0;
      index -= 1
    ) {
      const event = this.#events[index]!;
      let current = index;
      while (true) {
        const left = current * 2 + 1;
        if (left >= this.#events.length) break;
        const right = left + 1;
        const child =
          right < this.#events.length &&
          this.#compareEvents(this.#events[right]!, this.#events[left]!) < 0
            ? right
            : left;
        if (this.#compareEvents(event, this.#events[child]!) <= 0) break;
        this.#events[current] = this.#events[child]!;
        current = child;
      }
      this.#events[current] = event;
    }
  }
  #compareEvents(left: TrafficEvent, right: TrafficEvent): number {
    return (
      compareTime(left.time, right.time) ||
      left.podId.localeCompare(right.podId) ||
      left.sequence - right.sequence
    );
  }

  private addMission(mission: TrafficMission): void {
    this.missions.set(mission.id, mission);
    if (mission.status !== 'DELIVERED') this.indexActiveMission(mission);
  }

  private removeMission(missionId: string): void {
    const mission = this.missions.get(missionId);
    if (mission === undefined) return;
    this.missions.delete(missionId);
    if (mission.status !== 'DELIVERED') this.unindexActiveMission(mission);
  }

  private indexActiveMission(mission: TrafficMission): void {
    for (const stationId of new Set([
      mission.providerId,
      mission.requesterId,
    ])) {
      let missionIds = this.#activeMissionIdsByStation.get(stationId);
      if (missionIds === undefined) {
        missionIds = new Set();
        this.#activeMissionIdsByStation.set(stationId, missionIds);
      }
      missionIds.add(mission.id);
    }
  }

  private unindexActiveMission(mission: TrafficMission): void {
    for (const stationId of new Set([
      mission.providerId,
      mission.requesterId,
    ])) {
      const missionIds = this.#activeMissionIdsByStation.get(stationId);
      missionIds?.delete(mission.id);
      if (missionIds?.size === 0)
        this.#activeMissionIdsByStation.delete(stationId);
    }
  }

  private createReservations(): TrafficReservations {
    const reservations: TrafficReservations = {
      byRequester: new Map(),
      byStorage: new Map(),
      byStorageResource: new Map(),
      byBuffer: new Map(),
    };
    for (const mission of this.missions.values()) {
      if (mission.status === 'DELIVERED') continue;
      increment(
        reservations.byRequester,
        mission.requesterId,
        mission.quantity,
      );
      const destination = this.stations.get(mission.requesterId);
      if (destination === undefined || destination.buffer === undefined)
        continue;
      const buffer = destination.buffer;
      if (destination.storageId === undefined)
        increment(reservations.byBuffer, buffer, mission.quantity);
      else {
        increment(
          reservations.byStorage,
          destination.storageId,
          mission.quantity,
        );
        incrementStorageResource(
          reservations.byStorageResource,
          destination.storageId,
          mission.resourceId,
          mission.quantity,
        );
      }
    }
    return reservations;
  }

  private reserveDestination(
    reservations: TrafficReservations,
    destination: Station,
    resourceId: ResourceId,
    quantity: number,
  ): void {
    increment(reservations.byRequester, destination.id, quantity);
    const buffer = destination.buffer;
    if (buffer === undefined) return;
    if (destination.storageId === undefined)
      increment(reservations.byBuffer, buffer, quantity);
    else {
      increment(reservations.byStorage, destination.storageId, quantity);
      incrementStorageResource(
        reservations.byStorageResource,
        destination.storageId,
        resourceId,
        quantity,
      );
    }
  }

  private destinationCapacity(
    destination: Station,
    reservations: TrafficReservations,
  ): number {
    const buffer = destination.buffer;
    if (buffer === undefined) return 0;
    if (destination.storageId === undefined)
      return Math.max(
        0,
        buffer.freeSpace - (reservations.byBuffer.get(buffer) ?? 0),
      );
    const shared = (
      buffer as typeof buffer & {
        readonly inventory?: { readonly freeSpace?: number };
      }
    ).inventory;
    const totalFree =
      shared?.freeSpace ?? destination.storageFreeSpace ?? buffer.freeSpace;
    const pendingResource =
      reservations.byStorageResource
        .get(destination.storageId)
        ?.get(buffer.resourceId) ?? 0;
    return Math.max(
      0,
      Math.min(
        totalFree - (reservations.byStorage.get(destination.storageId) ?? 0),
        buffer.freeSpace - pendingResource,
        (destination.stockMaximum ?? Number.MAX_SAFE_INTEGER) -
          buffer.quantity -
          pendingResource,
      ),
    );
  }
}

export const stationBuffer = (station: Station): WorldBuffer | undefined =>
  station.buffer;
