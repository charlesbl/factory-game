import Game from "./Game";
import Inventory from "./Inventory";
import Id from "./Id";

class Pattern extends Id {
    constructor(game, save) {
        super();
        this.game = game;
        this.machines = [];
        this.patterns = [];
        Game.machineCrafts.forEach((machineCraft) => this.machines[machineCraft.id] = 0);
        this.game.patterns.forEach((pattern) => this.patterns[pattern.id] = 0);
        if (save !== undefined) {
            this.id = save.id;
            this.name = save.name;
            save.machines.forEach(([id, count]) => this.machines[id] = count);
            this.updateTotalCost();
            save.patterns.forEach(([id, count]) => this.patterns[id] = count);
        } else {
            this.name = "Pattern name";
            this.totalCost = new Inventory();
        }
    }

    getSave() {
        return {
            id: this.id,
            name: this.name,
            machines: Object.entries(this.machines).filter(([id, quantity]) => quantity > 0),
            patterns: Object.entries(this.patterns).filter(([id, quantity]) => quantity > 0),
        };
    }

    addMachine(craftId) {
        this.machines[craftId]++;
        Game.getMachineCraftById(craftId).input.forEach((itemStack) => this.totalCost.add(itemStack));
    }

    removeMachine(craftId) {
        if (this.machines[craftId] > 0) {
            this.machines[craftId]--;
            Game.getMachineCraftById(craftId).input.forEach((itemStack) => this.totalCost.remove(itemStack));
        }
    }

    addPattern(patternId) {
        this.patterns[patternId]++;
        this.totalCost.addInventory(this.game.getPatternById(patternId).totalCost);
    }

    removePattern(patternId) {
        if (this.patterns[patternId] > 0) {
            this.patterns[patternId]--;
            this.totalCost.removeInventory(this.game.getPatternById(patternId).totalCost);
        }
    }

    updateTotalCost() {
        this.totalCost = new Inventory();
        Game.machineCrafts.forEach((machineCraft) => {
            var quantity = this.machines[machineCraft.id];
            if (quantity > 0) {
                machineCraft.input.forEach((itemStack) => {
                    this.totalCost.add(itemStack, quantity);
                });
            }
        });
        Object.entries(this.patterns).forEach(([id, count]) => {
            var pattern = this.game.getPatternById(id);
            pattern.updateTotalCost();
            this.totalCost.addInventory(pattern.totalCost, count);
        });
    }
}

export default Pattern;