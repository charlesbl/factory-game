import Craft from '../Craft'
import IngredientSave from './IngredientSave'
import Saveable from './Saveable'

export default class CraftSave extends Saveable<Craft> {
    public id!: string
    public name!: string
    public input!: IngredientSave[]
    public output!: IngredientSave[]

    public constructor (obj?: Craft, blob?: CraftSave) {
        super()
        this.init(obj, blob)
    }

    protected readonly fromObj = (craft: Craft): void => {
        this.id = craft.id
        this.name = craft.name
        this.input = craft.input.map((ingredient) => new IngredientSave(ingredient))
        this.output = craft.output.map((ingredient) => new IngredientSave(ingredient))
    }

    protected readonly fromSave = (blob: CraftSave): void => {
        this.id = blob.id
        this.name = blob.name
        this.input = blob.input.map((ingredient) => new IngredientSave(undefined, ingredient))
        this.output = blob.output.map((ingredient) => new IngredientSave(undefined, ingredient))
    }

    public readonly getObj = (): Craft => {
        return new Craft(this.id, this.name, this.input.map((ing) => ing.getObj()), this.output.map((ing) => ing.getObj()))
    }
}
