import { ceilingDivide, TIME_TICKS_PER_SECOND, worldQuantity } from '../domain';
import type { ResourceId, SimTime } from '../domain';
import type { WorldBuffer } from '../simulation';
import type { RailNetwork, RailRoute } from './rail';

/** `provider` remains the serialized name for passive providers. */
export type StationRole =
  'provider' | 'active-provider' | 'requester' | 'storage' | 'depot';
export interface Station {
  readonly id: string;
  readonly railNodeId: string;
  readonly role: StationRole;
  readonly buffer?: WorldBuffer;
  readonly priority: number;
  readonly target: number;
  readonly minBatch: number;
  readonly maxBatch: number;
  readonly requestCreatedAt?: SimTime;
  /** Shared inventory key for storage stations that expose resource buffers. */
  readonly storageId?: string;
  /** Current total free capacity in the shared inventory, refreshed by runtime. */
  readonly storageFreeSpace?: number;
  readonly stockMaximum?: number;
  readonly depotCapacity?: number;
  berthVehicleId?: string;
  reservedDepotSlots?: number;
}
export type VehicleState = 'IDLE' | 'IN_TRANSIT' | 'DESTINATION_BLOCKED';
export interface Vehicle {
  readonly id: string;
  readonly capacity: number;
  readonly speed: bigint;
  state: VehicleState;
  cargo: number;
  resourceId?: ResourceId;
  stationId: string;
}
export interface DeliveryJob {
  readonly id: string;
  readonly providerId: string;
  readonly requesterId: string;
  readonly vehicleId: string;
  readonly resourceId: ResourceId;
  readonly quantity: number;
  readonly route: RailRoute;
  readonly arrival: SimTime;
  status: 'IN_TRANSIT' | 'BLOCKED' | 'DELIVERED';
}

interface DispatcherReservations {
  readonly byRequester: Map<string, number>;
  readonly byStorage: Map<string, number>;
  readonly byStorageResource: Map<string, Map<ResourceId, number>>;
  readonly byBuffer: Map<WorldBuffer, number>;
}

interface VehicleRouteChoice {
  readonly vehicle: Vehicle;
  readonly distance: number;
}

