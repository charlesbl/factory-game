import Craft from './Craft'
import CraftManager from './CraftManager'
import Factory from './Factory'
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

    public tryConsumeMachineCraft (inventory: Inventory, factory: Factory): boolean {
        if (super.tryConsumeCraft(inventory, 1)) {
            factory.buildMachine(this)
            return true
        } else {
            return false
        }
    }
}
