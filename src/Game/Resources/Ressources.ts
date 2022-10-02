import rawItems from './Items.json'
import Item from '../Item'

let items: Item[]

const getItems = (): Item[] => {
    if (items == null) {
        items = rawItems.map((rawItem) => new Item(rawItem.id, rawItem.name, rawItem.cost, rawItem.buyable))
    }
    return items
}

const getItemById = (id: string): Item => {
    const req = getItems().filter((item) => item.id === id)
    if (req.length !== 1) {
        throw new Error(`Item id "${id}" found ${req.length} times`)
    }
    return req[0]
}

export default {
    getItems,
    getItemById
}
