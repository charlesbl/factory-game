import Craft from './Craft'
import Ingredient from './Ingredient'
import Inventory from './Inventory'

export default class MachineCraft extends Craft {
    public readonly outputCraft: Craft

    public constructor (id: string, name: string, input: Ingredient[], outputCraft: Craft) {
        super(id, name, input, [])
        this.outputCraft = outputCraft
    }

    public canCraft (inventory: Inventory): boolean {
        return super.canCraft(inventory, 1)
    }
}
