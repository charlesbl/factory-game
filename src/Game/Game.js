import Factory from './Factory';
import Item from './Item'
import ItemStack from './ItemStack'
import Craft from './Craft'
import rawItems from './Resources/Items.json'
import rawCrafts from './Resources/Crafts.json'
import rawMachineCrafts from './Resources/MachineCrafts.json'

const MAX_TICK_TIME = 500;

//TODO Factory in Factory
//TODO rework crafts
//TODO Download and load save
//TODO Keep mouse button down during manual craft

class Game {
    factories = [];
    lastTime;
    static items;
    static crafts;
    static machineCrafts;

    constructor(save) {
        Game.initResources();
        if (save === undefined) {
            var factory = new Factory();
            Game.machineCrafts.forEach((machineCraft) => factory.buildManualMachine(machineCraft));
            this.factories.push(factory);
        } else {
            this.factories = save.factories.map((factorySave) => new Factory(factorySave));
        }
        this.lastTime = Date.now();
    }

    getSave() {
        return {
            factories: this.factories.map((factory) => factory.getSave())
        };
    }

    static initResources() {
        if (Game.items === undefined) {
            Game.items = rawItems.map((rawItem) => new Item(rawItem.id, rawItem.name, rawItem.infinite));
        }
        if (Game.crafts === undefined) {
            Game.crafts = Game.mapCraft(rawCrafts);
        }
        if (Game.machineCrafts === undefined) {
            Game.machineCrafts = Game.mapCraft(rawMachineCrafts);
        }
    }

    static mapCraft(rawList) {
        return rawList.map((rawCraft) => {
            var input = rawCraft.input.map((itemStack) => new ItemStack(this.getItemById(itemStack.itemId), itemStack.quantity));
            var output;
            if (rawCraft.output instanceof Array) {
                output = rawCraft.output.map((itemStack) => new ItemStack(this.getItemById(itemStack.itemId), itemStack.quantity));
            } else {
                output = Game.getCraftById(rawCraft.output);
            }
            return new Craft(rawCraft.id, rawCraft.name, input, output, rawCraft.duration);
        });
    }

    update() {
        var newTime = Date.now();
        var delta = newTime - this.lastTime;
        this.lastTime = newTime;

        while (delta > 0) {
            var capedDelta = delta < MAX_TICK_TIME ? delta : MAX_TICK_TIME;
            this.updateFactories(capedDelta);
            delta -= MAX_TICK_TIME;
        }
    }

    updateFactories(delta) {
        this.factories.forEach(factory => {
            factory.update(delta);
        });
    }

    static getCraftById(id) {
        var req = Game.crafts.filter((craft) => craft.id === id);
        if (req.length !== 1) {
            throw new Error("Craft id \"" + id + "\" found " + req.length + " times");
        }
        return req[0];
    }

    static getMachineCraftById(id) {
        var req = Game.machineCrafts.filter((craft) => craft.id === id);
        if (req.length !== 1) {
            throw new Error("MachineCraft id \"" + id + "\" found " + req.length + " times");
        }
        return req[0];
    }

    static getItemById(id) {
        var req = Game.items.filter((item) => item.id === id);
        if (req.length !== 1) {
            throw new Error("Item id \"" + id + "\" found " + req.length + " times");
        }
        return req[0];
    }
}

export default Game;