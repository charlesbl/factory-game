import Game from "./Game";
import Inventory from "./Inventory";
import Id from "./Id";

class Pattern extends Id {
    constructor(save) {
        super();
        this.machines = [];
        Game.machineCrafts.forEach((machineCraft) => this.machines[machineCraft.id] = 0);
        if (save !== undefined) {
            this.name = save.name;
            save.machines.forEach(([id, count]) => this.machines[id] = count);
            this.updateTotalCost();
        } else {
            this.name = "Pattern name";
            this.totalCost = new Inventory();
        }
    }

    getSave() {
        return {
            name: this.name,
            machines: Object.entries(this.machines).filter(([id, quantity]) => quantity > 0)
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
    }
}

export default Pattern;