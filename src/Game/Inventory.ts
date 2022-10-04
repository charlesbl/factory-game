import ItemStack from './ItemStack'
import Item from './Item'
import Ressources from './Resources/Ressources'

export interface ItemStackDictionary {
    // key = itemId
    [key: string]: ItemStack
}

export default class Inventory {
    private _itemStacks: ItemStackDictionary
    public constructor () {
        this._itemStacks = {}
        Ressources.getItems().forEach((item: Item) => {
            this._itemStacks[item.id] = new ItemStack(item, 0)
        })
    }

    public getItemStackList (): ItemStack[] {
        return Object.entries(this._itemStacks).map(([id, itemStack]) => itemStack)
    }

    public get itemStacks (): ItemStackDictionary {
        return this._itemStacks
    }

    public addItem (item: Item, count: number = 1): void {
        this._itemStacks[item.id].quantity += count
    }

    public removeItem (item: Item, count: number = 1): boolean {
        if (this._itemStacks[item.id].quantity - count >= 0) {
            this._itemStacks[item.id].quantity -= count
            return true
        } else {
            return false
        }
    }

    public contains (itemStack: ItemStack): boolean {
        return this._itemStacks[itemStack.item.id].quantity >= itemStack.quantity
    }

    public getQuantity (item: Item): number {
        return this._itemStacks[item.id].quantity
    }
}
