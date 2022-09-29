import Item from "./Item";

export default class Ingredient {
    readonly item: Item;
    readonly quantityPerSecond: number;

    constructor(item: Item, quantity: number) {
        this.item = item;
        this.quantityPerSecond = quantity;
    }
}