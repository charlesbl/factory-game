
const BUY_TAX = 1.1
const SELL_TAX = 0.9

export default class Item {
    public readonly id: string
    public readonly name: string
    public readonly cost: number
    public readonly buyable: boolean

    public constructor (id: string, name: string, cost: number, buyable: boolean = false) {
        this.id = id
        this.name = name
        this.cost = cost
        this.buyable = buyable
    }

    public getBuyPrice (): number {
        return this.cost * BUY_TAX
    }

    public getSellPrice (): number {
        return this.cost * SELL_TAX
    }
};
