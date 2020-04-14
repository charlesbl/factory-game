import Machine, { IMachineSave } from './Machine'
import Inventory, { IInventorySave } from './Inventory'
import Id from './Id';
import Game from './Game';
import Pattern, { IPatternSave } from './Pattern';
import Craft from './Craft';
import MachineCraft from './MachineCraft';

export interface IFactorySave {
    inventory: IInventorySave;
    machines: IMachineSave[];
    factories: IFactorySave[];
    pattern?: IPatternSave
}

export default class Factory extends Id {
    game: Game;
    machines: Machine[];
    factories: Factory[];
    inventory: Inventory;
    pattern?: Pattern;
    constructor(game: Game, pattern?: Pattern) {
        super();
        this.game = game;
        this.machines = [];
        this.factories = [];
        this.inventory = new Inventory();

        if (pattern !== undefined) {
            this.pattern = pattern;
            Object.entries(pattern.machinesCount).forEach(([id, count]) => {
                var machineCraft = Game.getMachineCraftById(id);
                for (let i = 0; i < count; i++) {
                    machineCraft.consume(game.factory);
                    machineCraft.produce(game.factory); //TODO Changer la construction de la machine dans sa propre factory => machineCraft.produce(factory);
                }
            });
            Object.entries(pattern.patternsCount).forEach(([id, count]) => {
                var subPattern = game.getPatternById(Number.parseInt(id));
                for (let i: number = 0; i < count; i++) {
                    this.buildSubFactory(subPattern);
                }
            });
        }
    }

    getSave(): IFactorySave {
        return {
            inventory: this.inventory.getSave(),
            machines: this.machines.map((machine) => machine.getSave()),
            factories: this.factories.map((factory) => factory.getSave()),
            pattern: this.pattern !== undefined ? this.pattern.getSave() : undefined
        };
    }

    static fromSave(game: Game, save: IFactorySave): Factory {
        var factory = new Factory(game);
        factory.machines = save.machines.map((machineSave) => Machine.fromSave(factory, machineSave));
        factory.inventory = Inventory.fromSave(save.inventory);
        if (save.pattern !== undefined)
            factory.pattern = Pattern.fromSave(game, save.pattern);
        return factory;
    }

    buildSubFactory(pattern: Pattern) {
        this.factories.push(new Factory(this.game, pattern));
    }

    buildMachine(machineCraft: MachineCraft, manual = false): Machine {
        var machine = new Machine(machineCraft.name, machineCraft.outputCraft, this);
        machine.manual = manual;
        this.machines.push(machine);
        return machine;
    }

    destroyMachine(machine: Machine) {
        this.machines = this.machines.filter((elem) => {
            return elem !== machine;
        });
    }

    update(delta: number) {
        this.machines.forEach(machine => {
            machine.update(delta);
        });
    }

    getMachinesOfType(machineCraft: Craft): Machine[] {
        return this.machines.filter((machine) => machine.craft.id === machineCraft.id);
    }
}