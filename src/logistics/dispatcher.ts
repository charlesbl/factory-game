import { ceilingDivide, TIME_TICKS_PER_SECOND, worldQuantity } from '../domain';
import type { ResourceId, SimTime } from '../domain';
import type { WorldBuffer } from '../simulation';
import type { RailNetwork, RailRoute } from './rail';

export type StationRole = 'provider' | 'requester' | 'depot';
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
          ((a.requestCreatedAt ?? time) < (b.requestCreatedAt ?? time)
            ? -1
            : (a.requestCreatedAt ?? time) > (b.requestCreatedAt ?? time)
              ? 1
              : a.id.localeCompare(b.id)),
      );
    for (const requester of requesters) {
      const buffer = requester.buffer!;
      const wanted = requester.target - buffer.quantity;
      const providers = [...this.stations.values()]
        .filter(
          (station) =>
            station.role === 'provider' &&
            station.buffer?.resourceId === buffer.resourceId &&
            (station.buffer?.quantity ?? 0) >= requester.minBatch,
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
      const selected = providers[0];
      if (selected?.station.buffer === undefined) continue;
      const provider = selected.station;
      const providerBuffer = provider.buffer;
      const route = selected.route;
      if (providerBuffer === undefined) continue;
      const vehicle = [...this.vehicles.values()]
        .filter(
          (item) =>
            item.state === 'IDLE' && item.capacity >= requester.minBatch,
        )
        .flatMap((item) => {
          const location = this.stations.get(item.stationId);
          if (location === undefined) return [];
          const approach = this.rails.route(
            location.railNodeId,
            provider.railNodeId,
          );
          return approach === undefined
            ? []
            : [{ item, distance: approach.distance }];
        })
        .sort(
          (a, b) =>
            a.distance - b.distance || a.item.id.localeCompare(b.item.id),
        )[0]?.item;
      if (vehicle === undefined) continue;
      const quantity = Math.min(
        wanted,
        requester.maxBatch,
        providerBuffer.quantity,
        vehicle.capacity,
      );
      if (quantity < requester.minBatch) continue;
      providerBuffer.remove(quantity);
      vehicle.state = 'IN_TRANSIT';
      vehicle.cargo = quantity;
      vehicle.resourceId = buffer.resourceId;
      const travel = ceilingDivide(
        BigInt(route.distance) * TIME_TICKS_PER_SECOND,
        vehicle.speed,
      );
      const job: DeliveryJob = {
        id: `delivery-${++this.#sequence}`,
        providerId: provider.id,
        requesterId: requester.id,
        vehicleId: vehicle.id,
        resourceId: buffer.resourceId,
        quantity,
        route,
        arrival: time + travel,
        status: 'IN_TRANSIT',
      };
      this.jobs.set(job.id, job);
      created.push(job);
    }
    return created;
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
