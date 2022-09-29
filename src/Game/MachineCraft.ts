import Craft from './Craft'
import Ingredient from './Ingredient'

export default class MachineCraft extends Craft {
    readonly outputCraft: Craft

    constructor (id: string, name: string, input: Ingredient[], outputCraft: Craft) {
        super(id, name, input, [])
        this.outputCraft = outputCraft
    }
}
