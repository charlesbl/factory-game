import ItemStack from './ItemStack'
import Item from './Item'
import Ressources from './Resources/Ressources'

export default class Inventory {
    itemStacks: { [key: string]: ItemStack } // key = itemId
    constructor () {
        this.itemStacks = {}
        Ressources.Items.forEach((item: Item) => {
            this.itemStacks[item.id] = new ItemStack(item, 0)
        })
    }

    getItemStackList (): ItemStack[] {
        return Object.entries(this.itemStacks).map(([id, itemStack]) => itemStack)
    }

    remove (itemStack: ItemStack, count: number = 1): void {
        this.itemStacks[itemStack.item.id].quantity -= itemStack.quantity * count
    }

    add (itemStack: ItemStack, count: number = 1): void {
        this.itemStacks[itemStack.item.id].quantity += itemStack.quantity * count
    }

    addItem (item: Item, count: number = 1): void {
        this.itemStacks[item.id].quantity += count
    }

    removeItem (item: Item, count: number = 1): boolean {
        if (this.itemStacks[item.id].quantity - count >= 0) {
            this.itemStacks[item.id].quantity -= count
            return true
        } else {
            return false
        }
    }

    contains (itemStack: ItemStack): boolean {
        return this.itemStacks[itemStack.item.id].quantity >= itemStack.quantity
    }

    getQuantity (item: Item): number {
        return this.itemStacks[item.id].quantity
    }

    addInventory (inventory: Inventory, count: number = 1): void {
        for (let i = 0; i < count; i++) {
            inventory.getItemStackList().forEach((itemStack) => this.add(itemStack))
        }
    }

    removeInventory (inventory: Inventory, count: number = 1): void {
        for (let i = 0; i < count; i++) {
            inventory.getItemStackList().forEach((itemStack) => this.remove(itemStack))
        }
    }
}
