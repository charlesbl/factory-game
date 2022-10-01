import Item from './Item'

export default class ItemStack {
    public readonly item: Item
    private _quantity: number

    public get quantity (): number {
        return this._quantity
    }

    public set quantity (value: number) {
        this._quantity = value
    }

    public constructor (item: Item, quantity: number) {
        this.item = item
        this._quantity = quantity
    }

    public toString (): string {
        return `${this.item.name} + ': ' + ${this._quantity}`
    }
}
