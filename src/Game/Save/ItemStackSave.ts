import ItemStack from '../ItemStack'
import Ressources from '../Resources/Ressources'
import Saveable from './Saveable'

export default class ItemStackSave extends Saveable<ItemStack> {
    private itemId!: string
    private quantity!: number

    public constructor (obj?: ItemStack, blob?: ItemStackSave) {
        super()
        this.init(obj, blob)
    }

    protected fromObj = (itemStack: ItemStack): void => {
        this.itemId = itemStack.item.id
        this.quantity = itemStack.quantity
    }

    protected fromSave = (blob: ItemStackSave): void => {
        this.itemId = blob.itemId
        this.quantity = blob.quantity
    }

    public getObj = (): ItemStack => {
        return new ItemStack(Ressources.getItemById(this.itemId), this.quantity)
    }
}
