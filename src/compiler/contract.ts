import { asId } from '../domain';
import type {
  EdgeId,
  GridPoint,
  GridRect,
  ItemQuantity,
  NodeId,
  PortId,
  ResourceId,
} from '../domain';
import type { FixedRatio, RateRaw } from '../domain';
import type { CompileDiagnostic } from './diagnostics';

export interface CompiledPort {
  readonly portId: PortId;
  readonly resourceId: ResourceId;
  readonly capacity: RateRaw;
  readonly rate?: RateRaw;
  readonly position: GridPoint;
}
export interface FactoryContract {
  readonly schemaVersion: 1;
  readonly blueprintHash: string;
  readonly inputRates: ReadonlyMap<ResourceId, RateRaw>;
  readonly outputRates: ReadonlyMap<ResourceId, RateRaw>;
  readonly inputPorts: readonly CompiledPort[];
  readonly outputPorts: readonly CompiledPort[];
  readonly footprint: GridRect;
  readonly machineActivity: ReadonlyMap<NodeId, FixedRatio>;
  readonly edgeFlows: ReadonlyMap<EdgeId, RateRaw>;
  readonly diagnostics: readonly CompileDiagnostic[];
  readonly billOfMaterials?: readonly ItemQuantity[];
}

export interface SerializedFactoryContract {
  readonly schemaVersion: 1;
  readonly blueprintHash: string;
  readonly inputRates: readonly [string, string][];
  readonly outputRates: readonly [string, string][];
  readonly inputPorts: readonly {
    portId: string;
    resourceId: string;
    capacity: string;
    rate?: string;
    position: GridPoint;
  }[];
  readonly outputPorts: readonly {
    portId: string;
    resourceId: string;
    capacity: string;
    rate?: string;
    position: GridPoint;
  }[];
  readonly footprint: GridRect;
  readonly machineActivity: readonly [string, string][];
  readonly edgeFlows: readonly [string, string][];
  readonly diagnostics: readonly CompileDiagnostic[];
  readonly billOfMaterials?: readonly {
    readonly resourceId: string;
    readonly quantity: number;
  }[];
}
export const serializeContract = (
  contract: FactoryContract,
): SerializedFactoryContract => ({
  ...contract,
  inputRates: [...contract.inputRates]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, value]) => [id, value.toString()]),
  outputRates: [...contract.outputRates]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, value]) => [id, value.toString()]),
  inputPorts: contract.inputPorts.map((port) => ({
    portId: port.portId,
    resourceId: port.resourceId,
    capacity: port.capacity.toString(),
    position: port.position,
    ...(port.rate === undefined ? {} : { rate: port.rate.toString() }),
  })),
  outputPorts: contract.outputPorts.map((port) => ({
    portId: port.portId,
    resourceId: port.resourceId,
    capacity: port.capacity.toString(),
    position: port.position,
    ...(port.rate === undefined ? {} : { rate: port.rate.toString() }),
  })),
  machineActivity: [...contract.machineActivity]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, value]) => [id, value.toString()]),
  edgeFlows: [...contract.edgeFlows]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, value]) => [id, value.toString()]),
  billOfMaterials: (contract.billOfMaterials ?? []).map((item) => ({
    resourceId: item.resourceId,
    quantity: item.quantity,
  })),
});

export const deserializeContract = (
  contract: SerializedFactoryContract,
): FactoryContract => ({
  schemaVersion: 1,
  blueprintHash: contract.blueprintHash,
  inputRates: new Map(
    contract.inputRates.map(([id, value]) => [
      asId<ResourceId>(id),
      BigInt(value),
    ]),
  ),
  outputRates: new Map(
    contract.outputRates.map(([id, value]) => [
      asId<ResourceId>(id),
      BigInt(value),
    ]),
  ),
  inputPorts: contract.inputPorts.map((port) => ({
    portId: asId<PortId>(port.portId),
    resourceId: asId<ResourceId>(port.resourceId),
    capacity: BigInt(port.capacity),
    position: port.position,
    ...(port.rate === undefined ? {} : { rate: BigInt(port.rate) }),
  })),
  outputPorts: contract.outputPorts.map((port) => ({
    portId: asId<PortId>(port.portId),
    resourceId: asId<ResourceId>(port.resourceId),
    capacity: BigInt(port.capacity),
    position: port.position,
    ...(port.rate === undefined ? {} : { rate: BigInt(port.rate) }),
  })),
  footprint: contract.footprint,
  machineActivity: new Map(
    contract.machineActivity.map(([id, value]) => [
      asId<NodeId>(id),
      BigInt(value),
    ]),
  ),
  edgeFlows: new Map(
    contract.edgeFlows.map(([id, value]) => [asId<EdgeId>(id), BigInt(value)]),
  ),
  diagnostics: contract.diagnostics,
  billOfMaterials: (contract.billOfMaterials ?? []).map((item) => ({
    resourceId: asId<ResourceId>(item.resourceId),
    quantity: item.quantity,
  })),
});