interface VehicleRouteCursor {
  readonly choices: readonly VehicleRouteChoice[];
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

export class LogisticsDispatcher {
  readonly stations = new Map<string, Station>();
  readonly vehicles = new Map<string, Vehicle>();
  readonly jobs = new Map<string, DeliveryJob>();
  #sequence = 0;
  constructor(readonly rails: RailNetwork) {}
  addStation(station: Station): void {
    this.stations.set(station.id, station);
  }
  addVehicle(vehicle: Vehicle): void {
    worldQuantity(vehicle.capacity);
    if (vehicle.speed <= 0n) throw new Error('Vehicle speed must be positive');
    this.vehicles.set(vehicle.id, vehicle);
  }
  dispatch(time: SimTime): readonly DeliveryJob[] {
    const created: DeliveryJob[] = [];
    const reservations = this.createReservations();
    let remainingIdleVehicles = [...this.vehicles.values()].filter(
      (vehicle) => vehicle.state === 'IDLE',
    ).length;
    if (remainingIdleVehicles === 0) return created;
    const vehicleRouteCursors = new Map<
      string,
      Map<number, VehicleRouteCursor>
    >();
    const nextIdleVehicle = (
      provider: Station,
      minBatch: number,
    ): Vehicle | undefined => {
      let cursors = vehicleRouteCursors.get(provider.id);
      if (cursors === undefined) {
        cursors = new Map();
        vehicleRouteCursors.set(provider.id, cursors);
      }
      let cursor = cursors.get(minBatch);
      if (cursor === undefined) {
        const choices = [...this.vehicles.values()]
          .filter(
            (vehicle) =>
              vehicle.state === 'IDLE' && vehicle.capacity >= minBatch,
          )
          .flatMap((vehicle) => {
            const location = this.stations.get(vehicle.stationId);
            if (location === undefined) return [];
            const route = this.rails.route(
              location.railNodeId,
              provider.railNodeId,
            );
            return route === undefined
              ? []
              : [{ vehicle, distance: route.distance }];
          })
          .sort(
            (a, b) =>
              a.distance - b.distance ||
              a.vehicle.id.localeCompare(b.vehicle.id),
          );
        cursor = { choices, index: 0 };
        cursors.set(minBatch, cursor);
      }
      while (cursor.index < cursor.choices.length) {
        const choice = cursor.choices[cursor.index]!;
        cursor.index += 1;
        if (choice.vehicle.state === 'IDLE') return choice.vehicle;
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
          ((a.requestCreatedAt ?? time) < (b.requestCreatedAt ?? time)
            ? -1
            : (a.requestCreatedAt ?? time) > (b.requestCreatedAt ?? time)
              ? 1
              : a.id.localeCompare(b.id)),
      );
    for (const requester of requesters) {
      if (remainingIdleVehicles === 0) break;
      const buffer = requester.buffer!;
      const inbound = reservations.byRequester.get(requester.id) ?? 0;
      let wanted = requester.target - buffer.quantity - inbound;
      const providers = (providersByResource.get(buffer.resourceId) ?? [])
        .filter(
          (station) =>
            (station.storageId === undefined ||
              station.storageId !== requester.storageId) &&
            !(
              station.role === 'storage' &&
              requester.role === 'storage' &&
              station.buffer!.quantity <= station.target
            ) &&
            station.buffer !== buffer &&
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
      while (wanted >= requester.minBatch) {
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
              station: Station;
              route: RailRoute;
              vehicle: Vehicle;
            }
          | undefined;
        while (providerIndex < providers.length) {
          const candidate = providers[providerIndex]!;
          if (
            candidate.station.buffer === undefined ||
            candidate.station.buffer.quantity < requester.minBatch
          ) {
            providerIndex += 1;
            continue;
          }
          const vehicle = nextIdleVehicle(
            candidate.station,
            requester.minBatch,
          );
          if (vehicle === undefined) {
            providerIndex += 1;
            continue;
          }
          selection = { ...candidate, vehicle };
          break;
        }
        if (selection?.station.buffer === undefined) break;
        const providerBuffer = selection.station.buffer;
        const quantity = Math.min(
          wanted,
          requester.maxBatch,
          requester.role === 'storage' && selection.station.role === 'storage'
            ? Math.max(0, providerBuffer.quantity - selection.station.target)
            : providerBuffer.quantity,
          selection.vehicle.capacity,
          destinationCapacity,
        );
        if (quantity < requester.minBatch) break;
        providerBuffer.remove(quantity);
        selection.vehicle.state = 'IN_TRANSIT';
        selection.vehicle.cargo = quantity;
        selection.vehicle.resourceId = buffer.resourceId;
        const travel = ceilingDivide(
          BigInt(selection.route.distance) * TIME_TICKS_PER_SECOND,
          selection.vehicle.speed,
        );
        const job: DeliveryJob = {
          id: `delivery-${++this.#sequence}`,
          providerId: selection.station.id,
          requesterId: requester.id,
          vehicleId: selection.vehicle.id,
          resourceId: buffer.resourceId,
          quantity,
          route: selection.route,
          arrival: time + travel,
          status: 'IN_TRANSIT',
        };
        this.jobs.set(job.id, job);
        this.reserveDestination(
          reservations,
          requester,
          buffer.resourceId,
          quantity,
        );
        created.push(job);
        wanted -= quantity;
        remainingIdleVehicles -= 1;
        if (remainingIdleVehicles === 0) break;
      }
    }

    // Requesters get first claim on idle vehicles. Active providers can then
    // send what remains to marked storage inventories with free capacity.
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
    for (const provider of [...this.stations.values()]
      .filter(
        (station) =>
          (station.role === 'active-provider' || station.role === 'storage') &&
          station.buffer !== undefined &&
          station.buffer.quantity >= station.minBatch,
      )
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
      if (remainingIdleVehicles === 0) break;
      const source = provider.buffer;
      if (source === undefined) continue;
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
        while (
          source.quantity >= provider.minBatch &&
          remainingIdleVehicles > 0
        ) {
          const capacity = this.destinationCapacity(
            destination.station,
            reservations,
          );
          const available = Math.min(
            Math.max(0, source.quantity - (provider.stockMaximum ?? 0)),
            provider.maxBatch,
            destination.station.maxBatch,
            capacity,
          );
          if (available < provider.minBatch) break;
          const vehicle = nextIdleVehicle(provider, provider.minBatch);
          if (vehicle === undefined) break;
          const quantity = Math.min(available, vehicle.capacity);
          if (quantity < provider.minBatch) break;
          const route = destination.route;
          source.remove(quantity);
          vehicle.state = 'IN_TRANSIT';
          vehicle.cargo = quantity;
          vehicle.resourceId = source.resourceId;
          const travel = ceilingDivide(
            BigInt(route.distance) * TIME_TICKS_PER_SECOND,
            vehicle.speed,
          );
          const job: DeliveryJob = {
            id: `delivery-${++this.#sequence}`,
            providerId: provider.id,
            requesterId: destination.station.id,
            vehicleId: vehicle.id,
            resourceId: source.resourceId,
            quantity,
            route,
            arrival: time + travel,
            status: 'IN_TRANSIT',
          };
          this.jobs.set(job.id, job);
          this.reserveDestination(
            reservations,
            destination.station,
            source.resourceId,
            quantity,
          );
          created.push(job);
          remainingIdleVehicles -= 1;
        }
      }
    }
    return created;
  }

