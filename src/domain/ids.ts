declare const brand: unique symbol;

export type BrandedId<Name extends string> = string & {
  readonly [brand]: Name;
};
export type FactoryId = BrandedId<'FactoryId'>;
export type NodeId = BrandedId<'NodeId'>;
export type PortId = BrandedId<'PortId'>;
export type EdgeId = BrandedId<'EdgeId'>;
export type RouteHandleId = BrandedId<'RouteHandleId'>;
export type RouteBridgeId = BrandedId<'RouteBridgeId'>;
export type LooseConnectionId = BrandedId<'LooseConnectionId'>;
export type ResourceId = BrandedId<'ResourceId'>;
export type RecipeId = BrandedId<'RecipeId'>;
export type MachineId = BrandedId<'MachineId'>;
export type ContractId = BrandedId<'ContractId'>;
export type InstanceId = BrandedId<'InstanceId'>;
export type WorldId = BrandedId<'WorldId'>;
export type WorldEntityId = BrandedId<'WorldEntityId'>;
export type StationId = BrandedId<'StationId'>;
export type RailNodeId = BrandedId<'RailNodeId'>;
export type RailEdgeId = BrandedId<'RailEdgeId'>;
export type RailBlockId = BrandedId<'RailBlockId'>;
export type PodId = BrandedId<'PodId'>;
export type DeliveryId = BrandedId<'DeliveryId'>;
export type ConstructionSiteId = BrandedId<'ConstructionSiteId'>;

export interface IdFactory {
  next<Name extends string>(prefix: Name): BrandedId<Name>;
}

export const createIdFactory = (seed = 0): IdFactory => {
  let sequence = seed;
  return {
    next<Name extends string>(prefix: Name): BrandedId<Name> {
      sequence += 1;
      return `${prefix}-${sequence.toString(36).padStart(6, '0')}` as BrandedId<Name>;
    },
  };
};

export const asId = <T extends BrandedId<string>>(value: string): T => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))
    throw new Error(`Invalid stable ID: ${value}`);
  return value as T;
};
