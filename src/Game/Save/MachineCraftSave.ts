import CraftManager from '../CraftManager'
import MachineCraft from '../MachineCraft'
import IngredientSave from './IngredientSave'
import Saveable from './Saveable'

export default class MachineCraftSave extends Saveable<MachineCraft> {
    public id!: string
    public name!: string
    public input!: IngredientSave[]
    public outputCraftId!: string

    public constructor (obj?: MachineCraft, blob?: MachineCraftSave) {
        super()
        this.init(obj, blob)
    }

    protected readonly fromObj = (craft: MachineCraft): void => {
        this.id = craft.id
        this.name = craft.name
        this.input = craft.input.map((ingredient) => new IngredientSave(ingredient))
        this.outputCraftId = craft.outputCraft.id
    }

    protected readonly fromSave = (blob: MachineCraftSave): void => {
        this.id = blob.id
        this.name = blob.name
        this.input = blob.input.map((ingredient) => new IngredientSave(undefined, ingredient))
        this.outputCraftId = blob.outputCraftId
    }

    public readonly getObj = (craftManeger: CraftManager): MachineCraft => {
        return new MachineCraft(this.id, this.name, this.input.map((ing) => ing.getObj()), craftManeger.getCraftById(this.outputCraftId))
    }
}
