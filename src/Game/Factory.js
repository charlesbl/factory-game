import Machine from './Machine'
import Inventory from './Inventory'
import { items } from './Game';
import Id from './Id';

class Factory extends Id{
    constructor() {
        super();
        this.machines = [];
        this.inventory = new Inventory();
    }

    buildMachine(machineCraft) {
        var machine = new Machine(machineCraft.name, this, machineCraft.output);
        this.machines.push(machine);
        return machine;
    }

    destroyMachine(machine) {
        this.machines = this.machines.filter((elem) => {
            return elem != machine;
        });
    }

    update(delta) {
        this.machines.forEach(machine => {
            machine.update(delta);
        });
    }
}
export default Factory;