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

export class PodTrafficSystem {
  readonly stations = new Map<string, Station>();
  readonly pods = new Map<string, TrafficPod>();
  readonly missions = new Map<string, TrafficMission>();
  readonly diagnostics: { code: 'GRIDLOCK'; podIds: readonly string[] }[] = [];
  readonly #events: TrafficEvent[] = [];
  #sequence = 0;
  #missionSequence = 0;
  constructor(readonly rails: RailNetwork) {}
  get nextEventTime(): SimTime | undefined {
    this.#events.sort(
      (a, b) =>
        compareTime(a.time, b.time) ||
        a.podId.localeCompare(b.podId) ||
        a.sequence - b.sequence,
    );
    return this.#events[0]?.time;
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
          minBatch: station.minBatch,
          maxBatch: station.maxBatch,
          ...(station.requestCreatedAt === undefined
            ? {}
            : { requestCreatedAt: station.requestCreatedAt }),
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
        minBatch: station.minBatch,
        maxBatch: station.maxBatch,
        ...(station.requestCreatedAt === undefined
          ? {}
          : { requestCreatedAt: station.requestCreatedAt }),
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
    for (const mission of state.missions)
      system.missions.set(mission.id, { ...mission });
    system.#events.push(...state.events.map((event) => ({ ...event })));
    return system;
  }

  addStation(station: Station): void {
    if (this.stations.has(station.id))
      throw new Error('Duplicate traffic station');
    this.stations.set(station.id, station);
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

  dispatch(time: SimTime): readonly TrafficMission[] {
    const created: TrafficMission[] = [];
    const requesters = [...this.stations.values()]
      .filter(
        (station) =>
          station.role === 'requester' &&
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
      const target = requester.buffer!;
      const wanted = requester.target - target.quantity;
      const providerCandidates = [...this.stations.values()]
        .filter(
          (station) =>
            station.role === 'provider' &&
            station.buffer !== target &&
            station.buffer?.resourceId === target.resourceId &&
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
      const providerCandidate = providerCandidates[0];
      if (providerCandidate?.station.buffer === undefined) continue;
      const podCandidate = [...this.pods.values()]
        .filter(
          (pod) => pod.state === 'IDLE' && pod.capacity >= requester.minBatch,
        )
        .flatMap((pod) => {
          const route = this.rails.route(
            pod.nodeId,
            providerCandidate.station.railNodeId,
          );
          return route === undefined ? [] : [{ pod, route }];
        })
        .sort(
          (a, b) =>
            a.route.distance - b.route.distance ||
            a.pod.id.localeCompare(b.pod.id),
        )[0];
      if (podCandidate === undefined) continue;
      const quantity = Math.min(
        wanted,
        requester.maxBatch,
        providerCandidate.station.buffer.quantity,
        podCandidate.pod.capacity,
      );
      if (quantity < requester.minBatch) continue;
      providerCandidate.station.buffer.remove(quantity);
      const mission: TrafficMission = {
        id: `mission-${++this.#missionSequence}`,
        providerId: providerCandidate.station.id,
        requesterId: requester.id,
        podId: podCandidate.pod.id,
        resourceId: target.resourceId,
        quantity,
        createdAt: time,
        approachRoute: podCandidate.route,
        deliveryRoute: providerCandidate.route,
        status: 'TO_PROVIDER',
      };
      this.missions.set(mission.id, mission);
      created.push(mission);
      const pod = podCandidate.pod;
      pod.missionId = mission.id;
      pod.resourceId = target.resourceId;
      pod.cargo = quantity;
      this.beginRoute(pod, podCandidate.route, 'TO_PROVIDER', time);
    }
    return created;
  }

  advanceTo(target: SimTime, maxEvents = Number.MAX_SAFE_INTEGER): number {
    let processed = 0;
    while (true) {
      this.#events.sort(
        (a, b) =>
          compareTime(a.time, b.time) ||
          a.podId.localeCompare(b.podId) ||
          a.sequence - b.sequence,
      );
      const event = this.#events[0];
      if (event === undefined || event.time > target || processed >= maxEvents)
        break;
      const batchTime = event.time;
      const batch = this.#events
        .filter((item) => item.time === batchTime)
        .sort(
          (a, b) => a.podId.localeCompare(b.podId) || a.sequence - b.sequence,
        );
      for (const item of batch)
        this.#events.splice(this.#events.indexOf(item), 1);
      for (const item of batch) this.process(item);
      this.dispatch(batchTime);
      processed += batch.length;
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
      this.dispatch(time);
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
    if (requester.berthVehicleId === pod.id) delete requester.berthVehicleId;
    delete pod.missionId;
    delete pod.route;
    pod.state = 'IDLE';
    const assigned = this.dispatch(time).length > 0 && pod.state !== 'IDLE';
    if (!assigned) this.sendToDepot(pod, time);
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
    this.#events.push({ time, podId, type, sequence: ++this.#sequence });
  }
}

export const stationBuffer = (station: Station): WorldBuffer | undefined =>
  station.buffer;
