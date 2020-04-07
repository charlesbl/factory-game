import Game from './Game'
import ItemStack from './ItemStack'

class Inventory {
    constructor() {
        this.itemStacks = [];
        Game.items.forEach((item) => {
            this.itemStacks[item.id] = new ItemStack(item, 0);
        });
    }

    getSave() {
        return {
            itemStacks: this.getItemStackList().map((itemStack) => itemStack.getSave())
        }
    }

    static fromSave(save) {
        var inventory = new Inventory();
        save.itemStacks.forEach((itemStackSave) => {
            inventory.add(ItemStack.fromSave(itemStackSave));
        });
        return inventory;
    }

    getItemStackList() {
        return Object.entries(this.itemStacks).map(([id, itemStack]) => itemStack);
    }

    remove(itemStack) {
        this.itemStacks[itemStack.item.id].quantity -= itemStack.quantity;
    }

    add(itemStack) {
        this.itemStacks[itemStack.item.id].quantity += itemStack.quantity;
    }

    contains(itemStack) {
        return this.itemStacks[itemStack.item.id].quantity >= itemStack.quantity;
    }

    count(item) {
        return this.itemStacks[item.id].quantity;
    }

    addInventory(inventory) {
        inventory.getItemStackList().forEach((itemStack) => this.add(itemStack));
    }

    removeInventory(inventory) {
        inventory.getItemStackList().forEach((itemStack) => this.remove(itemStack));
    }
}
export default Inventory;