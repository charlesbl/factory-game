import Machine from './Machine'
import Inventory from './Inventory'
import Id from './Id';

class Factory extends Id{
    constructor(save) {
        super();
        if(save === undefined) {
            this.machines = [];
            this.inventory = new Inventory();
        } else {
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
}
export default Factory;