class ItemStack {
    constructor(item, quantity) {
        this.item = item;
        this.quantity = quantity;
    }
    toString() {
        return this.item.name + ": " + this.quantity;
    }
}
export default ItemStack;