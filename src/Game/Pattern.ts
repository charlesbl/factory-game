import Game from "./Game";
import Inventory, { IInventorySave } from "./Inventory";
import Craft from "./Craft";
import ItemStack from "./ItemStack";
import Factory from "./Factory";

export interface IPatternSave {
    id: number;
    name: string;
    machinesCount: { [id: string]: number };
    patternsCount: number[];
    inventory: IInventorySave;
}

export default class Pattern {
    static latestId = 0;
    id: number;
    game: Game;
    machinesCount: { [id: string]: number };
    patternsCount: number[];
    name: string;
    totalCost: Inventory;
    costPrice: number;
    inventory: Inventory;

    constructor(game: Game) {
        this.game = game;
        this.machinesCount = {};
        this.patternsCount = [];
        this.reset();
        this.id = Pattern.getId();
        this.name = "Pattern name";
        this.totalCost = new Inventory();
        this.inventory = new Inventory();
        this.costPrice = 0;
    }

    static fromSave(game: Game, save: IPatternSave): Pattern {
        var pattern = new Pattern(game);
        pattern.id = Pattern.getId(save.id);
        pattern.name = save.name;
        Object.entries(save.machinesCount).forEach(([id, count]) => {
            if (pattern.machinesCount[id] !== undefined)
                pattern.machinesCount[id] = count;
        });
            console.log(save.patternsCount);
        Object.entries(save.patternsCount).forEach(([aid, count]) => {
            var id = Number.parseInt(aid);
            if (pattern.patternsCount[id] !== undefined) {
                pattern.patternsCount[id] = count;
            }
        });
        pattern.updateTotalCost();
        pattern.inventory = Inventory.fromSave(save.inventory);
        return pattern;
    }

    static createFromFactory(game: Game, factory: Factory): Pattern {
        const subPatterns = factory.factories.map((factory) => {
            console.log(factory.patternId);
            let pId = factory.patternId;
            if (pId === undefined) {
                pId = Pattern.createFromFactory(game, factory).id;
            }
            return pId;
        });
        const pattern: Pattern = new Pattern(game);
        game.addPattern(pattern);
        factory.machines.forEach((machine) => pattern.addMachine(machine.machineCraft.id));
        subPatterns.forEach((subPattern) => pattern.addPattern(subPattern));
        factory.patternId = pattern.id;
        pattern.updateTotalCost();
        pattern.inventory = factory.inventory;
        return pattern;
    }

    getSave(): IPatternSave {
        return {
            id: this.id,
            name: this.name,
            machinesCount: this.machinesCount,
            patternsCount: this.patternsCount,
            inventory: this.inventory.getSave()
        };
    }

    static getId(id?: number): number {
        if (id !== undefined) {
            Pattern.latestId = id;
            return id;
        } else {
            return Pattern.latestId++;
        }
    }

    reset() {
        Game.machineCrafts.forEach((machineCraft: Craft) => this.machinesCount[machineCraft.id] = 0);
        this.game.patterns.forEach((pattern: Pattern) => this.patternsCount[pattern.id] = 0);
    }

    addMachine(craftId: string) {
        this.machinesCount[craftId]++;
        Game.getMachineCraftById(craftId).input.forEach((itemStack: ItemStack) => this.totalCost.add(itemStack));
    }

    removeMachine(craftId: string) {
        if (this.machinesCount[craftId] > 0) {
            this.machinesCount[craftId]--;
            Game.getMachineCraftById(craftId).input.forEach((itemStack: ItemStack) => this.totalCost.remove(itemStack));
        }
    }

    addPattern(patternId: number) {
        if (!this.patternsCount[patternId])
            this.patternsCount[patternId] = 0;
        this.patternsCount[patternId]++;
    }

    updateTotalCost() {
        this.totalCost = new Inventory();
        Game.machineCrafts.forEach((machineCraft: Craft) => {
            var quantity = this.machinesCount[machineCraft.id];
            if (quantity > 0) {
                machineCraft.input.forEach((itemStack) => {
                    this.totalCost.add(itemStack, quantity);
                });
            }
        });
        Object.entries(this.patternsCount).forEach(([id, count]) => {
            var pattern = this.game.getPatternById(Number.parseInt(id));
            pattern.updateTotalCost();
            this.totalCost.addInventory(pattern.totalCost, count);
        });
        this.costPrice = this.getCostPrice();
    }


    getCostPrice(): number {
        var cost = 0;
        this.totalCost.getItemStackList().forEach((itemStack) => {
            cost += itemStack.item.getBuyPrice() * itemStack.quantity;
        });
        return cost;
    }

    tryBuy(produceFactory: Factory, game: Game) {
        if (game.money >= this.costPrice) {
            produceFactory.buildSubFactory(this.id);
            this.game.money -= this.costPrice;
        }
    }

    canBuy(game: Game) {
        return game.money >= this.costPrice;
    }
}