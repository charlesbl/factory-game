import { items } from './Game'
import ItemStack from './ItemStack'

class Inventory {
    constructor() {
        Object.entries(items).forEach(([itemName, item]) => {
            this[item.id] = new ItemStack(item, 0);
        });
    }
    remove(itemStack) {
        this[itemStack.item.id].quantity -= itemStack.quantity;
    }
    add(itemStack) {
        this[itemStack.item.id].quantity += itemStack.quantity;
    }
    contains(itemStack) {
        return this[itemStack.item.id].quantity >= itemStack.quantity;
    }
}
export default Inventory;