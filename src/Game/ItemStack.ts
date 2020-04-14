import Id from "./Id";
import Game from "./Game";
import Item from "./Item";

export interface IItemStackSave {
    itemId: string;
    quantity: number;
}

export default class ItemStack extends Id {
    item: Item;
    quantity: number;

    constructor(item: Item, quantity: number) {
        super();
        this.item = item;
        this.quantity = quantity;
    }

    toString(): string {
        return this.item.name + ": " + this.quantity;
    }

    getSave(): IItemStackSave {
        return {
            itemId: this.item.id,
            quantity: this.quantity
        }
    }

    static fromSave(save: IItemStackSave) {
        return new ItemStack(Game.getItemById(save.itemId), save.quantity);
    }
}