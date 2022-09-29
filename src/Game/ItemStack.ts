import Item from "./Item";

export default class ItemStack {
    item: Item;
    quantity: number;

    constructor(item: Item, quantity: number) {
        this.item = item;
        this.quantity = quantity;
    }

    toString(): string {
        return this.item.name + ": " + this.quantity;
    }
}