import ItemStack from '../ItemStack'
import Ressources from '../Resources/Ressources'
import Saveable from './Saveable'

export default class ItemStackSave extends Saveable<ItemStack> {
    itemId!: string
    quantity!: number

    constructor (obj?: ItemStack, blob?: any) {
        super()
        this.init(obj, blob)
    }

    fromObj = (itemStack: ItemStack): void => {
        this.itemId = itemStack.item.id
        this.quantity = itemStack.quantity
    }

    fromSave = (blob: ItemStackSave): void => {
        this.itemId = blob.itemId
        this.quantity = blob.quantity
    }

    getObj = (): ItemStack => {
        return new ItemStack(Ressources.getItemById(this.itemId), this.quantity)
    }
}
