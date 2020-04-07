import Factory from './Factory';
import Item from './Item'
import ItemStack from './ItemStack'
import Craft from './Craft'
import rawItems from './Resources/Items.json'
import rawCrafts from './Resources/Crafts.json'
import rawMachineCrafts from './Resources/MachineCrafts.json'
import Pattern from './Pattern';

const MAX_TICK_TIME = 500;

//TODO Factory in Factory
//TODO rework crafts
//TODO Download and load save
//TODO Keep mouse button down during manual craft
//TODO Energy system
//TODO config menu

class Game {
    factory;
    lastTime;
    patterns;
    static items;
    static crafts;
    static machineCrafts;

    constructor(initManualMachine = true) {
        Game.initResources();
        this.patterns = [];
        this.factory = new Factory(this);
        if (initManualMachine)
            Game.machineCrafts.forEach((machineCraft) => this.factory.buildMachine(machineCraft, true));
        this.lastTime = Date.now();
    }

    static fromSave(save) {
        var game = new Game(false);
        game.patterns = save.patterns.map((patternSave) => Pattern.fromSave(game, patternSave));
        game.factory = Factory.fromSave(game, save.factory);
        return game;
    }

    getSave() {
        return {
            factory: this.factory.getSave(),
            patterns: this.patterns.map((pattern) => pattern.getSave())
        };
    }

    update() {
        var newTime = Date.now();
        var delta = newTime - this.lastTime;
        this.lastTime = newTime;

        while (delta > 0) {
            var capedDelta = delta < MAX_TICK_TIME ? delta : MAX_TICK_TIME;
            this.factory.update(capedDelta);
            delta -= MAX_TICK_TIME;
        }
    }

    addPattern(pattern) {
        this.patterns.push(pattern);
    }

    getPatternById(id) {
        id = parseInt(id);
        var req = this.patterns.filter((pattern) => pattern.id === id);
        if (req.length !== 1) {
            throw new Error("Pattern id \"" + id + "\" found " + req.length + " times");
        }
        return req[0];
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