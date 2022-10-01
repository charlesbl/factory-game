import Ingredient from '../Ingredient'
import Ressources from '../Resources/Ressources'
import Saveable from './Saveable'

export default class IngredientSave extends Saveable<Ingredient> {
    private itemId!: string
    private quantityPerSecond!: number

    public constructor (obj?: Ingredient, blob?: IngredientSave) {
        super()
        this.init(obj, blob)
    }

    protected fromObj = (itemStack: Ingredient): void => {
        this.itemId = itemStack.item.id
        this.quantityPerSecond = itemStack.quantityPerSecond
    }

    protected fromSave = (blob: IngredientSave): void => {
        this.itemId = blob.itemId
        this.quantityPerSecond = blob.quantityPerSecond
    }

    public getObj = (): Ingredient => {
        return new Ingredient(Ressources.getItemById(this.itemId), this.quantityPerSecond)
    }
}
