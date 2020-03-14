import { crafts } from './Game'
import Machine from './Machine'
import Inventory from './Inventory'

class Factory {
    constructor() {
        this.machines = [];
        this.inventory = new Inventory();
    }

    buildDrill() {
        this.machines.push(new Machine(this, crafts.ironOre));
    }

    buildFurnace() {
        this.machines.push(new Machine(this, crafts.ironIngot));
    }
}
export default Factory;