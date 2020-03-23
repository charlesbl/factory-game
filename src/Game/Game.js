import Factory from './Factory';
import Item from './Item'
import ItemStack from './ItemStack'
import Craft from './Craft'

const items = {
    ironOre: new Item(0, "Iron Ore"),
    ironIngot: new Item(1, "Iron Ingot"),
    ironPlate: new Item(2, "Iron Plate"),
    copperOre: new Item(3, "Copper Ore"),
    copperIngot: new Item(4, "Copper Ingot"),
    copperPlate: new Item(5, "Copper Plate"),
    copperWire: new Item(6, "Copper Wire"),
}

const crafts = {
    ironOre: new Craft(0, "Iron Ore", [], [new ItemStack(items.ironOre, 10)], 1000),
    ironIngot: new Craft(1, "Iron Ingot", [new ItemStack(items.ironOre, 5)], [new ItemStack(items.ironIngot, 1)], 2500),
    ironPlate: new Craft(2, "Iron Plate", [new ItemStack(items.ironIngot, 2)], [new ItemStack(items.ironPlate, 1)], 1000),
    copperOre: new Craft(3, "Copper Ore", [], [new ItemStack(items.copperOre, 10)], 1000),
    copperIngot: new Craft(4, "Copper Ingot", [new ItemStack(items.copperOre, 5)], [new ItemStack(items.copperIngot, 1)], 2500),
    copperPlate: new Craft(5, "Copper Plate", [new ItemStack(items.copperIngot, 1)], [new ItemStack(items.copperPlate, 2)], 3000),
    copperWire: new Craft(6, "Copper Wire", [new ItemStack(items.copperPlate, 1)], [new ItemStack(items.copperWire, 5)], 5000),
}

const machineCrafts = {
    ironOreDrill: new Craft(0, "Iron Ore Drill", [new ItemStack(items.ironPlate, 10)], crafts.ironOre, 5000),
    ironFurnace: new Craft(1, "Iron Furnace", [new ItemStack(items.ironPlate, 10)], crafts.ironIngot, 5000),
    ironPlating: new Craft(2, "Iron Plating", [new ItemStack(items.ironIngot, 10), new ItemStack(items.copperIngot, 10)], crafts.ironPlate, 5000),
    copperOreDrill: new Craft(3, "Copper Ore Drill", [new ItemStack(items.ironPlate, 10)], crafts.copperOre, 5000),
    copperFurnace: new Craft(4, "Copper Furnace", [new ItemStack(items.ironPlate, 10)], crafts.copperIngot, 5000),
    copperPlating: new Craft(5, "Copper Plating", [new ItemStack(items.ironIngot, 10), new ItemStack(items.copperIngot, 10)], crafts.copperPlate, 5000),
    wiringMachine: new Craft(6, "Wiring machine", [new ItemStack(items.ironPlate, 5), new ItemStack(items.copperPlate, 5)], crafts.copperWire, 5000),
}
export {
    items,
    crafts,
    machineCrafts
}

class Game {
    factories = [];
    lastTime;

    constructor(save) {
        if (save === undefined) {
            var factory = new Factory();
            factory.buildManualMachine(machineCrafts.ironOreDrill);
            factory.buildManualMachine(machineCrafts.ironFurnace);
            factory.buildManualMachine(machineCrafts.ironPlating);
            this.factories.push(factory);
        } else {
            this.factories = save.factories.map((factorySave) => new Factory(factorySave));
        }
        this.lastTime = new Date().getTime();
    }

    getSave() {
        return {
            factories: this.factories.map((factory) => factory.getSave())
        };
    }

    update() {
        var newTime = new Date().getTime();
        var delta = newTime - this.lastTime;
        this.lastTime = newTime;

        this.factories.forEach(factory => {
            factory.update(delta);
        });
    }

    static getCraftById(id) {
        var req = Object.entries(crafts).filter(([name, craft]) => craft.id === id);
        if (req.length !== 1) {
            throw new Error("Craft id: " + id + " not found");
        }
        return req[0][1];
    }

    static getItemById(id) {
        var req = Object.entries(items).filter(([name, item]) => item.id === id);
        if (req.length !== 1) {
            throw new Error("Item id: " + id + " not found");
        }
        return req[0][1];
    }
}

export default Game;