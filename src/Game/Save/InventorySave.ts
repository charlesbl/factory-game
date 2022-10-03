import Saveable from './Saveable'
import Inventory from '../Inventory'
import ItemStackSave from './ItemStackSave'

export default class InventorySave extends Saveable<Inventory> {
    private itemStacks!: { [key: string]: ItemStackSave }

    public constructor (obj?: Inventory, blob?: InventorySave) {
        super()
        this.init(obj, blob)
    }

    protected fromObj = (inventory: Inventory): void => {
        const result: { [key: string]: ItemStackSave } = {}
        Object.entries(inventory.itemStacks).forEach(([id, itemStack]) => {
            result[id] = new ItemStackSave(itemStack)
        })

        this.itemStacks = result
    }

    protected fromSave = (blob: InventorySave): void => {
        const result: { [key: string]: ItemStackSave } = {}
        Object.entries(blob.itemStacks).forEach(([id, itemStackSave]) => {
            result[id] = new ItemStackSave(undefined, itemStackSave)
        })

        this.itemStacks = result
    }

    public getObj = (): Inventory => {
        const inventory = new Inventory()
        Object.entries(this.itemStacks).forEach(([id, itemStackSave]) => {
            const itemStack = itemStackSave.getObj()
            inventory.addItem(itemStack.item, itemStack.quantity)
        })
        return inventory
    }
}
