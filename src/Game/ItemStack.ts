import Id from "./Id";
import Game from "./Game";
import Item from "./Item";

export interface IItemStackSave {
    itemId: string;
    quantity: number;
    exchangeDirection: ExchangeDirection;
}

export enum ExchangeDirection {
    none,
    import,
    export
}

export default class ItemStack extends Id {
    item: Item;
    quantity: number;
    exchangeDirection: ExchangeDirection;

    constructor(item: Item, quantity: number, exchangeDirection: ExchangeDirection = ExchangeDirection.none) {
        super();
        this.item = item;
        this.quantity = quantity;
        this.exchangeDirection = exchangeDirection;
    }

    toString(): string {
        return this.item.name + ": " + this.quantity;
    }

    getSave(): IItemStackSave {
        return {
            itemId: this.item.id,
            quantity: this.quantity,
            exchangeDirection: this.exchangeDirection
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

    sellAll(game: Game) {
        game.money += this.item.getSellPrice() * this.quantity;
        this.quantity = 0;
    }

    toggleImport() {
        if (this.exchangeDirection === ExchangeDirection.import) {
            this.exchangeDirection = ExchangeDirection.none;
        } else {
            this.exchangeDirection = ExchangeDirection.import;
        }
    }

    toggleExport() {
        if (this.exchangeDirection === ExchangeDirection.export) {
            this.exchangeDirection = ExchangeDirection.none;
        } else {
            this.exchangeDirection = ExchangeDirection.export;
        }
    }

    static fromSave(save: IItemStackSave) {
        return new ItemStack(Game.getItemById(save.itemId), save.quantity, save.exchangeDirection);
    }
}