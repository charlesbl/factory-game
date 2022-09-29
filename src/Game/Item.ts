
const BUY_TAX = 1.1;
const SELL_TAX = 0.9;

export default class Item {
    readonly id: string;
    readonly name: string;
    readonly cost: number;
    readonly buyable: boolean;

    constructor(id: string, name: string, cost: number, buyable: boolean = false) {
        this.id = id;
        this.name = name;
        this.cost = cost;
        this.buyable = buyable;
    }

    getBuyPrice(): number {
        return this.cost * BUY_TAX;
    }

    getSellPrice(): number {
        return this.cost * SELL_TAX;
    }
};