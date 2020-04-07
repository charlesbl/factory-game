import Machine from './Machine'
import Inventory from './Inventory'
import Id from './Id';
import Pattern from './Pattern';

class Factory extends Id {
    constructor(save) {
        super();
        this.machines = [];
        if (save === undefined) {
            this.inventory = new Inventory();
        } else if (typeof save === Pattern) {

        }
        else {
            this.machines = save.machines.map((machineSave) => new Machine(undefined, undefined, this, machineSave));
            this.inventory = new Inventory(save.inventory);
        }
    }

    getSave() {
        return {
            inventory: this.inventory.getSave(),
            machines: this.machines.map((machine) => machine.getSave())
        };
    }

    buildMachine(machineCraft) {
        var machine = new Machine(machineCraft.name, machineCraft.output, this);
        this.machines.push(machine);
        return machine;
    }

    buildManualMachine(machineCraft) {
        var machine = this.buildMachine(machineCraft);
        machine.manual = true;
        return machine;
    }

    destroyMachine(machine) {
        this.machines = this.machines.filter((elem) => {
            return elem !== machine;
        });
    }

    update(delta) {
        this.machines.forEach(machine => {
            machine.update(delta);
        });
    }

    getMachinesOfType(machineCraft) {
        return this.machines.filter((machine) => machine.craft.id === machineCraft.id);
    }
}
export default Factory;