import Game from './Game'
import ItemStack from './ItemStack'

class Inventory {
    constructor(save) {
        this.itemStacks = [];
        Game.items.forEach((item) => {
            this.itemStacks[item.id] = new ItemStack(item, 0);
        });
        if (save !== undefined) {
            save.itemStacks.forEach((itemStackSave) => {
                this.add(new ItemStack(undefined, undefined, itemStackSave));
            });
        }
    }

    getSave() {
        return {
            itemStacks: this.getItemStackList().map((itemStack) => itemStack.getSave())
        }
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