import Factory, { IFactorySave } from './Factory';
import Item from './Item';
import ItemStack from './ItemStack';
import Craft from './Craft';
import rawItems from './Resources/Items.json';
import rawCrafts from './Resources/Crafts.json';
import rawMachineCrafts from './Resources/MachineCrafts.json';
import Pattern, { IPatternSave } from './Pattern';
import MachineCraft from './MachineCraft';

//TODO Buy machine with money
//TODO Item view
//TODO Rename Factory
//TODO Energy system
//TODO rework crafts
//TODO Download and load save
//TODO config menu

const MAX_TICK_TIME = 500;

export interface IGameSave {
    factory: IFactorySave;
    patterns: IPatternSave[];
    money: number;
}

class Game {
    static items: Item[];
    static crafts: Craft[];
    static machineCrafts: MachineCraft[];
    factory: Factory;
    lastTime: number;
    patterns: Pattern[];
    money: number;

    constructor(initManualMachine: boolean = true) {
        Game.initResources();
        this.patterns = [];
        this.factory = new Factory(this);
        if (initManualMachine)
            Game.machineCrafts.forEach((machineCraft) => this.factory.buildMachine(machineCraft, true));
        this.lastTime = Date.now();
        this.money = 1000;
    }

    static fromSave(save: IGameSave) {
        var game = new Game(false);
        game.patterns = save.patterns.map((patternSave) => Pattern.fromSave(game, patternSave));
        game.factory = Factory.fromSave(game, save.factory);
        game.money = save.money;
        return game;
    }

    getSave(): IGameSave {
        return {
            factory: this.factory.getSave(),
            patterns: this.patterns.map((pattern) => pattern.getSave()),
            money: this.money
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

    addPattern(pattern: Pattern) {
        this.patterns.push(pattern);
    }

    destroyPattern(pattern: Pattern) {
        this.patterns = this.patterns.filter((elem) => {
            return elem !== pattern;
        });
        console.log(this.patterns);
    }

    getPatternById(id: number): Pattern {
        var req = this.patterns.filter((pattern) => pattern.id === id);
        if (req.length !== 1) {
            throw new Error("Pattern id \"" + id + "\" found " + req.length + " times");
        }
        return req[0];
    }

    static initResources() {
        if (Game.items === undefined) {
            Game.items = rawItems.map((rawItem) => new Item(rawItem.id, rawItem.name, rawItem.cost, rawItem.buyable));
        }
        if (Game.crafts === undefined) {
            Game.crafts = rawCrafts.map((rawCraft: any) => {
                var input = rawCraft.input.map((rawItemStack: any) => new ItemStack(this.getItemById(rawItemStack.itemId), rawItemStack.quantity));
                var outputItems: ItemStack[] = rawCraft.output.map((rawItemStack: any) => new ItemStack(this.getItemById(rawItemStack.itemId), rawItemStack.quantity));
                return new Craft(rawCraft.id, rawCraft.name, input, outputItems, rawCraft.duration);
            });
        }
        if (Game.machineCrafts === undefined) {
            Game.machineCrafts = rawMachineCrafts.map((rawCraft: any) => {
                var input = rawCraft.input.map((rawItemStack: any) => new ItemStack(this.getItemById(rawItemStack.itemId), rawItemStack.quantity));
                var outputCraft: Craft = Game.getCraftById(rawCraft.output);
                return new MachineCraft(rawCraft.id, rawCraft.name, input, outputCraft, rawCraft.duration);
            });
        }
    }

    static getCraftById(id: string): Craft {
        var req = Game.crafts.filter((craft) => craft.id === id);
        if (req.length !== 1) {
            throw new Error("Craft id \"" + id + "\" found " + req.length + " times");
        }
        return req[0];
    }

    static getMachineCraftById(id: string): MachineCraft {
        var req = Game.machineCrafts.filter((craft) => craft.id === id);
        if (req.length !== 1) {
            throw new Error("MachineCraft id \"" + id + "\" found " + req.length + " times");
        }
        return req[0];
    }

    static getItemById(id: string): Item {
        var req = Game.items.filter((item) => item.id === id);
        if (req.length !== 1) {
            throw new Error("Item id \"" + id + "\" found " + req.length + " times");
        }
        return req[0];
    }
}

export default Game;