import Item from './Item'
import Ressources from './Resources/Ressources'

export default class Ingredient {
    public readonly item: Item
    public readonly quantityPerSecond: number

    public constructor (item: Item, quantity: number) {
        this.item = item
        this.quantityPerSecond = quantity
    }

    public static mergeIngredient = (ingredients: Ingredient[]): Ingredient[] => {
        const result: { [key: string]: number } = {}
        ingredients.forEach((ingredient: Ingredient) => {
            if (result[ingredient.item.id] == null) {
                result[ingredient.item.id] = 0
            }
            result[ingredient.item.id] += ingredient.quantityPerSecond
        })
        return Object.entries(result).map(([itemId, quantity]) => new Ingredient(Ressources.getItemById(itemId), quantity))
    }
}
