import Machine, { IMachineSave } from './Machine'
import Inventory, { IInventorySave } from './Inventory'
import Id from './Id';
import Game from './Game';
import Pattern from './Pattern';
import Craft from './Craft';
import MachineCraft from './MachineCraft';
import { ExchangeDirection } from './ItemStack';

export interface IFactorySave {
    inventory: IInventorySave;
    machines: IMachineSave[];
    factories: IFactorySave[];
    patternId?: number;
    pause: boolean;
}

const TRANSFER_THRESHOLD = 20;

export default class Factory extends Id {
    game: Game;
    topFactory?: Factory;
    machines: Machine[];
    factories: Factory[];
    inventory: Inventory;
    patternId?: number;
    pause: boolean;

    constructor(game: Game, topFactory?: Factory, patternId?: number) {
        super();
        this.game = game;
        this.topFactory = topFactory;
        this.pause = false;
        this.machines = [];
        this.factories = [];
        this.inventory = new Inventory();

        if (patternId !== undefined) {
            this.patternId = patternId;
            const pattern = game.getPatternById(patternId);
            Object.entries(pattern.machinesCount).forEach(([id, count]) => {
                const machineCraft = Game.getMachineCraftById(id);
                for (let i = 0; i < count; i++) {
                    machineCraft.produce(this);
                }
            });
            Object.entries(pattern.patternsCount).forEach(([id, count]) => {
                for (let i: number = 0; i < count; i++) {
                    this.buildSubFactory(Number.parseInt(id));
                }
            });
            pattern.inventory.getItemStackList().forEach((itemStack) => {
                this.inventory.setExchangeDirection(itemStack.item, itemStack.exchangeDirection);
            })
        }
    }

    getSave(): IFactorySave {
        return {
            inventory: this.inventory.getSave(),
            machines: this.machines.map((machine) => machine.getSave()),
            factories: this.factories.map((factory) => factory.getSave()),
            patternId: this.patternId,
            pause: this.pause
        };
    }

    static fromSave(game: Game, save: IFactorySave, topFactory?: Factory): Factory {
        const factory = new Factory(game);
        factory.topFactory = topFactory;
        factory.machines = save.machines.map((machineSave) => Machine.fromSave(factory, machineSave));
        factory.inventory = Inventory.fromSave(save.inventory);
        factory.factories = save.factories.map((factorySave) => Factory.fromSave(game, factorySave, factory))
        if (save.patternId !== undefined)
            factory.patternId = save.patternId;
        return factory;
    }

    buildSubFactory(patternId?: number) {
        this.factories.push(new Factory(this.game, this, patternId));
    }

    buildMachine(machineCraft: MachineCraft, manual = false): Machine {
        const machine = new Machine(machineCraft.name, machineCraft.outputCraft, this, machineCraft, manual);
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
                const extraQuantity = TRANSFER_THRESHOLD - itemStack.quantity;
            if (itemStack.exchangeDirection === ExchangeDirection.export && itemStack.quantity > TRANSFER_THRESHOLD) {
                if (this.topFactory) {
                    if (this.inventory.removeItem(itemStack.item, -extraQuantity))
                        this.topFactory.inventory.addItem(itemStack.item, -extraQuantity);
                } else {
                    itemStack.trySell(this.game, -extraQuantity);
                }
            } else if (itemStack.exchangeDirection === ExchangeDirection.import && itemStack.quantity < TRANSFER_THRESHOLD) {
                if (this.topFactory) {
                    if (this.topFactory.inventory.removeItem(itemStack.item, extraQuantity))
                        this.inventory.addItem(itemStack.item, extraQuantity);
                } else {
                    itemStack.tryBuy(this.game, extraQuantity);
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

    destroy() {
        this.factories.forEach((factory) => factory.destroy());
        this.machines.forEach((machine) => this.destroyMachine(machine));
        if (this.topFactory) {
            this.topFactory.factories = this.topFactory.factories.filter((elem) => {
                return elem !== this;
            });
        }
    }

    destroyPattern(patternId: number) {
        this.factories.forEach((factory) => factory.destroyPattern(patternId));
        if(this.patternId === patternId)
            this.patternId = undefined;
    }

    stop() {
        this.pause = true;
        this.factories.forEach((factory) => factory.stop());
        this.machines.forEach((machine) => machine.stop());
    }

    start() {
        this.pause = false;
        this.factories.forEach((factory) => factory.start());
        this.machines.forEach((machine) => machine.start());
    }

    togglePause() {
        if (this.pause) {
            this.start();
        } else {
            this.stop();
        }
    }

    savePattern() {
        Pattern.createFromFactory(this.game, this);
    }

    getPattern(): Pattern | undefined {
        if(this.patternId)
            return this.game.getPatternById(this.patternId);
        else
            return undefined;
    }
}