import Craft from './Craft'
import CraftManager from './CraftManager'
import Ingredient from './Ingredient'
import Inventory from './Inventory'

export default class MachineCraft extends Craft {
    public readonly outputCraft: Craft

    public constructor (id: string, name: string, isCustom: boolean, input: Ingredient[], craft?: Craft, outputCraftId?: string) {
        super(id, name, input, [], isCustom)
        if (craft !== undefined) {
            this.outputCraft = craft
        } else if (outputCraftId !== undefined) {
            this.outputCraft = CraftManager.getBasicCraftById(outputCraftId)
        } else {
            throw Error('no data passed, need craft or outputCraftId')
        }
    }

    public canCraft (inventory: Inventory): boolean {
        return super.canCraft(inventory, 1)
    }
}
