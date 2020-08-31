import Machine, { IMachineSave } from './Machine'
import Inventory, { IInventorySave } from './Inventory'
import Id from './Id';
import Game from './Game';
import Pattern, { IPatternSave } from './Pattern';
import Craft from './Craft';
import MachineCraft from './MachineCraft';
import { ExchangeDirection } from './ItemStack';

export interface IFactorySave {
    inventory: IInventorySave;
    machines: IMachineSave[];
    factories: IFactorySave[];
    pattern?: IPatternSave;
}

export default class Factory extends Id {
    game: Game;
    topFactory?: Factory;
    machines: Machine[];
    factories: Factory[];
    inventory: Inventory;
    pattern?: Pattern;
    constructor(game: Game, topFactory?: Factory, pattern?: Pattern) {
        super();
        this.game = game;
        this.topFactory = topFactory;
        this.machines = [];
        this.factories = [];
        this.inventory = new Inventory(this);

        if (pattern !== undefined) {
            this.pattern = pattern;
            Object.entries(pattern.machinesCount).forEach(([id, count]) => {
                var machineCraft = Game.getMachineCraftById(id);
                for (let i = 0; i < count; i++) {
                    //Consume and produce in it own factory "machineCraft.produce(this)"
                    machineCraft.consume(game.factory);
                    machineCraft.produce(game.factory);
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

    static fromSave(game: Game, save: IFactorySave, topFactory?: Factory): Factory {
        var factory = new Factory(game);
        factory.topFactory = topFactory;
        factory.machines = save.machines.map((machineSave) => Machine.fromSave(factory, machineSave));
        factory.inventory = Inventory.fromSave(save.inventory, factory);
        factory.factories = save.factories.map((factorySave) => Factory.fromSave(game, factorySave, factory))
        //TODO save patternID instead of full pattern already saved in game
        if (save.pattern !== undefined)
            factory.pattern = Pattern.fromSave(game, save.pattern);
        return factory;
    }

    buildSubFactory(pattern?: Pattern) {
        this.factories.push(new Factory(this.game, this, pattern));
    }

    buildMachine(machineCraft: MachineCraft, manual = false): Machine {
        var machine = new Machine(machineCraft.name, machineCraft.outputCraft, this, manual);
        this.machines.push(machine);
        return machine;
    }

    destroyMachine(machine: Machine) {
        this.machines = this.machines.filter((elem) => {
            return elem !== machine;
        });
    }

    updateImportExport() {
        this.inventory.getItemStackList().forEach((itemStack) => {
            if (itemStack.exchangeDirection === ExchangeDirection.export && itemStack.quantity > 10) {
                if (this.topFactory) {
                    if (this.inventory.removeItem(itemStack.item))
                        this.topFactory.inventory.addItem(itemStack.item);
                } else {
                    itemStack.trySell(this.game);
                }
            } else if (itemStack.exchangeDirection === ExchangeDirection.import && itemStack.quantity < 100) {
                if (this.topFactory) {
                    if (this.topFactory.inventory.removeItem(itemStack.item))
                        this.inventory.addItem(itemStack.item);
                } else {
                    itemStack.tryBuy(this.game);
                }
            }
        });
    }

    update(delta: number) {
        this.updateImportExport();
        this.machines.forEach(machine => {
            machine.update(delta);
        });
        this.factories.forEach(factory => {
            factory.update(delta);
        });
    }

    getMachinesOfType(machineCraft: Craft): Machine[] {
        return this.machines.filter((machine) => machine.craft.id === machineCraft.id);
    }
}