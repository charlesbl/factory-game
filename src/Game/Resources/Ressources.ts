import rawItems from './Items.json'
import rawCrafts from './Crafts.json'
import rawMachineCrafts from './MachineCrafts.json'
import Item from '../Item'
import Craft from '../Craft'
import Ingredient from '../Ingredient'
import ItemStack from '../ItemStack'
import MachineCraft from '../MachineCraft'

let items: Item[]
let crafts: Craft[]
let machineCrafts: MachineCraft[]

const getItems = (): Item[] => {
    if (items == null) {
        items = rawItems.map((rawItem) => new Item(rawItem.id, rawItem.name, rawItem.cost, rawItem.buyable))
    }
    return items
}

const getCrafts = (): Craft[] => {
    if (crafts == null) {
        crafts = rawCrafts.map((rawCraft: any) => {
            const input: Ingredient[] = rawCraft.input.map((rawItemStack: any) => new Ingredient(getItemById(rawItemStack.itemId), rawItemStack.quantity))
            const outputItems: Ingredient[] = rawCraft.output.map((rawItemStack: any) => new Ingredient(getItemById(rawItemStack.itemId), rawItemStack.quantity))
            return new Craft(rawCraft.id, rawCraft.name, input, outputItems)
        })
    }
    return crafts
}

const getMachineCrafts = (): MachineCraft[] => {
    if (machineCrafts == null) {
        machineCrafts = rawMachineCrafts.map((rawCraft: any) => {
            const input = rawCraft.input.map((rawItemStack: any) => new ItemStack(getItemById(rawItemStack.itemId), rawItemStack.quantity))
            const outputCraft: Craft = getCraftById(rawCraft.output)
            return new MachineCraft(rawCraft.id, rawCraft.name, input, outputCraft)
        })
    }
    return machineCrafts
}

const getItemById = (id: string): Item => {
    const req = getItems().filter((item) => item.id === id)
    if (req.length !== 1) {
        throw new Error(`Item id "${id}" found ${req.length} times`)
    }
    return req[0]
}

const getCraftById = (id: string): Craft => {
    const req = getCrafts().filter((craft) => craft.id === id)
    if (req.length !== 1) {
        throw new Error(`Craft id "${id}" found ${req.length} times`)
    }
    return req[0]
}

const getMachineCraftById = (id: string): MachineCraft => {
    const req = getMachineCrafts().filter((craft) => craft.id === id)
    if (req.length !== 1) {
        throw new Error(`MachineCraft id "${id}" found ${req.length} times`)
    }
    return req[0]
}

export default {
    getItems,
    getCrafts,
    getMachineCrafts,
    getItemById,
    getCraftById,
    getMachineCraftById
}
