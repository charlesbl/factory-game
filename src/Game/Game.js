import Factory from './Factory';
import Item from './Item'
import ItemStack from './ItemStack'
import Craft from './Craft'

const items = {
    ironOre: new Item("Iron Ore"),
    ironIngot: new Item("Iron Ingot")
}

const crafts = {
    ironIngot: new Craft([new ItemStack(items.ironOre, 5)], [new ItemStack(items.ironIngot, 1)], 2000),
    ironOre: new Craft([], [new ItemStack(items.ironOre, 1)], 1000)
}
export {
    items,
    crafts,
}

class Game {
    constructor() {
        this.factory = new Factory();
    }

    buildDrill() {
        this.factory.buildDrill();
    }

    buildFurnace() {
        this.factory.buildFurnace();
    }
}

export default Game;