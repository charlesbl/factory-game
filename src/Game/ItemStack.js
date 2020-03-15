import Id from "./Id";

class ItemStack extends Id{
    constructor(item, quantity) {
        super();
        this.item = item;
        this.quantity = quantity;
    }
    toString() {
        return this.item.name + ": " + this.quantity;
    }
}
export default ItemStack;