import Saveable from './Saveable'
import Inventory from '../Inventory'
import ItemStackSave from './ItemStackSave'

export default class InventorySave extends Saveable<Inventory> {
    itemStacks!: { [key: string]: ItemStackSave }

    constructor (obj?: Inventory, blob?: any) {
        super()
        this.init(obj, blob)
    }

    fromObj = (inventory: Inventory): void => {
        const result: { [key: string]: ItemStackSave } = {}
        Object.entries(inventory.itemStacks).forEach(([id, itemStack]) => {
            result[id] = new ItemStackSave(itemStack)
        })

        this.itemStacks = result
    }

    fromSave = (blob: InventorySave): void => {
        const result: { [key: string]: ItemStackSave } = {}
        Object.entries(blob.itemStacks).forEach(([id, itemStackSave]) => {
            result[id] = new ItemStackSave(undefined, itemStackSave)
        })

        this.itemStacks = result
    }

    getObj = (): Inventory => {
        const inventory = new Inventory()
        Object.entries(this.itemStacks).forEach(([id, itemStackSave]) => {
            inventory.add(itemStackSave.getObj())
        })
        return inventory
    }
}
