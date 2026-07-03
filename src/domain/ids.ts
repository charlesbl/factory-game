declare const brand: unique symbol

export type BrandedId<Name extends string> = string & { readonly [brand]: Name }
export type FactoryId = BrandedId<'FactoryId'>
export type NodeId = BrandedId<'NodeId'>
export type PortId = BrandedId<'PortId'>
export type EdgeId = BrandedId<'EdgeId'>
export type NetId = BrandedId<'NetId'>
export type TrackId = BrandedId<'TrackId'>
export type TransitionId = BrandedId<'TransitionId'>
export type RouteConnectorId = BrandedId<'RouteConnectorId'>
export type LooseConnectionId = BrandedId<'LooseConnectionId'>
export type ResourceId = BrandedId<'ResourceId'>
export type RecipeId = BrandedId<'RecipeId'>
export type MachineId = BrandedId<'MachineId'>
export type ContractId = BrandedId<'ContractId'>
export type InstanceId = BrandedId<'InstanceId'>

export interface IdFactory {
  next<Name extends string>(prefix: Name): BrandedId<Name>
}

export const createIdFactory = (seed = 0): IdFactory => {
  let sequence = seed
  return {
    next<Name extends string>(prefix: Name): BrandedId<Name> {
      sequence += 1
      return `${prefix}-${sequence.toString(36).padStart(6, '0')}` as BrandedId<Name>
    },
  }
}

export const asId = <T extends BrandedId<string>>(value: string): T => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new Error(`Invalid stable ID: ${value}`)
  return value as T
}
