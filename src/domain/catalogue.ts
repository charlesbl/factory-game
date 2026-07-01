import rawItems from '../data/items.json'
import rawRecipes from '../data/recipes.json'
import { parseRate } from './fixed'
import { asId } from './ids'
import { resourceColour, type RecipeDefinition, type ResourceDefinition } from './definitions'
import type { RecipeId, ResourceId } from './ids'

interface RawItem { id: string; name: string }
interface RawIngredient { itemId: string; quantity: number }
interface RawRecipe { id: string; name: string; input: RawIngredient[]; output: RawIngredient[] }

export const resources: readonly ResourceDefinition[] = (rawItems as RawItem[]).map((item, index) => ({
  id: asId<ResourceId>(item.id), name: item.name, colour: resourceColour(index),
}))

const quantity = (entry: RawIngredient) => {
  if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 0) throw new Error('Recipe quantities must be non-negative integers')
  return { resourceId: asId<ResourceId>(entry.itemId), rate: parseRate(String(entry.quantity)) }
}

export const recipes: readonly RecipeDefinition[] = (rawRecipes as RawRecipe[]).map((recipe) => ({
  id: asId<RecipeId>(recipe.id), name: recipe.name, inputs: recipe.input.map(quantity), outputs: recipe.output.map(quantity),
}))

export const resourceById = new Map(resources.map((resource) => [resource.id, resource]))
export const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]))
