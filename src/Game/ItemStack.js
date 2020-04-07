import Id from "./Id";
import Game from "./Game";

class ItemStack extends Id {
    constructor(item, quantity) {
        super();
        this.item = item;
        this.quantity = quantity;
    }

    toString() {
        return this.item.name + ": " + this.quantity;
    }

    getSave() {
        return {
            itemId: this.item.id,
            quantity: this.quantity
        }
    }

    static fromSave(save) {
        return new ItemStack(Game.getItemById(save.itemId), save.quantity);
    }
}
export default ItemStack;