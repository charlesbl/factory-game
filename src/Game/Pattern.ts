import Game from "./Game";
import Inventory from "./Inventory";
import Craft from "./Craft";
import ItemStack from "./ItemStack";

export interface IPatternSave {
    id: number;
    name: string;
    machinesCount: {[id: number]: number};
    patternsCount: number[];
}

export default class Pattern {
    static latestId = 0;
    id: number;
    game: Game;
    machinesCount: {[id: number]: number};
    patternsCount: number[];
    name: string;
    totalCost: Inventory;

    constructor(game: Game) {
        this.game = game;
        this.machinesCount = [];
        this.patternsCount = [];
        Game.machineCrafts.forEach((machineCraft: Craft) => this.machinesCount[machineCraft.id] = 0);
        this.game.patterns.forEach((pattern: Pattern) => this.patternsCount[pattern.id] = 0);
        this.id = Pattern.getId();
        this.name = "Pattern name";
        this.totalCost = new Inventory();
    }

    static fromSave(game: Game, save: IPatternSave) {
        var pattern = new Pattern(game);
        pattern.id = Pattern.getId(save.id);
        pattern.name = save.name;
        Object.entries(save.machinesCount).forEach(([aid, count]) => {
            var id = Number.parseInt(aid);
            if (pattern.machinesCount[id] !== undefined)
                pattern.machinesCount[id] = count;
        });
        Object.entries(save.patternsCount).forEach(([aid, count]) => {
            var id = Number.parseInt(aid);
            if (pattern.patternsCount[id] !== undefined)
                pattern.patternsCount[id] = count;
        });
        pattern.updateTotalCost();
        return pattern;
    }

    getSave(): IPatternSave {
        return {
            id: this.id,
            name: this.name,
            machinesCount: this.machinesCount,
            patternsCount: this.patternsCount,
        };
    }

    static getId(id?: number): number {
        if (id !== undefined) {
            Pattern.latestId = id;
            return id;
        } else {
            Pattern.latestId++;
            return Pattern.latestId;
        }
    }

    addMachine(craftId: number) {
        this.machinesCount[craftId]++;
        Game.getMachineCraftById(craftId).input.forEach((itemStack: ItemStack) => this.totalCost.add(itemStack));
    }

    removeMachine(craftId: number) {
        if (this.machinesCount[craftId] > 0) {
            this.machinesCount[craftId]--;
            Game.getMachineCraftById(craftId).input.forEach((itemStack: ItemStack) => this.totalCost.remove(itemStack));
        }
    }

    addPattern(patternId: number) {
        this.patternsCount[patternId]++;
        this.totalCost.addInventory(this.game.getPatternById(patternId).totalCost);
    }

    removePattern(patternId: number) {
        if (this.patternsCount[patternId] > 0) {
            this.patternsCount[patternId]--;
            this.totalCost.removeInventory(this.game.getPatternById(patternId).totalCost);
        }
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
    }
}