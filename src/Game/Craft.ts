import Ingredient from './Ingredient'
import Inventory from './Inventory'

class Craft {
    public readonly id: string
    public readonly name: string
    public readonly input: Ingredient[]
    public readonly output: Ingredient[]

    public constructor (id: string, name: string, input: Ingredient[], output: Ingredient[]) {
        this.id = id
        this.name = name
        this.input = input
        this.output = output
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
}
export default Craft
