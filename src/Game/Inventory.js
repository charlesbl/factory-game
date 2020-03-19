import { items } from './Game'
import ItemStack from './ItemStack'

class Inventory {
    constructor(save) {
        this.itemStacks = [];
        Object.entries(items).forEach(([itemName, item]) => {
            this.itemStacks[item.id] = new ItemStack(item, 0);
        });
        if(save !== undefined) {
            save.itemStacks.forEach((itemStackSave) => {
                this.add(new ItemStack(undefined, undefined, itemStackSave));
            });
        }
    }
    
    getSave() {
        return {
            itemStacks: this.itemStacks.map((itemStack) => itemStack.getSave())
        }
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
}
export default Inventory;