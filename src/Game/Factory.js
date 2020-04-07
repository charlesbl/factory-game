import Machine from './Machine'
import Inventory from './Inventory'
import Id from './Id';
import Game from './Game';
import Pattern from './Pattern';

class Factory extends Id {
    constructor(game) {
        super();
        this.game = game;
        this.machines = [];
        this.factories = [];
        this.inventory = new Inventory();
    }

    getSave() {
        return {
            inventory: this.inventory.getSave(),
            machines: this.machines.map((machine) => machine.getSave()),
            factories: this.factories.map((factory) => factory.getSave()),
            pattern: this.pattern !== undefined ? this.pattern.getSave() : undefined
        };
    }

    static fromSave(game, save) {
        var factory = new Factory(game);
        factory.machines = save.machines.map((machineSave) => Machine.fromSave(factory, machineSave));
        factory.inventory = Inventory.fromSave(save.inventory);
        if (save.pattern !== undefined)
            factory.pattern = Pattern.fromSave(game, save.pattern);
        return factory;
    }

    static fromPattern(game, pattern) {
        var factory = new Factory(game);
        factory.pattern = pattern;
        Object.entries(pattern.machines).forEach(([id, count]) => {
            var machineCraft = Game.getMachineCraftById(id);
            for (let i = 0; i < count; i++) {
                machineCraft.consume(game.factory);
                machineCraft.produce(game.factory); //TODO Changer la construction de la machine dans sa propre factory => machineCraft.produce(factory);
            }
        });
        Object.entries(pattern.patterns).forEach(([id, count]) => {
            var subPattern = game.getPatternById(id);
            for (let i = 0; i < count; i++) {
                factory.buildSubFactory(subPattern);
            }
        });
        return factory;
    }

    buildSubFactory(pattern) {
        this.factories.push(Factory.fromPattern(this.game, pattern));
    }

    buildMachine(machineCraft, manual = false) {
        var machine = new Machine(machineCraft.name, machineCraft.output, this);
        machine.manual = manual;
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

    getMachinesOfType(machineCraft) {
        return this.machines.filter((machine) => machine.craft.id === machineCraft.id);
    }
}
export default Factory;