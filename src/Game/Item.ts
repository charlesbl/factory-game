class Item {
    static buyTax = 1.1;
    static sellTax = 0.9;

    id: string;
    name: string;
    cost: number;
    buyable: boolean;

    constructor(id: string, name: string, cost: number, buyable: boolean = false) {
        this.id = id;
        this.name = name;
        this.cost = cost;
        this.buyable = buyable;
    }

    getBuyPrice(): number {
        return this.cost * Item.buyTax;
    }

    getSellPrice(): number {
        return this.cost * Item.sellTax;
    }
}
export default Item;