import Id from "./Id";
import Game from "./Game";

class ItemStack extends Id{
    constructor(item, quantity, save) {
        super();
        if(save === undefined) {
            this.item = item;
            this.quantity = quantity;
        } else {
            this.item = Game.getItemById(save.itemId);
            this.quantity = save.quantity;
        }
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
}
export default ItemStack;