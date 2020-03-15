import Factory from './Factory';
import Item from './Item'
import ItemStack from './ItemStack'
import Craft from './Craft'

const items = {
    ironOre: new Item("Iron Ore"),
    ironIngot: new Item("Iron Ingot"),
    copperOre: new Item("Copper Ore"),
    copperIngot: new Item("Copper Ingot"),
    copperPlate: new Item("Copper Plate"),
    copperWire: new Item("Copper Wire"),
}

const crafts = {
    ironOre: new Craft("Iron Ore", [], [new ItemStack(items.ironOre, 1)], 100),
    ironIngot: new Craft("Iron Ingot", [new ItemStack(items.ironOre, 5)], [new ItemStack(items.ironIngot, 1)], 2500),
    copperOre: new Craft("Copper Ore", [], [new ItemStack(items.copperOre, 1)], 100),
    copperIngot: new Craft("Copper Ingot", [new ItemStack(items.copperOre, 5)], [new ItemStack(items.copperIngot, 1)], 2500),
    copperPlate: new Craft("Copper Plate", [new ItemStack(items.copperIngot, 1)], [new ItemStack(items.copperPlate, 2)], 3000),
    copperWire: new Craft("Copper Wire", [new ItemStack(items.copperPlate, 1)], [new ItemStack(items.copperWire, 5)], 5000),
}

const machineCrafts = {
    ironOreDrill: new Craft("Iron Ore Drill", [new ItemStack(items.ironIngot, 10)], crafts.ironOre, 5000),
    ironFurnace: new Craft("Iron Furnace", [new ItemStack(items.ironIngot, 10)], crafts.ironIngot, 5000),
    copperOreDrill: new Craft("Copper Ore Drill", [new ItemStack(items.ironIngot, 10)], crafts.copperOre, 5000),
    copperFurnace: new Craft("Copper Furnace", [new ItemStack(items.ironIngot, 10)], crafts.copperIngot, 5000),
    copperPlating: new Craft("Copper Plating", [new ItemStack(items.ironIngot, 10)], crafts.copperPlate, 5000),
    wiringMachine: new Craft("Wiring machine", [new ItemStack(items.ironIngot, 10)], crafts.copperWire, 5000),
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