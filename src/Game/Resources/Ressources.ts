import rawItems from './Items.json'
import rawCrafts from './Crafts.json'
import rawMachineCrafts from './MachineCrafts.json'
import Item from '../Item'
import Craft from '../Craft'
import Ingredient from '../Ingredient'
import ItemStack from '../ItemStack'
import MachineCraft from '../MachineCraft'

const Items = rawItems.map((rawItem) => new Item(rawItem.id, rawItem.name, rawItem.cost, rawItem.buyable))
const getItemById = (id: string): Item => {
    const req = Items.filter((item) => item.id === id)
    if (req.length !== 1) {
        throw new Error(`Item id "${id}" found ${req.length} times`)
    }
    return req[0]
}

const Crafts = rawCrafts.map((rawCraft: any) => {
    const input: Ingredient[] = rawCraft.input.map((rawItemStack: any) => new Ingredient(getItemById(rawItemStack.itemId), rawItemStack.quantity))
    const outputItems: Ingredient[] = rawCraft.output.map((rawItemStack: any) => new Ingredient(getItemById(rawItemStack.itemId), rawItemStack.quantity))
    return new Craft(rawCraft.id, rawCraft.name, input, outputItems, rawCraft.duration)
})
const getCraftById = (id: string): Craft => {
    const req = Crafts.filter((craft) => craft.id === id)
    if (req.length !== 1) {
        throw new Error(`Craft id "${id}" found ${req.length} times`)
    }
    return req[0]
}

const MachineCrafts = rawMachineCrafts.map((rawCraft: any) => {
    const input = rawCraft.input.map((rawItemStack: any) => new ItemStack(getItemById(rawItemStack.itemId), rawItemStack.quantity))
    const outputCraft: Craft = getCraftById(rawCraft.output)
    return new MachineCraft(rawCraft.id, rawCraft.name, input, outputCraft, rawCraft.duration)
})
const getMachineCraftById = (id: string): MachineCraft => {
    const req = MachineCrafts.filter((craft) => craft.id === id)
    if (req.length !== 1) {
        throw new Error(`MachineCraft id "${id}" found ${req.length} times`)
    }
    return req[0]
}

export default {
    Items,
    Crafts,
    MachineCrafts,
    getItemById,
    getCraftById,
    getMachineCraftById
}