  private createReservations(): DispatcherReservations {
    const reservations: DispatcherReservations = {
      byRequester: new Map(),
      byStorage: new Map(),
      byStorageResource: new Map(),
      byBuffer: new Map(),
    };
    for (const job of this.jobs.values()) {
      if (job.status === 'DELIVERED') continue;
      increment(reservations.byRequester, job.requesterId, job.quantity);
      const destination = this.stations.get(job.requesterId);
      if (destination === undefined || destination.buffer === undefined)
        continue;
      const buffer = destination.buffer;
      if (destination.storageId === undefined)
        increment(reservations.byBuffer, buffer, job.quantity);
      else {
        increment(reservations.byStorage, destination.storageId, job.quantity);
        incrementStorageResource(
          reservations.byStorageResource,
          destination.storageId,
          job.resourceId,
          job.quantity,
        );
      }
    }
    return reservations;
  }

  private reserveDestination(
    reservations: DispatcherReservations,
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
    reservations: DispatcherReservations,
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
  advanceTo(time: SimTime): void {
    const arrivals = [...this.jobs.values()]
      .filter((job) => job.status !== 'DELIVERED' && job.arrival <= time)
      .sort((a, b) =>
        a.arrival < b.arrival
          ? -1
          : a.arrival > b.arrival
            ? 1
            : a.vehicleId.localeCompare(b.vehicleId),
      );
    for (const job of arrivals) {
      const requester = this.stations.get(job.requesterId);
      const vehicle = this.vehicles.get(job.vehicleId);
      if (requester?.buffer === undefined || vehicle === undefined) continue;
      if (requester.buffer.freeSpace < vehicle.cargo) {
        job.status = 'BLOCKED';
        vehicle.state = 'DESTINATION_BLOCKED';
        continue;
      }
      requester.buffer.add(vehicle.cargo);
      vehicle.cargo = 0;
      delete vehicle.resourceId;
      vehicle.state = 'IDLE';
      vehicle.stationId = requester.id;
      job.status = 'DELIVERED';
    }
  }
  wakeBlocked(time: SimTime): void {
    this.advanceTo(time);
  }
}
