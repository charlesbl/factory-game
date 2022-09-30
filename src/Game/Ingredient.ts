import Item from './Item'
import Ressources from './Resources/Ressources'

export interface IngredientDictionary {
    [key: string]: number
}

export default class Ingredient {
    public readonly item: Item
    public readonly quantityPerSecond: number

    public constructor (item: Item, quantity: number) {
        this.item = item
        this.quantityPerSecond = quantity
    }

    public static ingredientListToDictionary (ingredients: Ingredient[]): IngredientDictionary {
        const result: IngredientDictionary = {}
        ingredients.forEach((ingredient: Ingredient) => {
            result[ingredient.item.id] = ingredient.quantityPerSecond
        })
        return result
    }

    public static ingredientDictionaryToList (ingredients: IngredientDictionary): Ingredient[] {
        const array = Object.entries(ingredients).filter(([, quantity]) => quantity > 0).map(([itemId, quantity]) => new Ingredient(Ressources.getItemById(itemId), quantity)
        )
        return array.filter((ingredient) => ingredient !== undefined)
    }

    public static simplifyIngredient = (inputs: Ingredient[], outputs: Ingredient[]): Ingredient[][] => {
        const inputDict = this.ingredientListToDictionary(inputs)
        const ouputDict = this.ingredientListToDictionary(outputs)

        Ressources.getItems().forEach((item) => {
            const input = inputDict[item.id]
            const output = ouputDict[item.id]
            if (input == null || output == null) {
                return
            }
            if (input >= output) {
                inputDict[item.id] = input - output
                ouputDict[item.id] = 0
            } else {
                inputDict[item.id] = 0
                ouputDict[item.id] = output - input
            }
        })
        return [this.ingredientDictionaryToList(inputDict), this.ingredientDictionaryToList(ouputDict)]
    }

    public static mergeIngredient = (ingredients: Ingredient[]): Ingredient[] => {
        const result: IngredientDictionary = {}
        ingredients.forEach((ingredient: Ingredient) => {
            if (result[ingredient.item.id] == null) {
                result[ingredient.item.id] = 0
            }
            result[ingredient.item.id] += ingredient.quantityPerSecond
        })
        return Object.entries(result).map(([itemId, quantity]) => new Ingredient(Ressources.getItemById(itemId), quantity))
    }
}
