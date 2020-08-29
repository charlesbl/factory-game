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

    tryBuy(game: Game, quantity: number = 1) {
        if (game.money >= this.item.getBuyPrice() * quantity) {
            game.money -= this.item.getBuyPrice() * quantity;
            this.quantity += quantity;
        }
    }

    trySell(game: Game, quantity: number = 1) {
        if (this.quantity >= quantity) {
            game.money += this.item.getSellPrice() * quantity;
            this.quantity -= quantity;
        }
    }

    static fromSave(save: IItemStackSave) {
        return new ItemStack(Game.getItemById(save.itemId), save.quantity);
    }
}