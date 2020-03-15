import Factory from './Factory';
import Item from './Item'
import ItemStack from './ItemStack'
import Craft from './Craft'

const items = {
    ironOre: new Item("Iron Ore"),
    ironIngot: new Item("Iron Ingot")
}

const crafts = {
    ironOre: new Craft("Iron Ore", [], [new ItemStack(items.ironOre, 1)], 1000),
    ironIngot: new Craft("Iron Ingot", [new ItemStack(items.ironOre, 5)], [new ItemStack(items.ironIngot, 1)], 2500)
}

const machineCrafts = {
    ironOreDrill: new Craft("Iron Ore Drill", [new ItemStack(items.ironIngot, 10)], crafts.ironOre, 5000),
    ironFurnace: new Craft("Iron Furnace", [new ItemStack(items.ironIngot, 10)], crafts.ironIngot, 5000),
}
export {
    items,
    crafts,
    machineCrafts
}

class Game {
    constructor() {
        this.factory = new Factory();
        this.lastTime = new Date().getTime();
    }
    update() {
        var newTime = new Date().getTime();
        var delta = newTime - this.lastTime;
        this.lastTime = newTime;

        this.factory.update(delta);
    }
}

export default Game;