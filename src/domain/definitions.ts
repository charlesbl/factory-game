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
  readonly maxConnections: number
}
export interface ResourceDefinition { readonly id: ResourceId; readonly name: string; readonly colour: string }
export interface RecipeQuantity { readonly resourceId: ResourceId; readonly rate: RateRaw }
export interface RecipeDefinition {
  readonly id: RecipeId
  readonly name: string
  readonly inputs: readonly RecipeQuantity[]
  readonly outputs: readonly RecipeQuantity[]
}
export interface MachineDefinition {
  readonly id: MachineId
  readonly name: string
  readonly recipeIds: readonly RecipeId[]
  readonly footprint: GridSize
  readonly ports: readonly PortDefinition[]
}

const colours = ['#e17a47', '#eab464', '#8ecae6', '#5cc8a1', '#c792ea', '#f4d35e', '#ef6f6c', '#7bdff2']
export const resourceColour = (index: number): string => colours[index % colours.length]!
