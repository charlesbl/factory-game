import Machine from './Machine'
import Inventory from './Inventory'
import { items } from './Game';

class Factory {
    constructor() {
        this.machines = [];
        this.inventory = new Inventory();
        this.inventory[items.ironIngot.id].quantity = 20;
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