import type { GridPoint, GridSize } from './geometry'
import type { MachineId, PortId, RecipeId, ResourceId } from './ids'
import type { RateRaw } from './fixed'

export type PortDirection = 'input' | 'output'
export interface PortDefinition {
  readonly id: PortId
  readonly direction: PortDirection
  readonly resourceId: ResourceId
  readonly capacity: RateRaw
  readonly anchor: GridPoint
}
export interface ResourceDefinition { readonly id: ResourceId; readonly name: string; readonly colour: string }
export interface RecipeQuantity { readonly resourceId: ResourceId; readonly rate: RateRaw }
export interface ItemQuantity { readonly resourceId: ResourceId; readonly quantity: number }
export interface RecipeDefinition {
  readonly id: RecipeId
  readonly name: string
  readonly inputs: readonly RecipeQuantity[]
  readonly outputs: readonly RecipeQuantity[]
  readonly buildCost?: readonly ItemQuantity[]
}
export interface MachineDefinition {
  readonly id: MachineId
  readonly name: string
  readonly recipeIds: readonly RecipeId[]
  readonly footprint: GridSize
  readonly ports: readonly PortDefinition[]
  readonly buildCost?: readonly ItemQuantity[]
}
export interface WorldBuildingDefinition { readonly id: string; readonly kind: 'mine' | 'storage' | 'depot'; readonly name: string; readonly footprint: GridSize; readonly buildCost: readonly ItemQuantity[] }
export interface WorldContent {
  readonly schemaVersion: 1
  readonly componentBuildCosts: Readonly<Record<'external-input' | 'external-output' | 'junction', readonly ItemQuantity[]>>
  readonly buildings: readonly WorldBuildingDefinition[]
  readonly drill: { readonly footprint: GridSize; readonly buildCost: readonly ItemQuantity[]; readonly extractionIntervalTicks: bigint; readonly outputCapacity: number }
  readonly stationFootprint: GridSize
  readonly storageCapacity: number
  readonly depotCapacity: number
}

const colours = ['#e17a47', '#eab464', '#8ecae6', '#5cc8a1', '#c792ea', '#f4d35e', '#ef6f6c', '#7bdff2']
export const resourceColour = (index: number): string => colours[index % colours.length]!
