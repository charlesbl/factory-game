import rawItems from '../data/items.json'
import rawRecipes from '../data/recipes.json'
import { parseRate } from './fixed'
import { asId } from './ids'
import { gridSize } from './geometry'
import { resourceColour, type ItemQuantity, type RecipeDefinition, type ResourceDefinition, type WorldContent } from './definitions'
import type { RecipeId, ResourceId } from './ids'

interface RawItem { id: string; name: string }
interface RawIngredient { itemId: string; quantity: number }
interface RawRecipe { id: string; name: string; input: RawIngredient[]; output: RawIngredient[]; buildCost?: RawIngredient[] }

export const resources: readonly ResourceDefinition[] = (rawItems as RawItem[]).map((item, index) => ({
  id: asId<ResourceId>(item.id), name: item.name, colour: resourceColour(index),
}))

const quantity = (entry: RawIngredient) => {
  if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 0) throw new Error('Recipe quantities must be non-negative integers')
  return { resourceId: asId<ResourceId>(entry.itemId), rate: parseRate(String(entry.quantity)) }
}
const buildItem = (entry: RawIngredient) => { if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 0) throw new Error('Build quantities must be non-negative integers'); return { resourceId: asId<ResourceId>(entry.itemId), quantity: entry.quantity } }

export const recipes: readonly RecipeDefinition[] = (rawRecipes as RawRecipe[]).map((recipe) => ({
  id: asId<RecipeId>(recipe.id), name: recipe.name, inputs: recipe.input.map(quantity), outputs: recipe.output.map(quantity), ...(recipe.buildCost === undefined ? {} : { buildCost: recipe.buildCost.map(buildItem) }),
}))

export const resourceById = new Map(resources.map((resource) => [resource.id, resource]))
export const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]))

const items = (ironPlate: number, copperWire = 0, circuit = 0): readonly ItemQuantity[] => [
  ...(ironPlate === 0 ? [] : [{ resourceId: asId<ResourceId>('ironPlate'), quantity: ironPlate }]),
  ...(copperWire === 0 ? [] : [{ resourceId: asId<ResourceId>('copperWire'), quantity: copperWire }]),
  ...(circuit === 0 ? [] : [{ resourceId: asId<ResourceId>('circuit'), quantity: circuit }]),
]

export const worldContent: WorldContent = {
  schemaVersion: 1,
  componentBuildCosts: { 'external-input': items(1), 'external-output': items(1), junction: items(2, 2) },
  buildings: [
    { id: 'mine', kind: 'mine', name: 'Mine head', footprint: gridSize(4, 4), buildCost: items(20, 0, 4) },
    { id: 'storage', kind: 'storage', name: 'Storage', footprint: gridSize(4, 4), buildCost: items(16, 0, 2) },
    { id: 'depot', kind: 'depot', name: 'Pod depot', footprint: gridSize(4, 4), buildCost: items(20, 0, 4) },
  ],
  drill: { footprint: gridSize(1, 1), buildCost: items(5, 2), extractionIntervalTicks: 1_000_000n, outputCapacity: 100 },
  stationFootprint: gridSize(2, 2), storageCapacity: 500, depotCapacity: 8,
}
