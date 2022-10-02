import Ingredient from './Ingredient'
import Inventory from './Inventory'

class Craft {
    public readonly id: string
    public readonly name: string
    public readonly input: Ingredient[]
    public readonly output: Ingredient[]
    public readonly isCustom: boolean

    public constructor (id: string, name: string, input: Ingredient[], output: Ingredient[], isCustom: boolean) {
        this.id = id
        this.name = name
        this.input = input
        this.output = output
        this.isCustom = isCustom
    }

    public canCraft (inventory: Inventory, productionTimeInSec: number): boolean {
        let ressourcesAvailable = true
        this.input.forEach((ingredient) => {
            const cost = ingredient.quantityPerSecond * productionTimeInSec
            if (inventory.getQuantity(ingredient.item) < cost) {
                ressourcesAvailable = false
            }
        })
        return ressourcesAvailable
    }

    public tryConsumeCraft (inventory: Inventory, productionTimeInSec: number): boolean {
        if (this.canCraft(inventory, productionTimeInSec)) {
            this.input.forEach((ingredient) => {
                const cost = ingredient.quantityPerSecond * productionTimeInSec
                inventory.removeItem(ingredient.item, cost)
            })
            this.output.forEach((ingredient) => {
                inventory.addItem(ingredient.item, ingredient.quantityPerSecond * productionTimeInSec)
            })
            return true
        } else {
            return false
        }
    }
}
export default Craft
