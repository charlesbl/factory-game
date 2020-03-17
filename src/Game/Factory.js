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

    buildMachine(craft) {
        this.machines.push(new Machine(this, craft));
    }

    update(delta) {
        this.machines.forEach(machine => {
            machine.update(delta);
        });
    }
}
export default Factory;